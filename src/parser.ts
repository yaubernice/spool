import type {
  BinaryOp,
  BlockStmt,
  CallExpr,
  Expr,
  ExprStmt,
  FnStmt,
  IfStmt,
  LetStmt,
  Parameter,
  Program,
  RepeatStmt,
  ReturnStmt,
  Stmt,
  UnaryOp,
  WhileStmt,
} from './ast.ts'
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
 *   or                 1
 *   and                2
 *   not                3   prefix
 *   == != < > <= >=    4
 *   + -                5
 *   * / %              6
 *   -                  7   prefix, unary minus
 *   number, string, name, name(...), ( )
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

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  parseProgram(): Program {
    const start = this.peek()
    const body: Stmt[] = []
    while (!this.isAtEnd()) body.push(this.statement())
    return { type: 'Program', body, line: start.line, column: start.column }
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
    if (this.check('FN')) return this.fnStatement()
    if (this.check('RETURN')) return this.returnStatement()
    const command = this.commandStatement()
    if (command) return command
    return this.expressionStatement()
  }

  /** `let size = 50`. The `=` and the value are required. */
  private letStatement(): LetStmt {
    const keyword = this.advance()
    const name = this.consume('IDENTIFIER', 'a variable name')
    this.consume('ASSIGN', "'='")
    return {
      type: 'LetStmt',
      name: name.lexeme,
      value: this.climb(0),
      line: keyword.line,
      column: keyword.column,
    }
  }

  /** `if cond { ... }` or `if cond { ... } else { ... }`. */
  private ifStatement(): IfStmt {
    const keyword = this.advance()
    const condition = this.climb(0)
    const thenBranch = this.block()
    let elseBranch: BlockStmt | null = null
    if (this.check('ELSE')) {
      this.advance()
      elseBranch = this.block()
    }
    return {
      type: 'IfStmt',
      condition,
      thenBranch,
      elseBranch,
      line: keyword.line,
      column: keyword.column,
    }
  }

  /** `while cond { ... }`. */
  private whileStatement(): WhileStmt {
    const keyword = this.advance()
    return {
      type: 'WhileStmt',
      condition: this.climb(0),
      body: this.block(),
      line: keyword.line,
      column: keyword.column,
    }
  }

  /** `repeat n { ... }`. The count is an expression, not just a literal. */
  private repeatStatement(): RepeatStmt {
    const keyword = this.advance()
    return {
      type: 'RepeatStmt',
      count: this.climb(0),
      body: this.block(),
      line: keyword.line,
      column: keyword.column,
    }
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
        throw new ParseError("Expected '}' before 'else'", this.peek().line, this.peek().column)
      }
      statements.push(this.statement())
    }
    this.consume('RBRACE', "'}'")
    return { type: 'BlockStmt', statements, line: brace.line, column: brace.column }
  }

  /** `fn square(s) { ... }`. Parameters are names separated by commas. */
  private fnStatement(): FnStmt {
    const keyword = this.advance()
    const name = this.consume('IDENTIFIER', 'a function name')
    this.consume('LPAREN', "'('")
    const params: Parameter[] = []
    if (!this.check('RPAREN')) {
      params.push(this.parameter(params))
      while (this.check('COMMA')) {
        this.advance()
        params.push(this.parameter(params))
      }
    }
    this.consume('RPAREN', "')'")

    this.fnDepth++
    const body = this.block()
    this.fnDepth--

    return {
      type: 'FnStmt',
      name: name.lexeme,
      params,
      body,
      line: keyword.line,
      column: keyword.column,
    }
  }

  private parameter(soFar: Parameter[]): Parameter {
    const token = this.consume('IDENTIFIER', 'a parameter name')
    if (soFar.some((param) => param.name === token.lexeme)) {
      throw new ParseError(`Duplicate parameter '${token.lexeme}'`, token.line, token.column)
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
      throw new ParseError('return must be inside a function', keyword.line, keyword.column)
    }
    return {
      type: 'ReturnStmt',
      value: this.startsExpression() ? this.climb(0) : null,
      line: keyword.line,
      column: keyword.column,
    }
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
    if (arity === undefined || this.peekNext().type === 'LPAREN') return null

    this.advance()
    const args: Expr[] = []
    for (let i = 0; i < arity; i++) args.push(this.climb(0))
    return {
      type: 'ExprStmt',
      expression: {
        type: 'CallExpr',
        callee: name.lexeme,
        args,
        line: name.line,
        column: name.column,
      },
      line: name.line,
      column: name.column,
    }
  }

  /** An expression standing alone, such as `size + 1` or `square(100)`. */
  private expressionStatement(): ExprStmt {
    const expression = this.climb(0)
    return {
      type: 'ExprStmt',
      expression,
      line: expression.line,
      column: expression.column,
    }
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
    return {
      type: 'UnaryExpr',
      operator: unary.operator,
      operand: this.climb(unary.precedence),
      line: token.line,
      column: token.column,
    }
  }

  /** A number, string, name, or a parenthesized expression. */
  private primary(): Expr {
    const token = this.peek()

    if (token.type === 'NUMBER' || token.type === 'STRING') {
      this.advance()
      if (typeof token.literal !== 'number' && typeof token.literal !== 'string') {
        throw new ParseError('Expected a literal value', token.line, token.column)
      }
      return {
        type: 'LiteralExpr',
        value: token.literal,
        line: token.line,
        column: token.column,
      }
    }

    if (token.type === 'IDENTIFIER') {
      this.advance()
      if (this.check('LPAREN')) return this.finishCall(token)
      return {
        type: 'VariableExpr',
        name: token.lexeme,
        line: token.line,
        column: token.column,
      }
    }

    if (token.type === 'LPAREN') {
      this.advance()
      const expr = this.climb(0)
      if (this.peek().type !== 'RPAREN') throw this.expected("')'")
      this.advance()
      return expr
    }

    throw this.expected('an expression')
  }

  /** `name(arg, arg, ...)`. The opening `(` has not been consumed yet. */
  private finishCall(name: Token): CallExpr {
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
    return {
      type: 'CallExpr',
      callee: name.lexeme,
      args,
      line: name.line,
      column: name.column,
    }
  }

  /** True when the next token is a legal start for an expression. */
  private startsExpression(): boolean {
    return (
      this.check('NUMBER') ||
      this.check('STRING') ||
      this.check('IDENTIFIER') ||
      this.check('MINUS') ||
      this.check('NOT') ||
      this.check('LPAREN')
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

  private expected(what: string): ParseError {
    const token = this.peek()
    const found = token.type === 'EOF' ? 'end of input' : `'${token.lexeme}'`
    return new ParseError(`Expected ${what}, got ${found}`, token.line, token.column)
  }

  private unexpected(): ParseError {
    const token = this.peek()
    if (token.type === 'EOF') {
      return new ParseError('Unexpected end of input', token.line, token.column)
    }
    return new ParseError(`Unexpected token '${token.lexeme}'`, token.line, token.column)
  }
}
