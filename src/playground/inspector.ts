import type { Expr, Program, SourceLocation, Stmt } from '../ast.ts'
import type { DisasmLine } from '../bytecode.ts'
import { formatQuantity, isQuantity } from '../data.ts'
import type { ScopeSnapshot, StackFrame } from '../interpreter.ts'
import { tokenize } from '../lexer.ts'
import type { Token } from '../lexer.ts'
import { parse } from '../parser.ts'
import type { SourceSpan } from './editor.ts'

export interface Inspection {
  tokens: Token[] | null
  program: Program | null
  banner: string | null
}

interface TreeNode extends SourceSpan {
  label: string
  detail: string
  children: TreeNode[]
}

/** Re-lex and re-parse. A failure keeps the previous tokens or tree. */
export function inspectSource(source: string, previous: Inspection): Inspection {
  const next: Inspection = { tokens: previous.tokens, program: previous.program, banner: null }
  try {
    next.tokens = tokenize(source).filter((token) => token.type !== 'EOF')
  } catch (error) {
    next.banner = error instanceof Error ? error.message : 'Could not read tokens'
    return next
  }
  try {
    next.program = parse(source)
  } catch (error) {
    next.banner = error instanceof Error ? error.message : 'Could not parse'
  }
  return next
}

export function countNodes(program: Program | null): number {
  if (!program) return 0
  return 1 + program.body.reduce((sum, statement) => sum + countStmt(statement), 0)
}

export function renderTokens(host: HTMLElement, tokens: Token[] | null): void {
  host.replaceChildren()
  if (!tokens) {
    host.append(note('No tokens yet.'))
    return
  }
  const table = document.createElement('table')
  table.className = 'token-table'
  const head = document.createElement('tr')
  for (const title of ['Type', 'Lexeme', 'At']) {
    const cell = document.createElement('th')
    cell.textContent = title
    head.append(cell)
  }
  table.append(head)
  for (const token of tokens) {
    const row = document.createElement('tr')
    row.append(cell(token.type), cell(token.lexeme === '' ? '""' : token.lexeme), cell(`${token.line}:${token.column}`))
    table.append(row)
  }
  host.append(table)
}

export function renderTree(host: HTMLElement, program: Program | null): void {
  host.replaceChildren()
  if (!program) {
    host.append(note('No tree yet.'))
    return
  }
  host.append(renderNode(toTree(program)))
}

/** Mark the smallest node that contains the cursor. */
export function markTreeCursor(host: HTMLElement, source: string, line: number, column: number): void {
  const pos = offsetAt(source, line, column)
  let best: HTMLElement | null = null
  let bestSpan = Number.POSITIVE_INFINITY
  for (const node of host.querySelectorAll<HTMLElement>('details.node')) {
    node.classList.remove('is-current')
    const span = readSpan(node)
    if (!span) continue
    const start = offsetAt(source, span.line, span.column)
    const end = offsetAt(source, span.endLine, span.endColumn)
    if (pos < start || pos >= Math.max(end, start + 1)) continue
    const width = Math.max(end - start, 1)
    if (width < bestSpan) {
      best = node
      bestSpan = width
    }
  }
  best?.classList.add('is-current')
}

export function spanFromNode(node: HTMLElement): SourceSpan | null {
  return readSpan(node)
}

export function renderOutput(host: HTMLElement, lines: string[]): void {
  host.replaceChildren()
  if (lines.length === 0) {
    host.append(note('No output yet. print writes here.'))
    return
  }
  const pre = document.createElement('pre')
  pre.className = 'pane-text'
  pre.textContent = lines.join('\n')
  host.append(pre)
}

export function renderScopes(host: HTMLElement, scopes: ScopeSnapshot[] | null): void {
  host.replaceChildren()
  if (!scopes) {
    host.append(note('Step or continue to see variables.'))
    return
  }
  for (const scope of scopes) {
    const block = document.createElement('section')
    block.className = 'scope'
    const title = document.createElement('h3')
    title.textContent = scope.label
    block.append(title)
    if (scope.bindings.length === 0) {
      block.append(note('empty'))
    } else {
      const list = document.createElement('ul')
      for (const binding of scope.bindings) {
        const item = document.createElement('li')
        const name = document.createElement('span')
        name.className = 'bind-name'
        name.textContent = binding.name
        const value = document.createElement('span')
        value.className = 'bind-value'
        value.textContent = binding.value
        item.append(name, value)
        list.append(item)
      }
      block.append(list)
    }
    host.append(block)
  }
}

