import type {
  ArrayExpr,
  AssignStmt,
  BinaryOp,
  BlockStmt,
  CallExpr,
  DespawnStmt,
  EachStmt,
  EntityStmt,
  Expr,
  ExprStmt,
  FieldInit,
  FnExpr,
  FnStmt,
  ForInStmt,
  ForStmt,
  IfStmt,
  IndexAssignStmt,
  IndexExpr,
  InterpExpr,
  InterpPart,
  LetStmt,
  MapEntry,
  MapExpr,
  MatchArm,
  MatchExpr,
  Parameter,
  Pattern,
  SpawnExpr,
  Program,
  RecordExpr,
  RecordStmt,
  OnStmt,
  UseStmt,
  WhenStmt,
  RepeatStmt,
  ReturnStmt,
  SourceLocation,
  Stmt,
  UnaryOp,
  WhileStmt,
} from './ast.ts'
import { isQuantity } from './data.ts'
import { ParseError, presentError, SourceError } from './errors.ts'
import { tokenize, type Token, type TokenType } from './lexer.ts'

/**
 * Parser: tokens → AST.
 *
 * A program is a list of statements. There are no semicolons: a statement
 * ends when the next token cannot be part of it. `let`, `if`, `while`,
 * `repeat`, and `fn` each own a `{ ... }` block.
 *
 * A call is written `name(arg, ...)`. The turtle commands also have a
 * statement form with a fixed number of arguments and no parentheses:
 * `forward s`, `turn 90`, `penup`. A name that is not one of those
 * commands is just a variable.
 *
 * Expressions use precedence climbing. One loop walks operators from
 * loosest to tightest, instead of a separate function for each level.
 * A lower number binds more loosely, so it is evaluated later:
 *
 *   |>                 0
 *   or                 1
 *   and                2
 *   not                3   prefix
 *   == != < > <= >=    4
 *   + -                5
 *   * / %              6
 *   -                  7   prefix, unary minus
 *   call, index        8   postfix: f(x), items[i]
 *   number, string, true, false, name, fn(...), [...], ( )
 *
 * `for i in 0..n` uses `..` as part of the loop, not as an operator.
 * `end` is exclusive.
 */

/**
 * Statement form of the built-in commands.
 * `penup` takes nothing, so the next word is a new statement.
 * `goto` takes two expressions: `goto 10 20`.
 * `forward(s)` still works, because a following `(` uses the normal call form.
 */
const BUILTIN_ARITY: Readonly<Record<string, number>> = {
  forward: 1,
  back: 1,
  turn: 1,
  penup: 0,
  pendown: 0,
  color: 1,
  width: 1,
  goto: 2,
  print: 1,
}

interface Operator<T> {
  operator: T
  precedence: number
}

const BINARY: Partial<Record<TokenType, Operator<BinaryOp>>> = {
  PIPE: { operator: '|>', precedence: 0 },
  OR: { operator: 'or', precedence: 1 },
  AND: { operator: 'and', precedence: 2 },
  EQ: { operator: '==', precedence: 4 },
  NOT_EQ: { operator: '!=', precedence: 4 },
  LT: { operator: '<', precedence: 4 },
  GT: { operator: '>', precedence: 4 },
  LTE: { operator: '<=', precedence: 4 },
  GTE: { operator: '>=', precedence: 4 },
  PLUS: { operator: '+', precedence: 5 },
  MINUS: { operator: '-', precedence: 5 },
  STAR: { operator: '*', precedence: 6 },
  SLASH: { operator: '/', precedence: 6 },
  PERCENT: { operator: '%', precedence: 6 },
}

const UNARY: Partial<Record<TokenType, Operator<UnaryOp>>> = {
  NOT: { operator: 'not', precedence: 3 },
  MINUS: { operator: '-', precedence: 7 },
}

/** Parse a whole program: statements until the end of the source. */
export function parse(source: string): Program {
  return present(source, () => new Parser(tokenize(source)).parseProgram())
}

/** Parse one expression and reject any leftover tokens. */
export function parseExpression(source: string): Expr {
  return present(source, () => new Parser(tokenize(source)).parseExpression())
}

function present<T>(source: string, parseSource: () => T): T {
  try {
    return parseSource()
  } catch (error) {
    if (error instanceof SourceError) throw presentError(error, source)
    throw error
  }
}

