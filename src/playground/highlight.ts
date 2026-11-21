import { foldService } from '@codemirror/language'
import { type Extension, RangeSetBuilder } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { isQuantity } from '../data.ts'
import { tokenize, type Token, type TokenType } from '../lexer.ts'

const KEYWORD = new Set<TokenType>([
  'LET', 'IF', 'ELSE', 'WHILE', 'REPEAT', 'FOR', 'IN', 'FN', 'RETURN', 'AND', 'OR', 'NOT',
  'TRUE', 'FALSE', 'RECORD', 'MATCH', 'USE', 'ON', 'ENTITY', 'SPAWN', 'AT', 'DESPAWN',
  'EACH', 'WHERE', 'WHEN', 'TOUCHES', 'TASK', 'WAIT', 'UNTIL', 'EVERY', 'AFTER', 'REWIND',
])

const BUILTIN = new Set([
  'forward', 'back', 'turn', 'penup', 'pendown', 'color', 'width', 'goto', 'print',
  'len', 'push', 'sin', 'cos', 'sqrt', 'abs', 'random', 'min', 'max', 'hsl', 'vec',
  'clamp', 'lerp', 'bounce',
])

const MODULES = new Set(['draw', 'input', 'audio', 'turtle'])

/**
 * Color the buffer from the real lexer, plus comment ranges the lexer skips.
 * A lex error still colors the comments and leaves the rest plain.
 */
export function spoolHighlight(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        constructor(view: EditorView) {
          this.decorations = color(view.state.doc.toString())
        }
        update(update: ViewUpdate) {
          if (update.docChanged) this.decorations = color(update.state.doc.toString())
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    foldService.of((state, lineStart, lineEnd) => {
      const text = state.doc.sliceString(lineStart, lineEnd)
      const open = text.indexOf('{')
      if (open < 0) return null
      const from = lineStart + open
      const doc = state.doc.toString()
      let depth = 0
      for (let i = from; i < doc.length; i++) {
        const ch = doc[i]
        if (ch === '{') depth++
        else if (ch === '}') {
          depth--
          if (depth === 0 && i > from) return { from: from + 1, to: i }
        }
      }
      return null
    }),
  ]
}

function color(source: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const marks: { from: number; to: number; cls: string }[] = []
  for (const range of comments(source)) marks.push({ ...range, cls: 'tok-comment' })
  let tokens: Token[] = []
  try {
    tokens = tokenize(source).filter((token) => token.type !== 'EOF')
  } catch {
    tokens = []
  }
  const types = new Set<string>()
  const functions = new Set<string>()
  let interpolating = false
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const from = offset(source, token.line, token.column)
    const to = from + token.lexeme.length
    if (to <= from) continue
    if (token.type === 'TEMPLATE_HEAD' || token.type === 'TEMPLATE_MIDDLE') interpolating = true
    if (token.type === 'TEMPLATE_TAIL' || token.type === 'STRING') interpolating = false
    const previous = tokens[i - 1]
    const next = tokens[i + 1]
    if (token.type === 'IDENTIFIER' && previous?.type === 'ENTITY') types.add(token.lexeme)
    if (token.type === 'IDENTIFIER' && previous?.type === 'RECORD') types.add(token.lexeme)
    if (token.type === 'IDENTIFIER' && previous?.type === 'FN') functions.add(token.lexeme)
    let cls = classFor(token, previous, next, types, functions)
    if (interpolating && token.type === 'IDENTIFIER') cls = 'tok-interp'
    if (token.type === 'NUMBER' && isQuantity(token.literal)) {
      const matched = /^(-?(?:\d+\.\d+|\d+))(.*)$/.exec(token.lexeme)
      if (matched && matched[2]) {
        marks.push({ from, to: from + matched[1].length, cls: 'tok-num' })
        marks.push({ from: from + matched[1].length, to, cls: 'tok-unit' })
        continue
      }
    }
    if (cls) marks.push({ from, to, cls })
    if (token.type === 'IDENTIFIER' && next?.type === 'DOT' && MODULES.has(token.lexeme)) {
      /* already tok-mod */
    }
  }
  marks.sort((a, b) => a.from - b.from || a.to - b.to)
  let last = -1
  for (const mark of marks) {
    if (mark.from < last || mark.to <= mark.from) continue
    builder.add(mark.from, mark.to, Decoration.mark({ class: mark.cls }))
    last = mark.to
  }
  return builder.finish()
}

function classFor(
  token: Token,
  previous: Token | undefined,
  next: Token | undefined,
  types: Set<string>,
  functions: Set<string>,
): string {
  if (KEYWORD.has(token.type)) return 'tok-kw'
  if (token.type === 'STRING' || token.type === 'TEMPLATE_HEAD' || token.type === 'TEMPLATE_MIDDLE' || token.type === 'TEMPLATE_TAIL') {
    return 'tok-str'
  }
  if (token.type === 'NUMBER') return 'tok-num'
  if (
    token.type === 'PLUS' || token.type === 'MINUS' || token.type === 'STAR' ||
    token.type === 'PLUS_ASSIGN' || token.type === 'MINUS_ASSIGN' || token.type === 'STAR_ASSIGN' ||
    token.type === 'SLASH' ||
    token.type === 'PERCENT' || token.type === 'ASSIGN' || token.type === 'EQ' || token.type === 'NOT_EQ' ||
    token.type === 'LT' || token.type === 'GT' || token.type === 'LTE' || token.type === 'GTE' || token.type === 'PIPE' ||
    token.type === 'ARROW'
  ) {
    return 'tok-op'
  }
  if (token.type !== 'IDENTIFIER') return ''
  if (previous?.type === 'DOT') return 'tok-field'
  if (MODULES.has(token.lexeme) && (previous?.type === 'USE' || next?.type === 'DOT')) return 'tok-mod'
  if (types.has(token.lexeme) || previous?.type === 'ENTITY' || previous?.type === 'RECORD' || previous?.type === 'SPAWN') {
    return 'tok-type'
  }
  if (functions.has(token.lexeme) || previous?.type === 'FN' || next?.type === 'LPAREN') return 'tok-fn'
  if (BUILTIN.has(token.lexeme)) return 'tok-builtin'
  return 'tok-var'
}

function comments(source: string): { from: number; to: number }[] {
  const found: { from: number; to: number }[] = []
  let i = 0
  let quoting = false
  while (i < source.length) {
    const ch = source[i]
    if (quoting) {
      if (ch === '\\') i += 2
      else {
        if (ch === '"') quoting = false
        i++
      }
      continue
    }
    if (ch === '"') {
      quoting = true
      i++
      continue
    }
    if (ch === '#') {
      const from = i
      while (i < source.length && source[i] !== '\n') i++
      found.push({ from, to: i })
      continue
    }
    i++
  }
  return found
}

function offset(source: string, line: number, column: number): number {
  let current = 1
  let index = 0
  while (index < source.length && current < line) {
    if (source[index] === '\n') current++
    index++
  }
  return Math.min(source.length, index + Math.max(0, column - 1))
}