export function renderBytecode(
  host: HTMLElement,
  before: DisasmLine[],
  after: DisasmLine[],
  active: { chunk: string; ip: number } | null,
): void {
  host.replaceChildren()
  const beforeCount = before.filter((row) => row.ip >= 0).length
  const afterCount = after.filter((row) => row.ip >= 0).length
  const summary = document.createElement('p')
  summary.className = 'pane-note'
  summary.textContent = `Before ${beforeCount} instructions. After ${afterCount} instructions.`
  host.append(summary)
  const listing = document.createElement('div')
  listing.className = 'diff'
  for (const row of diffRows(before, after)) {
    const line = document.createElement('div')
    line.className = row.mark === '+' ? 'diff-add' : row.mark === '-' ? 'diff-del' : 'diff-same'
    line.textContent = `${row.mark} ${row.text}`
    if (row.chunk !== undefined && row.ip !== undefined && row.ip >= 0) {
      line.dataset.chunk = row.chunk
      line.dataset.ip = String(row.ip)
      if (active && active.chunk === row.chunk && active.ip === row.ip) line.classList.add('is-current')
    }
    listing.append(line)
  }
  host.append(listing)
}

export function markInstruction(host: HTMLElement, chunk: string, ip: number): void {
  let current: HTMLElement | null = null
  for (const row of host.querySelectorAll<HTMLElement>('[data-ip]')) {
    const on = row.dataset.chunk === chunk && Number(row.dataset.ip) === ip
    row.classList.toggle('is-current', on)
    if (on) current = row
  }
  current?.scrollIntoView({ block: 'nearest' })
}

interface DiffRow {
  mark: ' ' | '+' | '-'
  text: string
  chunk?: string
  ip?: number
}

/** Ignore the address column, which shifts whenever an earlier instruction is removed. */
function sameInstruction(left: DisasmLine, right: DisasmLine): boolean {
  if (left.ip < 0 || right.ip < 0) return left.text === right.text
  return left.text.replace(/^\s*\d+/, '') === right.text.replace(/^\s*\d+/, '')
}