class Parser {
  private readonly tokens: Token[]
  private current = 0
  /** How many `fn` bodies we are currently inside. `return` is only legal when this is > 0. */
  private fnDepth = 0
  /** True while parsing an expression that is followed by a `{ ... }` body. */
  private braceIsBlock = false

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  parseProgram(): Program {
    const start = this.peek()
    const body: Stmt[] = []
    while (!this.isAtEnd()) body.push(this.statement())
    return { type: 'Program', body, ...this.span(start) }
  }

  parseExpression(): Expr {
    const expr = this.climb(0)
    if (!this.isAtEnd()) throw this.unexpected()
    return expr
  }

  /**
   * A keyword starts `let`, `if`, `while`, `repeat`, `fn`, or `return`.
   * A turtle command can take its arguments without parentheses.
   * Anything else is an expression used as a statement.
   */
  private statement(): Stmt {
    if (this.check('LET')) return this.letStatement()
    if (this.check('IF')) return this.ifStatement()
    if (this.check('WHILE')) return this.whileStatement()
    if (this.check('REPEAT')) return this.repeatStatement()
    if (this.check('FOR')) return this.forStatement()
    if (this.check('RECORD')) return this.recordStatement()
    if (this.check('USE')) return this.useStatement()
    if (this.check('ON')) return this.onStatement()
    if (this.check('ENTITY')) return this.entityStatement()
    if (this.check('DESPAWN')) return this.despawnStatement()
    if (this.check('EACH')) return this.eachStatement()
    if (this.check('WHEN')) return this.whenStatement()
    if (this.check('FN') && this.peekNext().type === 'IDENTIFIER') return this.fnStatement()
    if (this.check('RETURN')) return this.returnStatement()
    if (this.check('IDENTIFIER') && this.peekNext().type === 'ASSIGN') return this.assignStatement()
    const command = this.commandStatement()
    if (command) return command
    return this.expressionStatement()
  }

  /** `let size = 50`. The `=` and the value are required. */
  private letStatement(): LetStmt {
    const keyword = this.advance()
    const name = this.consume('IDENTIFIER', 'a variable name')
    this.consume('ASSIGN', "'='")
    const value = this.climb(0)
    return { type: 'LetStmt', name: name.lexeme, value, ...this.span(keyword) }
  }

  /** `n = n + 1`. The name must already exist; this does not define it. */
  private assignStatement(): AssignStmt {
    const name = this.advance()
    this.consume('ASSIGN', "'='")
    const value = this.climb(0)
    return { type: 'AssignStmt', name: name.lexeme, value, ...this.span(name) }
  }

  /** `if cond { ... }` or `if cond { ... } else { ... }`. */
  private ifStatement(): IfStmt {
    const keyword = this.advance()
    const condition = this.beforeBlock(() => this.climb(0))
    const thenBranch = this.block()
    let elseBranch: BlockStmt | null = null
    if (this.check('ELSE')) {
      this.advance()
      elseBranch = this.block()
    }
    return { type: 'IfStmt', condition, thenBranch, elseBranch, ...this.span(keyword) }
  }

  /** `while cond { ... }`. */
  private whileStatement(): WhileStmt {
    const keyword = this.advance()
    const condition = this.beforeBlock(() => this.climb(0))
    const body = this.block()
    return { type: 'WhileStmt', condition, body, ...this.span(keyword) }
  }

  /**
   * `for i in 0..n` keeps the exclusive range.
   * `for x in items` walks an array, a string, or the keys of a map.
   */
  private forStatement(): ForStmt | ForInStmt {
    const keyword = this.advance()
    const name = this.consume('IDENTIFIER', 'a variable name')
    this.consume('IN', "'in'")
    const start = this.beforeBlock(() => this.climb(0))
    if (!this.check('DOTDOT')) {
      const body = this.block()
      return { type: 'ForInStmt', name: name.lexeme, collection: start, body, ...this.span(keyword) }
    }
    this.advance()
    const end = this.beforeBlock(() => this.climb(0))
    const body = this.block()
    return { type: 'ForStmt', name: name.lexeme, start, end, body, ...this.span(keyword) }
  }

  /** `entity Ball { r }`. */
  private entityStatement(): EntityStmt {
    const keyword = this.advance()
    const name = this.consume('IDENTIFIER', 'an entity name')
    this.consume('LBRACE', "'{'")
    const fields = this.fieldNames()
    this.consume('RBRACE', "'}'")
    return { type: 'EntityStmt', name: name.lexeme, fields, ...this.span(keyword) }
  }

