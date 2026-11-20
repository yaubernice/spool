/**
 * An error that points at a place in the source.
 * Line and column are 1-based. The message includes them so a thrown
 * error is readable in a test failure or the console.
 *
 * Runtime errors use this same shape.
 */
export class SourceError extends Error {
  readonly line: number
  readonly column: number

  constructor(message: string, line: number, column: number) {
    super(`${message} (line ${line}, column ${column})`)
    this.name = new.target.name
    this.line = line
    this.column = column
  }
}

/** The lexer found a character or string it cannot turn into a token. */
export class LexError extends SourceError {}

/** The parser found tokens that do not form a valid expression or statement. */
export class ParseError extends SourceError {}

/** The interpreter found a problem while running the program. */
export class RuntimeError extends SourceError {}
