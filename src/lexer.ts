import { LexError } from './errors.ts'

/**
 * Lexer: source text → tokens.
 *
 * The parser never sees raw characters. It sees this list, which always
 * ends with an EOF token. Whitespace and `#` comments are skipped.
 * Every token records the line and column (1-based) where it starts.
 */

export type TokenType =
  | 'NUMBER'
  | 'STRING'
  | 'IDENTIFIER'
  | 'LET'
  | 'IF'
  | 'ELSE'
  | 'WHILE'
  | 'REPEAT'
  | 'FN'
  | 'RETURN'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'PLUS'
  | 'MINUS'
  | 'STAR'
  | 'SLASH'
  | 'PERCENT'
  | 'ASSIGN' // =
  | 'EQ' // ==
  | 'NOT_EQ' // !=
  | 'LT'
  | 'GT'
  | 'LTE'
  | 'GTE'
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACE'
  | 'RBRACE'
  | 'COMMA'
  | 'EOF'

export interface Token {
  type: TokenType
  /** Exact source text for this token, e.g. `"hi"` or `==`. Empty for EOF. */
  lexeme: string
  /** Interpreted value for numbers and strings. Null for everything else. */
  literal: number | string | null
  line: number
  column: number
}

const KEYWORDS: Readonly<Record<string, TokenType>> = {
  let: 'LET',
  if: 'IF',
  else: 'ELSE',
  while: 'WHILE',
  repeat: 'REPEAT',
  fn: 'FN',
  return: 'RETURN',
  and: 'AND',
  or: 'OR',
  not: 'NOT',
}

/** Turn source text into tokens. Throws LexError on bad input. */
export function tokenize(source: string): Token[] {
  return new Lexer(source).tokenize()
}

class Lexer {
  private readonly source: string
  private readonly tokens: Token[] = []
  /** Index of the first character of the token we are scanning. */
  private start = 0
  /** Index of the next character to read. */
  private current = 0
  private line = 1
  private column = 1
  /** Column where the current token started. */
  private tokenColumn = 1

  constructor(source: string) {
    this.source = source
  }

  tokenize(): Token[] {
    while (!this.isAtEnd()) {
      this.skipWhitespaceAndComments()
      if (this.isAtEnd()) break
      this.start = this.current
      this.tokenColumn = this.column
      this.scanToken()
    }

    this.tokens.push({
      type: 'EOF',
      lexeme: '',
      literal: null,
      line: this.line,
      column: this.column,
    })
    return this.tokens
  }

  /**
   * Spaces, tabs, and newlines separate tokens but are not tokens.
   * A `#` comment runs to the end of the line and is discarded too.
   */
  private skipWhitespaceAndComments(): void {
    while (!this.isAtEnd()) {
      const c = this.peek()
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        this.advance()
      } else if (c === '#') {
        while (!this.isAtEnd() && this.peek() !== '\n' && this.peek() !== '\r') {
          this.advance()
        }
      } else {
        return
      }
    }
  }

  /** Read one token, starting at the current character. */
  private scanToken(): void {
    const c = this.advance()
    switch (c) {
      case '+':
        return this.addToken('PLUS')
      case '-':
        return this.addToken('MINUS')
      case '*':
        return this.addToken('STAR')
      case '/':
        return this.addToken('SLASH')
      case '%':
        return this.addToken('PERCENT')
      case '(':
        return this.addToken('LPAREN')
      case ')':
        return this.addToken('RPAREN')
      case '{':
        return this.addToken('LBRACE')
      case '}':
        return this.addToken('RBRACE')
      case ',':
        return this.addToken('COMMA')
      case '=':
        return this.addToken(this.match('=') ? 'EQ' : 'ASSIGN')
      case '<':
        return this.addToken(this.match('=') ? 'LTE' : 'LT')
      case '>':
        return this.addToken(this.match('=') ? 'GTE' : 'GT')
      case '!':
        if (this.match('=')) return this.addToken('NOT_EQ')
        throw this.error("Unexpected character '!'")
      case '"':
        return this.string()
      default:
        if (isDigit(c)) return this.number()
        if (isAlpha(c)) return this.identifier()
        throw this.error(`Unexpected character '${c}'`)
    }
  }

  /** Digits, optionally with one decimal point: `50`, `3.14`. */
  private number(): void {
    while (isDigit(this.peek())) this.advance()

    if (this.peek() === '.' && isDigit(this.peekNext())) {
      this.advance()
      while (isDigit(this.peek())) this.advance()
    }

    const lexeme = this.source.slice(this.start, this.current)
    this.addToken('NUMBER', Number(lexeme))
  }

  /**
   * A word is an identifier, unless it is a reserved keyword
   * (`let`, `if`, `and`, …). Turtle commands like `forward` stay identifiers.
   */
  private identifier(): void {
    while (isAlphaNumeric(this.peek())) this.advance()
    const lexeme = this.source.slice(this.start, this.current)
    this.addToken(KEYWORDS[lexeme] ?? 'IDENTIFIER')
  }

  /**
   * A double-quoted string. The lexeme keeps the quotes and escapes;
   * the literal is the decoded text. Recognized escapes: `\"` `\\` `\n` `\t`.
   */
  private string(): void {
    const startLine = this.line
    let value = ''

    while (!this.isAtEnd() && this.peek() !== '"') {
      if (this.peek() === '\n' || this.peek() === '\r') break

      if (this.peek() === '\\') {
        const escapeColumn = this.column
        this.advance()
        const esc = this.peek()
        if (esc === '' || esc === '\n' || esc === '\r') {
          throw new LexError('Unterminated string escape', this.line, escapeColumn)
        }
        this.advance()
        switch (esc) {
          case 'n':
            value += '\n'
            break
          case 't':
            value += '\t'
            break
          case '\\':
            value += '\\'
            break
          case '"':
            value += '"'
            break
          default:
            throw new LexError(
              `Unknown string escape '\\${esc}'`,
              this.line,
              escapeColumn,
            )
        }
      } else {
        value += this.advance()
      }
    }

    if (this.peek() !== '"') {
      throw new LexError('Unterminated string', startLine, this.tokenColumn)
    }
    this.advance()
    this.addToken('STRING', value)
  }

  private addToken(type: TokenType, literal: number | string | null = null): void {
    this.tokens.push({
      type,
      lexeme: this.source.slice(this.start, this.current),
      literal,
      line: this.line,
      column: this.tokenColumn,
    })
  }

  /** Consume the next character if it is `expected`. Used for two-character operators. */
  private match(expected: string): boolean {
    if (this.peek() !== expected) return false
    this.advance()
    return true
  }

  private advance(): string {
    const c = this.source[this.current]
    this.current++
    if (c === '\n') {
      this.line++
      this.column = 1
    } else if (c === '\r') {
      // `\r\n` is one line break. A lone `\r` is also a line break.
      if (this.peek() === '\n') this.current++
      this.line++
      this.column = 1
    } else {
      this.column++
    }
    return c
  }

  private peek(): string {
    if (this.isAtEnd()) return ''
    return this.source[this.current]
  }

  private peekNext(): string {
    if (this.current + 1 >= this.source.length) return ''
    return this.source[this.current + 1]
  }

  private isAtEnd(): boolean {
    return this.current >= this.source.length
  }

  /** The character we just consumed sits one column behind `this.column`. */
  private error(message: string): LexError {
    return new LexError(message, this.line, this.column - 1)
  }
}

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9'
}

function isAlpha(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'
}

function isAlphaNumeric(c: string): boolean {
  return isAlpha(c) || isDigit(c)
}