  /** `despawn ball`. */
  private despawnStatement(): DespawnStmt {
    const keyword = this.advance()
    const entity = this.climb(0)
    return { type: 'DespawnStmt', entity, ...this.span(keyword) }
  }

  /** `each ball in Ball where ball.x > 0 { }`. */
  private eachStatement(): EachStmt {
    const keyword = this.advance()
    const name = this.consume('IDENTIFIER', 'a variable name')
    this.consume('IN', "'in'")
    const typeName = this.consume('IDENTIFIER', 'an entity name')
    this.consume('WHERE', "'where'")
    const where = this.beforeBlock(() => this.climb(0))
    const body = this.block()
    return { type: 'EachStmt', name: name.lexeme, typeName: typeName.lexeme, where, body, ...this.span(keyword) }
  }

  /** `when ball in Ball touches wall in Wall { }`. */
  private whenStatement(): WhenStmt {
    const keyword = this.advance()
    const left = this.consume('IDENTIFIER', 'a variable name')
    this.consume('IN', "'in'")
    const leftType = this.consume('IDENTIFIER', 'an entity name')
    this.consume('TOUCHES', "'touches'")
    const right = this.consume('IDENTIFIER', 'a variable name')
    this.consume('IN', "'in'")
    const rightType = this.consume('IDENTIFIER', 'an entity name')
    const body = this.block()
    return {
      type: 'WhenStmt',
      left: left.lexeme,
      leftType: leftType.lexeme,
      right: right.lexeme,
      rightType: rightType.lexeme,
      body,
      ...this.span(keyword),
    }
  }

  /** `on tick(dt) { }`. The body is stored and run by the game clock. */
  private onStatement(): OnStmt {
    const keyword = this.advance()
    const kind = this.consume('IDENTIFIER', "'start', 'tick', 'key', or 'key_up'")
    if (kind.lexeme === 'start') {
      const body = this.block()
      return { type: 'OnStmt', event: 'start', param: null, key: null, body, ...this.span(keyword) }
    }
    if (kind.lexeme === 'tick') {
      this.consume('LPAREN', "'('")
      const param = this.consume('IDENTIFIER', 'a parameter name')
      this.consume('RPAREN', "')'")
      const body = this.block()
      return { type: 'OnStmt', event: 'tick', param: param.lexeme, key: null, body, ...this.span(keyword) }
    }
    if (kind.lexeme === 'key' || kind.lexeme === 'key_up') {
      const key = this.consume('STRING', 'a key name')
      const body = this.block()
      return {
        type: 'OnStmt',
        event: kind.lexeme,
        param: null,
        key: String(key.literal),
        body,
        ...this.span(keyword),
      }
    }
    throw new ParseError('E0101', "Expected 'start', 'tick', 'key', or 'key_up'", kind.line, kind.column)
  }

  /** `use turtle`. The name is whatever the host registered. */
  private useStatement(): UseStmt {
    const keyword = this.advance()
    const name = this.consume('IDENTIFIER', 'a module name')
    return { type: 'UseStmt', name: name.lexeme, ...this.span(keyword) }
  }

  /** `record Paddle { x, y }`. */
  private recordStatement(): RecordStmt {
    const keyword = this.advance()
    const name = this.consume('IDENTIFIER', 'a record name')
    this.consume('LBRACE', "'{'")
    const fields = this.fieldNames()
    this.consume('RBRACE', "'}'")
    return { type: 'RecordStmt', name: name.lexeme, fields, ...this.span(keyword) }
  }

  private fieldNames(): string[] {
    const names: string[] = []
    if (this.check('RBRACE')) return names
    names.push(this.fieldName(names))
    while (this.check('COMMA')) {
      this.advance()
      names.push(this.fieldName(names))
    }
    return names
  }

  private fieldName(seen: string[]): string {
    const token = this.consume('IDENTIFIER', 'a field name')
    if (seen.includes(token.lexeme)) {
      throw new ParseError('E0109', `Field '${token.lexeme}' is repeated`, token.line, token.column)
    }
    return token.lexeme
  }

  /** `repeat n { ... }`. The count is an expression, not just a literal. */
  private repeatStatement(): RepeatStmt {
    const keyword = this.advance()
    const count = this.beforeBlock(() => this.climb(0))
    const body = this.block()
    return { type: 'RepeatStmt', count, body, ...this.span(keyword) }
  }