function diffRows(before: DisasmLine[], after: DisasmLine[]): DiffRow[] {
  const width = before.length
  const height = after.length
  if (width * height > 250_000) {
    return after.map((row) => ({ mark: ' ', text: row.text, chunk: row.chunk, ip: row.ip }))
  }
  const scores: number[][] = Array.from({ length: width + 1 }, () => new Array<number>(height + 1).fill(0))
  for (let i = width - 1; i >= 0; i--) {
    for (let j = height - 1; j >= 0; j--) {
      scores[i][j] =
        sameInstruction(before[i], after[j]) ? scores[i + 1][j + 1] + 1 : Math.max(scores[i + 1][j], scores[i][j + 1])
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < width && j < height) {
    if (sameInstruction(before[i], after[j])) {
      rows.push({ mark: ' ', text: after[j].text, chunk: after[j].chunk, ip: after[j].ip })
      i++
      j++
    } else if (scores[i + 1][j] >= scores[i][j + 1]) {
      rows.push({ mark: '-', text: before[i].text })
      i++
    } else {
      rows.push({ mark: '+', text: after[j].text, chunk: after[j].chunk, ip: after[j].ip })
      j++
    }
  }
  while (i < width) rows.push({ mark: '-', text: before[i++].text })
  while (j < height) {
    rows.push({ mark: '+', text: after[j].text, chunk: after[j].chunk, ip: after[j].ip })
    j++
  }
  return rows
}

export function renderStack(host: HTMLElement, frames: StackFrame[] | null): void {
  host.replaceChildren()
  if (!frames) {
    host.append(note('Step into a function to see the call stack.'))
    return
  }
  if (frames.length === 0) {
    host.append(note('Top level. No function is running.'))
    return
  }
  const list = document.createElement('ol')
  list.className = 'stack'
  for (const frame of [...frames].reverse()) {
    const item = document.createElement('li')
    item.textContent = `${frame.name} at ${frame.line}:${frame.column}`
    list.append(item)
  }
  host.append(list)
}

function renderNode(node: TreeNode): HTMLDetailsElement {
  const details = document.createElement('details')
  details.className = 'node'
  details.open = true
  details.dataset.line = String(node.line)
  details.dataset.column = String(node.column)
  details.dataset.endLine = String(node.endLine)
  details.dataset.endColumn = String(node.endColumn)
  const summary = document.createElement('summary')
  const kind = document.createElement('span')
  kind.className = 'node-kind'
  kind.textContent = node.label
  summary.append(kind)
  if (node.detail) {
    const detail = document.createElement('span')
    detail.className = 'node-detail'
    detail.textContent = node.detail
    summary.append(detail)
  }
  details.append(summary)
  if (node.children.length > 0) {
    const children = document.createElement('div')
    children.className = 'node-children'
    for (const child of node.children) children.append(renderNode(child))
    details.append(children)
  }
  return details
}

function toTree(program: Program): TreeNode {
  return make('Program', '', program, program.body.map(statementNode))
}

function statementNode(statement: Stmt): TreeNode {
  switch (statement.type) {
    case 'LetStmt':
      return make('LetStmt', statement.name, statement, [exprNode(statement.value)])
    case 'AssignStmt':
      return make('AssignStmt', statement.name, statement, [exprNode(statement.value)])
    case 'ExprStmt':
      return make('ExprStmt', '', statement, [exprNode(statement.expression)])
    case 'IfStmt': {
      const children = [exprNode(statement.condition), blockNode(statement.thenBranch, 'then')]
      if (statement.elseBranch) children.push(blockNode(statement.elseBranch, 'else'))
      return make('IfStmt', '', statement, children)
    }
    case 'WhileStmt':
      return make('WhileStmt', '', statement, [exprNode(statement.condition), blockNode(statement.body, 'body')])
    case 'RepeatStmt':
      return make('RepeatStmt', '', statement, [exprNode(statement.count), blockNode(statement.body, 'body')])
    case 'ForStmt':
      return make('ForStmt', statement.name, statement, [
        exprNode(statement.start),
        exprNode(statement.end),
        blockNode(statement.body, 'body'),
      ])
    case 'ForInStmt':
      return make('ForInStmt', statement.name, statement, [
        exprNode(statement.collection),
        blockNode(statement.body, 'body'),
      ])
    case 'RecordStmt':
      return make('RecordStmt', statement.name, statement, [])
    case 'FieldAssignStmt':
      return make('FieldAssignStmt', statement.name, statement, [exprNode(statement.object), exprNode(statement.value)])
    case 'IndexAssignStmt':
      return make('IndexAssignStmt', '', statement, [
        exprNode(statement.object),
        exprNode(statement.index),
        exprNode(statement.value),
      ])
    case 'ReturnStmt':
      return make('ReturnStmt', '', statement, statement.value ? [exprNode(statement.value)] : [])
    case 'FnStmt':
      return make(
        'FnStmt',
        statement.name,
        statement,
        [
          ...statement.params.map((param) => make('Parameter', param.name, param, [])),
          blockNode(statement.body, 'body'),
        ],
      )
  }
}

function blockNode(block: SourceLocation & { statements: Stmt[] }, detail: string): TreeNode {
  return make('BlockStmt', detail, block, block.statements.map(statementNode))
}

function exprNode(expr: Expr): TreeNode {
  switch (expr.type) {
    case 'LiteralExpr':
      return make('LiteralExpr', literalDetail(expr.value), expr, [])
    case 'VariableExpr':
      return make('VariableExpr', expr.name, expr, [])
    case 'UnaryExpr':
      return make('UnaryExpr', expr.operator, expr, [exprNode(expr.operand)])
    case 'BinaryExpr':
      return make('BinaryExpr', expr.operator, expr, [exprNode(expr.left), exprNode(expr.right)])
    case 'CallExpr':
      return make('CallExpr', callLabel(expr), expr, [exprNode(expr.callee), ...expr.args.map(exprNode)])
    case 'ArrayExpr':
      return make('ArrayExpr', '', expr, expr.elements.map(exprNode))
    case 'IndexExpr':
      return make('IndexExpr', '', expr, [exprNode(expr.object), exprNode(expr.index)])
    case 'FnExpr':
      return make('FnExpr', '', expr, [
        ...expr.params.map((param) => make('Parameter', param.name, param, [])),
        blockNode(expr.body, 'body'),
      ])
    case 'FieldExpr':
      return make('FieldExpr', expr.name, expr, [exprNode(expr.object)])
    case 'MapExpr':
      return make('MapExpr', '', expr, expr.entries.map((entry) => exprNode(entry.value)))
    case 'RecordExpr':
      return make('RecordExpr', expr.name, expr, expr.fields.map((field) => exprNode(field.value)))
    case 'InterpExpr':
      return make(
        'InterpExpr',
        '',
        expr,
        expr.parts.flatMap((part) => (part.type === 'hole' ? [exprNode(part.expr)] : [])),
      )
    case 'MatchExpr':
      return make('MatchExpr', '', expr, [exprNode(expr.scrutinee), ...expr.arms.map((arm) => exprNode(arm.body))])
  }
}

function literalDetail(value: Extract<Expr, { type: 'LiteralExpr' }>['value']): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (isQuantity(value)) return formatQuantity(value)
  return String(value)
}

