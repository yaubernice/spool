import { quantity, unitFromSuffix, type Quantity } from './data.ts'
import { LexError, presentError } from './errors.ts'

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
  | 'FOR'
  | 'IN'
  | 'FN'
  | 'RETURN'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'TRUE'
  | 'FALSE'
  | 'RECORD'
  | 'MATCH'
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
  | 'LBRACKET'
  | 'RBRACKET'
  | 'COMMA'
  | 'DOT' // .
  | 'DOTDOT' // ..
  | 'COLON' // :
  | 'ARROW' // =>
  | 'PIPE' // |>
  | 'TEMPLATE_HEAD'
  | 'TEMPLATE_MIDDLE'
  | 'TEMPLATE_TAIL'
  | 'EOF'

export interface Token {
  type: TokenType
  /** Exact source text for this token, e.g. `"hi"` or `==`. Empty for EOF. */
  lexeme: string
  /** Interpreted value for numbers, quantities, and strings. Null for everything else. */
  literal: number | string | Quantity | null
  line: number
  column: number
}

const KEYWORDS: Readonly<Record<string, TokenType>> = {
  let: 'LET',
  if: 'IF',
  else: 'ELSE',
  while: 'WHILE',
  repeat: 'REPEAT',
  for: 'FOR',
  in: 'IN',
  fn: 'FN',
  return: 'RETURN',
  and: 'AND',
  or: 'OR',
  not: 'NOT',
  true: 'TRUE',
  false: 'FALSE',
  record: 'RECORD',
  match: 'MATCH',
}

/** Turn source text into tokens. Throws LexError on bad input. */
export function tokenize(source: string): Token[] {
  try {
    return new Lexer(source).tokenize()
  } catch (error) {
    if (error instanceof LexError) throw presentError(error, source)
    throw error
  }
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
      case '[':
        return this.addToken('LBRACKET')
      case ']':
        return this.addToken('RBRACKET')
      case ',':
        return this.addToken('COMMA')
      case '.':
        return this.addToken(this.match('.') ? 'DOTDOT' : 'DOT')
      case ':':
        return this.addToken('COLON')
      case '|':
        if (this.match('>')) return this.addToken('PIPE')
        throw this.error("Unexpected character '|'")
      case '=':
        if (this.match('>')) return this.addToken('ARROW')
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
    } else if (this.peek() === '.' && this.peekNext() !== '.') {
      throw new LexError('E0001', "Unexpected character '.'", this.line, this.column)
    }

    const suffix = this.unitSuffix()
    const lexeme = this.source.slice(this.start, this.current)
    const numeric = Number(lexeme.slice(0, lexeme.length - suffix.length))
    this.addToken('NUMBER', suffix === '' ? numeric : quantity(numeric, unitFromSuffix(suffix)))
  }

  /**
   * A unit stuck to a number: `1.5s`, `120px`, `80px/s`.
   * A space, or a longer word such as `1score`, leaves the number plain.
   */
  private unitSuffix(): string {
    const rest = this.source.slice(this.current)
    if (rest.startsWith('px/s') && !isAlphaNumeric(rest[4] ?? '')) {
      for (let i = 0; i < 4; i++) this.advance()
      return 'px/s'
    }
    if (rest.startsWith('px') && !isAlphaNumeric(rest[2] ?? '')) {
      this.advance()
      this.advance()
      return 'px'
    }
    if (rest.startsWith('s') && !isAlphaNumeric(rest[1] ?? '')) {
      this.advance()
      return 's'
    }
    return ''
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
    const startColumn = this.tokenColumn
    let value = ''
    let templated = false
    let pieceLine = this.line
    let pieceColumn = this.column

    const emitPiece = (type: 'TEMPLATE_HEAD' | 'TEMPLATE_MIDDLE' | 'TEMPLATE_TAIL', line: number, column: number) => {
      this.tokens.push({ type, lexeme: value, literal: value, line, column })
    }

    while (!this.isAtEnd() && this.peek() !== '"') {
      if (this.peek() === '\n' || this.peek() === '\r') break

      if (this.peek() === '{') {
        emitPiece(templated ? 'TEMPLATE_MIDDLE' : 'TEMPLATE_HEAD', templated ? pieceLine : startLine, templated ? pieceColumn : startColumn)
        templated = true
        const holeLine = this.line
        const holeColumn = this.column
        this.advance()
        value = ''
        this.scanHole(holeLine, holeColumn)
        pieceLine = this.line
        pieceColumn = this.column
        continue
      }

      if (this.peek() === '\\') {
        const escapeColumn = this.column
        this.advance()
        const esc = this.peek()
        if (esc === '' || esc === '\n' || esc === '\r') {
          throw new LexError('E0002', 'Unterminated string escape', this.line, escapeColumn)
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
          case '{':
            value += '{'
            break
          case '}':
            value += '}'
            break
          default:
            throw new LexError('E0003', `Unknown string escape '\\${esc}'`, this.line, escapeColumn)
        }
      } else {
        value += this.advance()
      }
    }

    if (this.peek() !== '"') {
      throw new LexError('E0004', 'Unterminated string. Add a closing quote', startLine, startColumn)
    }
    this.advance()
    if (!templated) {
      this.addToken('STRING', value)
      return
    }
    emitPiece('TEMPLATE_TAIL', pieceLine, pieceColumn)
  }

  /** Tokens inside `{ ... }` of a string, up to the brace that closes the hole. */
  private scanHole(line: number, column: number): void {
    let depth = 1
    while (depth > 0) {
      this.skipWhitespaceAndComments()
      if (this.isAtEnd()) {
        throw new LexError('E0005', 'Unterminated interpolation. Add a closing }', line, column)
      }
      this.start = this.current
      this.tokenColumn = this.column
      const before = this.tokens.length
      this.scanToken()
      for (const token of this.tokens.slice(before)) {
        if (token.type === 'LBRACE') depth++
        if (token.type === 'RBRACE') depth--
      }
    }
    this.tokens.pop()
  }

  private addToken(type: TokenType, literal: number | string | Quantity | null = null): void {
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
    return new LexError('E0001', message, this.line, this.column - 1)
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