  /**
   * `{ ... }`. Statements are read until the matching `}`.
   * A block is a body, not a statement, so this is only called by
   * `if`, `while`, and `repeat`.
   */
  private block(): BlockStmt {
    const brace = this.consume('LBRACE', "'{'")
    const statements: Stmt[] = []
    while (!this.check('RBRACE') && !this.isAtEnd()) {
      if (this.check('ELSE')) {
        throw new ParseError('E0101', "Expected '}' before 'else'", this.peek().line, this.peek().column)
      }
      statements.push(this.statement())
    }
    this.consume('RBRACE', "'}'")
    return { type: 'BlockStmt', statements, ...this.span(brace) }
  }

  /** `fn square(s) { ... }`. Parameters are names separated by commas. */
  private fnStatement(): FnStmt {
    const keyword = this.advance()
    const name = this.consume('IDENTIFIER', 'a function name')
    this.consume('LPAREN', "'('")
    const params = this.parameterList()
    this.consume('RPAREN', "')'")

    this.fnDepth++
    const body = this.block()
    this.fnDepth--

    return { type: 'FnStmt', name: name.lexeme, params, body, ...this.span(keyword) }
  }

  private parameterList(): Parameter[] {
    const params: Parameter[] = []
    if (this.check('RPAREN')) return params
    params.push(this.parameter(params))
    while (this.check('COMMA')) {
      this.advance()
      params.push(this.parameter(params))
    }
    return params
  }

  private parameter(soFar: Parameter[]): Parameter {
    const token = this.consume('IDENTIFIER', 'a parameter name')
    if (soFar.some((param) => param.name === token.lexeme)) {
      throw new ParseError('E0102', `Duplicate parameter '${token.lexeme}'`, token.line, token.column)
    }
    return { name: token.lexeme, line: token.line, column: token.column }
  }

  /**
   * `return` or `return expr`.
   * The expression is read only when the next token can start one,
   * so `return }` is a bare return and `return n * 2` returns the product.
   */
  private returnStatement(): ReturnStmt {
    const keyword = this.advance()
    if (this.fnDepth === 0) {
      throw new ParseError('E0103', 'return must be inside a function', keyword.line, keyword.column)
    }
    const value = this.startsExpression() ? this.climb(0) : null
    return { type: 'ReturnStmt', value, ...this.span(keyword) }
  }

  /**
   * `forward s`, `goto 10 20`, `penup`.
   * Returns null when the name is not a command, or when `(` follows,
   * so `forward(s)` stays a normal call.
   */
  private commandStatement(): ExprStmt | null {
    if (!this.check('IDENTIFIER')) return null
    const name = this.peek()
    const arity = BUILTIN_ARITY[name.lexeme]
    const next = this.peekNext().type
    if (arity === undefined || next === 'LPAREN' || next === 'LBRACKET' || next === 'ASSIGN') return null

    this.advance()
    const args: Expr[] = []
    for (let i = 0; i < arity; i++) args.push(this.climb(0))
    const callee: Expr = {
      type: 'VariableExpr',
      name: name.lexeme,
      line: name.line,
      column: name.column,
      endLine: name.line,
      endColumn: name.column + name.lexeme.length,
    }
    const expression: CallExpr = {
      type: 'CallExpr',
      callee,
      args,
      ...this.span(name),
    }
    return { type: 'ExprStmt', expression, ...this.span(name) }
  }

  /**
   * An expression standing alone, such as `size + 1` or `square(100)`.
   * `n = n + 1` and `items[i] = 1` are assignments. The target is parsed
   * first; `=` is not an operator inside an expression.
   */
  private expressionStatement(): Stmt {
    const expression = this.climb(0)
    if (!this.check('ASSIGN')) {
      return { type: 'ExprStmt', expression, ...this.spanFrom(expression) }
    }
    this.advance()
    const value = this.climb(0)
    const location = this.spanFrom(expression)
    location.endLine = value.endLine ?? value.line
    location.endColumn = value.endColumn ?? value.column
    if (expression.type === 'VariableExpr') {
      return { type: 'AssignStmt', name: expression.name, value, ...location }
    }
    if (expression.type === 'IndexExpr') {
      const assign: IndexAssignStmt = {
        type: 'IndexAssignStmt',
        object: expression.object,
        index: expression.index,
        value,
        ...location,
      }
      return assign
    }
    if (expression.type === 'FieldExpr') {
      return {
        type: 'FieldAssignStmt',
        object: expression.object,
        name: expression.name,
        value,
        nameLine: expression.nameLine,
        nameColumn: expression.nameColumn,
        ...location,
      }
    }
    throw new ParseError(
      'E0108',
      'Only a name, an index, or a field can be assigned to',
      expression.line,
      expression.column,
    )
  }

