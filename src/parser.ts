import type { BinaryOp, Expr, UnaryOp } from './ast.ts'
import { ParseError } from './errors.ts'
import { tokenize, type Token, type TokenType } from './lexer.ts'

/**
 * Parser: tokens → AST.
 *
 * This phase reads expressions. Statements (let, if, while, …) come next.
 * A name is a variable for now. Calls such as `square(100)` come with functions.
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
 *   number, string, name, ( )
 */

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

/** Parse one expression and reject any leftover tokens. */
export function parseExpression(source: string): Expr {
  return new Parser(tokenize(source)).parseExpression()
}

class Parser {
  private readonly tokens: Token[]
  private current = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  parseExpression(): Expr {
    const expr = this.climb(0)
    if (!this.isAtEnd()) throw this.unexpected()
    return expr
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

  private peek(): Token {
    return this.tokens[this.current]
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