function callLabel(expr: Extract<Expr, { type: 'CallExpr' }>): string {
  return expr.callee.type === 'VariableExpr' ? expr.callee.name : 'call'
}

function make(label: string, detail: string, loc: SourceLocation, children: TreeNode[]): TreeNode {
  let line = loc.line
  let column = loc.column
  let endLine = loc.endLine ?? loc.line
  let endColumn = loc.endColumn ?? loc.column + 1
  for (const child of children) {
    if (child.line < line || (child.line === line && child.column < column)) {
      line = child.line
      column = child.column
    }
    if (child.endLine > endLine || (child.endLine === endLine && child.endColumn > endColumn)) {
      endLine = child.endLine
      endColumn = child.endColumn
    }
  }
  return { label, detail, line, column, endLine, endColumn, children }
}

function countStmt(statement: Stmt): number {
  switch (statement.type) {
    case 'LetStmt':
    case 'AssignStmt':
      return 1 + countExpr(statement.value)
    case 'ExprStmt':
      return 1 + countExpr(statement.expression)
    case 'IfStmt':
      return (
        1 +
        countExpr(statement.condition) +
        countBlock(statement.thenBranch) +
        (statement.elseBranch ? countBlock(statement.elseBranch) : 0)
      )
    case 'WhileStmt':
      return 1 + countExpr(statement.condition) + countBlock(statement.body)
    case 'RepeatStmt':
      return 1 + countExpr(statement.count) + countBlock(statement.body)
    case 'ForStmt':
      return 1 + countExpr(statement.start) + countExpr(statement.end) + countBlock(statement.body)
    case 'ForInStmt':
      return 1 + countExpr(statement.collection) + countBlock(statement.body)
    case 'RecordStmt':
      return 1
    case 'FieldAssignStmt':
      return 1 + countExpr(statement.object) + countExpr(statement.value)
    case 'IndexAssignStmt':
      return 1 + countExpr(statement.object) + countExpr(statement.index) + countExpr(statement.value)
    case 'ReturnStmt':
      return 1 + (statement.value ? countExpr(statement.value) : 0)
    case 'FnStmt':
      return 1 + statement.params.length + countBlock(statement.body)
  }
}

function countBlock(block: { statements: Stmt[] }): number {
  return 1 + block.statements.reduce((sum, statement) => sum + countStmt(statement), 0)
}

function countExpr(expr: Expr): number {
  switch (expr.type) {
    case 'LiteralExpr':
    case 'VariableExpr':
      return 1
    case 'UnaryExpr':
      return 1 + countExpr(expr.operand)
    case 'BinaryExpr':
      return 1 + countExpr(expr.left) + countExpr(expr.right)
    case 'CallExpr':
      return 1 + countExpr(expr.callee) + expr.args.reduce((sum, arg) => sum + countExpr(arg), 0)
    case 'ArrayExpr':
      return 1 + expr.elements.reduce((sum, element) => sum + countExpr(element), 0)
    case 'IndexExpr':
      return 1 + countExpr(expr.object) + countExpr(expr.index)
    case 'FnExpr':
      return 1 + expr.params.length + countBlock(expr.body)
    case 'FieldExpr':
      return 1 + countExpr(expr.object)
    case 'MapExpr':
      return 1 + expr.entries.reduce((sum, entry) => sum + countExpr(entry.value), 0)
    case 'RecordExpr':
      return 1 + expr.fields.reduce((sum, field) => sum + countExpr(field.value), 0)
    case 'InterpExpr':
      return 1 + expr.parts.reduce((sum, part) => sum + (part.type === 'hole' ? countExpr(part.expr) : 0), 0)
    case 'MatchExpr':
      return 1 + countExpr(expr.scrutinee) + expr.arms.reduce((sum, arm) => sum + countExpr(arm.body), 0)
  }
}

function readSpan(node: HTMLElement): SourceSpan | null {
  const line = Number(node.dataset.line)
  const column = Number(node.dataset.column)
  const endLine = Number(node.dataset.endLine)
  const endColumn = Number(node.dataset.endColumn)
  if (![line, column, endLine, endColumn].every(Number.isFinite)) return null
  return { line, column, endLine, endColumn }
}

function offsetAt(source: string, line: number, column: number): number {
  let current = 1
  let index = 0
  while (index < source.length && current < line) {
    if (source[index] === '\n') current++
    index++
  }
  return index + Math.max(0, column - 1)
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td')
  td.textContent = text
  return td
}

function note(text: string): HTMLParagraphElement {
  const p = document.createElement('p')
  p.className = 'pane-note'
  p.textContent = text
  return p
}