  /**
   * Parse an expression whose operators all bind at least as tightly as `minPrec`.
   *
   * The caller passes the precedence it is willing to give away. A looser
   * operator (smaller number) stops the loop and is left for that caller.
   * Operators are left-associative: the right-hand side must be strictly tighter.
   */
  private climb(minPrec: number): Expr {
    let left = this.prefix(minPrec)

    for (;;) {
      const infix = BINARY[this.peek().type]
      if (!infix || infix.precedence < minPrec) break

      const operator = this.advance()
      const right = this.climb(infix.precedence + 1)
      left = {
        type: 'BinaryExpr',
        operator: infix.operator,
        left,
        right,
        line: operator.line,
        column: operator.column,
        endLine: right.endLine ?? right.line,
        endColumn: right.endColumn ?? right.column,
      }
    }

    return left
  }

  /** A prefix operator, or a primary if the next token is not one. */
  private prefix(minPrec: number): Expr {
    const token = this.peek()
    const unary = UNARY[token.type]
    if (!unary || unary.precedence < minPrec) return this.primary()

    this.advance()
    const operand = this.climb(unary.precedence)
    return {
      type: 'UnaryExpr',
      operator: unary.operator,
      operand,
      line: token.line,
      column: token.column,
      endLine: operand.endLine ?? operand.line,
      endColumn: operand.endColumn ?? operand.column,
    }
  }

  /** A number, string, name, array, function, or a parenthesized expression, plus any calls or indexes. */
  private primary(): Expr {
    return this.postfix(this.atom())
  }

  private atom(): Expr {
    const token = this.peek()

    if (token.type === 'NUMBER' || token.type === 'STRING') {
      this.advance()
      if (typeof token.literal !== 'number' && typeof token.literal !== 'string' && !isQuantity(token.literal)) {
        throw new ParseError('E0104', 'Expected a literal value', token.line, token.column)
      }
      return { type: 'LiteralExpr', value: token.literal, ...this.span(token) }
    }

    if (token.type === 'SPAWN') return this.spawnExpr()
    if (token.type === 'TEMPLATE_HEAD') return this.template()
    if (token.type === 'MATCH') return this.matchExpr()
    if (token.type === 'LBRACE') return this.mapLiteral()

    if (token.type === 'TRUE' || token.type === 'FALSE') {
      this.advance()
      return { type: 'LiteralExpr', value: token.type === 'TRUE', ...this.span(token) }
    }

    if (token.type === 'IDENTIFIER') {
      this.advance()
      return { type: 'VariableExpr', name: token.lexeme, ...this.span(token) }
    }

    if (token.type === 'LBRACKET') return this.arrayLiteral()
    if (token.type === 'FN') return this.functionExpr()

    if (token.type === 'LPAREN') {
      this.advance()
      const expr = this.climb(0)
      if (this.peek().type !== 'RPAREN') throw this.expected("')'")
      this.advance()
      return expr
    }

    throw this.expected('an expression')
  }

  /** Calls, indexes, fields, and `Name { field: value }`. */
  private postfix(expr: Expr): Expr {
    for (;;) {
      if (this.check('LPAREN')) expr = this.finishCall(expr)
      else if (this.check('LBRACKET')) expr = this.finishIndex(expr)
      else if (this.check('DOT')) expr = this.finishField(expr)
      else if (expr.type === 'VariableExpr' && this.looksLikeRecord()) expr = this.recordLiteral(expr)
      else return expr
    }
  }

  /**
   * `Paddle { x: 1 }` is a record. `n { ... }` is a name and then a block,
   * so a brace starts a record only when a field and a colon follow.
   */
  private looksLikeRecord(): boolean {
    if (!this.check('LBRACE')) return false
    const field = this.tokens[this.current + 1]
    const colon = this.tokens[this.current + 2]
    if (field?.type === 'IDENTIFIER' && colon?.type === 'COLON') return true
    return !this.braceIsBlock && field?.type === 'RBRACE'
  }

  /** An expression that is followed by a block, so `name { }` stays a block. */
  private beforeBlock<T>(parse: () => T): T {
    const previous = this.braceIsBlock
    this.braceIsBlock = true
    try {
      return parse()
    } finally {
      this.braceIsBlock = previous
    }
  }

  private finishField(object: Expr): Expr {
    this.advance()
    const name = this.consume('IDENTIFIER', 'a field name')
    return {
      type: 'FieldExpr',
      object,
      name: name.lexeme,
      nameLine: name.line,
      nameColumn: name.column,
      line: object.line,
      column: object.column,
      endLine: name.line,
      endColumn: name.column + name.lexeme.length,
    }
  }

  /** `spawn Ball at (0px, 0px) { r: 2px }`. */
  private spawnExpr(): SpawnExpr {
    const keyword = this.advance()
    const name = this.consume('IDENTIFIER', 'an entity name')
    this.consume('AT', "'at'")
    this.consume('LPAREN', "'('")
    const x = this.climb(0)
    this.consume('COMMA', "','")
    const y = this.climb(0)
    this.consume('RPAREN', "')'")
    this.consume('LBRACE', "'{'")
    const fields: FieldInit[] = []
    const seen = new Set<string>()
    if (!this.check('RBRACE')) {
      fields.push(this.fieldInit(seen))
      while (this.check('COMMA')) {
        this.advance()
        fields.push(this.fieldInit(seen))
      }
    }
    this.consume('RBRACE', "'}'")
    return { type: 'SpawnExpr', name: name.lexeme, x, y, fields, ...this.span(keyword) }
  }

  private recordLiteral(name: Extract<Expr, { type: 'VariableExpr' }>): RecordExpr {
    this.advance()
    const fields: FieldInit[] = []
    const seen = new Set<string>()
    if (!this.check('RBRACE')) {
      fields.push(this.fieldInit(seen))
      while (this.check('COMMA')) {
        this.advance()
        fields.push(this.fieldInit(seen))
      }
    }
    this.consume('RBRACE', "'}'")
    const end = this.tokens[Math.max(this.current - 1, 0)]
    return {
      type: 'RecordExpr',
      name: name.name,
      fields,
      line: name.line,
      column: name.column,
      endLine: end.line,
      endColumn: end.column + end.lexeme.length,
    }
  }

  private fieldInit(seen: Set<string>): FieldInit {
    const token = this.consume('IDENTIFIER', 'a field name')
    if (seen.has(token.lexeme)) {
      throw new ParseError('E0109', `Field '${token.lexeme}' is repeated`, token.line, token.column)
    }
    seen.add(token.lexeme)
    this.consume('COLON', "':'")
    const value = this.climb(0)
    return { name: token.lexeme, value, line: token.line, column: token.column }
  }

  private mapLiteral(): MapExpr {
    const brace = this.advance()
    const entries: MapEntry[] = []
    const seen = new Set<string>()
    if (!this.check('RBRACE')) {
      entries.push(this.mapEntry(seen))
      while (this.check('COMMA')) {
        this.advance()
        entries.push(this.mapEntry(seen))
      }
    }
    this.consume('RBRACE', "'}'")
    return { type: 'MapExpr', entries, ...this.span(brace) }
  }

  private mapEntry(seen: Set<string>): MapEntry {
    const key = this.mapKey()
    if (seen.has(key.text)) {
      throw new ParseError('E0109', `Key '${key.text}' is repeated`, key.line, key.column)
    }
    seen.add(key.text)
    this.consume('COLON', "':'")
    const value = this.climb(0)
    return { key: key.text, value, line: key.line, column: key.column }
  }

  private mapKey(): { text: string; line: number; column: number } {
    const token = this.peek()
    if (token.type === 'IDENTIFIER') {
      this.advance()
      return { text: token.lexeme, line: token.line, column: token.column }
    }
    if (token.type === 'STRING' && typeof token.literal === 'string') {
      this.advance()
      return { text: token.literal, line: token.line, column: token.column }
    }
    throw this.expected('a key')
  }

  private template(): InterpExpr {
    const head = this.advance()
    const parts: InterpPart[] = [{ type: 'text', text: String(head.literal ?? '') }]
    for (;;) {
      parts.push({ type: 'hole', expr: this.climb(0) })
      if (this.check('TEMPLATE_MIDDLE')) {
        const mid = this.advance()
        parts.push({ type: 'text', text: String(mid.literal ?? '') })
        continue
      }
      const tail = this.consume('TEMPLATE_TAIL', 'the rest of the string')
      parts.push({ type: 'text', text: String(tail.literal ?? '') })
      return { type: 'InterpExpr', parts, ...this.span(head) }
    }
  }

  private matchExpr(): MatchExpr {
    const keyword = this.advance()
    const scrutinee = this.climb(0)
    this.consume('LBRACE', "'{'")
    if (this.check('RBRACE')) throw this.expected('a pattern')
    const arms: MatchArm[] = []
    while (!this.check('RBRACE') && !this.isAtEnd()) {
      const names = new Set<string>()
      const pattern = this.pattern(names)
      const arrow = this.consume('ARROW', "'=>'")
      const body = this.climb(0)
      arms.push({ pattern, body, line: arrow.line, column: arrow.column })
    }
    this.consume('RBRACE', "'}'")
    return { type: 'MatchExpr', scrutinee, arms, ...this.span(keyword) }
  }

  private pattern(names: Set<string>): Pattern {
    if (this.check('MINUS')) {
      const sign = this.advance()
      const token = this.consume('NUMBER', 'a number')
      if (typeof token.literal === 'number') {
        return { type: 'literal', value: -token.literal, line: sign.line, column: sign.column }
      }
      if (isQuantity(token.literal)) {
        return {
          type: 'quantity',
          value: -token.literal.value,
          unit: token.literal.unit,
          line: sign.line,
          column: sign.column,
        }
      }
      throw new ParseError('E0104', 'Expected a number', token.line, token.column)
    }

    const token = this.peek()
    if (token.type === 'NUMBER') {
      this.advance()
      if (typeof token.literal === 'number') {
        return { type: 'literal', value: token.literal, line: token.line, column: token.column }
      }
      if (isQuantity(token.literal)) {
        return {
          type: 'quantity',
          value: token.literal.value,
          unit: token.literal.unit,
          line: token.line,
          column: token.column,
        }
      }
      throw new ParseError('E0104', 'Expected a number', token.line, token.column)
    }
    if (token.type === 'STRING' && typeof token.literal === 'string') {
      this.advance()
      return { type: 'literal', value: token.literal, line: token.line, column: token.column }
    }
    if (token.type === 'TRUE' || token.type === 'FALSE') {
      this.advance()
      return { type: 'literal', value: token.type === 'TRUE', line: token.line, column: token.column }
    }
    if (token.type === 'IDENTIFIER' && token.lexeme === '_') {
      this.advance()
      return { type: 'wild', line: token.line, column: token.column }
    }
    if (token.type === 'IDENTIFIER' && token.lexeme === 'vec' && this.peekNext().type === 'LPAREN') {
      return this.vecPattern(names)
    }
    if (token.type === 'IDENTIFIER' && this.peekNext().type === 'LBRACE') {
      return this.recordPattern(names)
    }
    if (token.type === 'IDENTIFIER') {
      this.advance()
      this.bindName(token.lexeme, names, token)
      return { type: 'bind', name: token.lexeme, line: token.line, column: token.column }
    }
    throw this.expected('a pattern')
  }

  private vecPattern(names: Set<string>): Pattern {
    const token = this.advance()
    this.consume('LPAREN', "'('")
    const x = this.pattern(names)
    this.consume('COMMA', "','")
    const y = this.pattern(names)
    this.consume('RPAREN', "')'")
    return { type: 'vec', x, y, line: token.line, column: token.column }
  }

  private recordPattern(names: Set<string>): Pattern {
    const token = this.advance()
    this.consume('LBRACE', "'{'")
    const fields: { name: string; pattern: Pattern }[] = []
    const seen = new Set<string>()
    if (!this.check('RBRACE')) {
      fields.push(this.patternField(names, seen))
      while (this.check('COMMA')) {
        this.advance()
        fields.push(this.patternField(names, seen))
      }
    }
    this.consume('RBRACE', "'}'")
    return { type: 'record', name: token.lexeme, fields, line: token.line, column: token.column }
  }

  private patternField(names: Set<string>, seen: Set<string>): { name: string; pattern: Pattern } {
    const token = this.consume('IDENTIFIER', 'a field name')
    if (seen.has(token.lexeme)) {
      throw new ParseError('E0109', `Field '${token.lexeme}' is repeated`, token.line, token.column)
    }
    seen.add(token.lexeme)
    this.consume('COLON', "':'")
    return { name: token.lexeme, pattern: this.pattern(names) }
  }

  private bindName(name: string, names: Set<string>, token: Token): void {
    if (names.has(name)) {
      throw new ParseError('E0109', `Name '${name}' is bound twice in one pattern`, token.line, token.column)
    }
    names.add(name)
  }

  /** `[1, 2]`. The `[` has not been consumed yet. */
  private arrayLiteral(): ArrayExpr {
    const bracket = this.advance()
    const elements: Expr[] = []
    if (!this.check('RBRACKET')) {
      elements.push(this.climb(0))
      while (this.check('COMMA')) {
        this.advance()
        elements.push(this.climb(0))
      }
    }
    this.consume('RBRACKET', "']'")
    return { type: 'ArrayExpr', elements, ...this.span(bracket) }
  }

  /** `fn(x) { ... }`. The `fn` has not been consumed yet. There is no name. */
  private functionExpr(): FnExpr {
    const keyword = this.advance()
    this.consume('LPAREN', "'('")
    const params = this.parameterList()
    this.consume('RPAREN', "')'")
    this.fnDepth++
    const body = this.block()
    this.fnDepth--
    return { type: 'FnExpr', params, body, ...this.span(keyword) }
  }

  /** `items[i]`. The `[` has not been consumed yet. */
  private finishIndex(object: Expr): IndexExpr {
    this.advance()
    const index = this.climb(0)
    this.consume('RBRACKET', "']'")
    const end = this.tokens[Math.max(this.current - 1, 0)]
    return {
      type: 'IndexExpr',
      object,
      index,
      line: object.line,
      column: object.column,
      endLine: end.line,
      endColumn: end.column + end.lexeme.length,
    }
  }

  /** `callee(arg, arg, ...)`. The opening `(` has not been consumed yet. */
  private finishCall(callee: Expr): CallExpr {
    this.advance()
    const args: Expr[] = []
    if (!this.check('RPAREN')) {
      args.push(this.climb(0))
      while (this.check('COMMA')) {
        this.advance()
        args.push(this.climb(0))
      }
    }
    this.consume('RPAREN', "')'")
    const end = this.tokens[Math.max(this.current - 1, 0)]
    return {
      type: 'CallExpr',
      callee,
      args,
      line: callee.line,
      column: callee.column,
      endLine: end.line,
      endColumn: end.column + end.lexeme.length,
    }
  }

  /** True when the next token is a legal start for an expression. */
  private startsExpression(): boolean {
    return (
      this.check('NUMBER') ||
      this.check('STRING') ||
      this.check('TRUE') ||
      this.check('FALSE') ||
      this.check('IDENTIFIER') ||
      this.check('MINUS') ||
      this.check('NOT') ||
      this.check('LPAREN') ||
      this.check('LBRACKET') ||
      this.check('LBRACE') ||
      this.check('FN') ||
      this.check('MATCH') ||
      this.check('SPAWN') ||
      this.check('TEMPLATE_HEAD')
    )
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type
  }

  private consume(type: TokenType, what: string): Token {
    if (!this.check(type)) throw this.expected(what)
    return this.advance()
  }

  private peek(): Token {
    return this.tokens[this.current]
  }

  private peekNext(): Token {
    return this.tokens[Math.min(this.current + 1, this.tokens.length - 1)]
  }

  private advance(): Token {
    const token = this.peek()
    if (!this.isAtEnd()) this.current++
    return token
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'EOF'
  }

  /** Start at `start`, end just after the token most recently consumed. */
  private span(start: Token): SourceLocation {
    const end = this.tokens[Math.max(this.current - 1, 0)]
    return {
      line: start.line,
      column: start.column,
      endLine: end.line,
      endColumn: end.column + end.lexeme.length,
    }
  }

  private spanFrom(node: SourceLocation): SourceLocation {
    return {
      line: node.line,
      column: node.column,
      endLine: node.endLine ?? node.line,
      endColumn: node.endColumn ?? node.column,
    }
  }

  private expected(what: string): ParseError {
    const token = this.peek()
    const found = token.type === 'EOF' ? 'end of input' : `'${token.lexeme}'`
    return new ParseError('E0105', `Expected ${what}, got ${found}`, token.line, token.column)
  }

  private unexpected(): ParseError {
    const token = this.peek()
    if (token.type === 'EOF') {
      return new ParseError('E0106', 'Unexpected end of input', token.line, token.column)
    }
    return new ParseError('E0107', `Unexpected token '${token.lexeme}'`, token.line, token.column)
  }
}
