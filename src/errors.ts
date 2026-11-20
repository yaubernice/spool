/**
 * An error that points at a place in the source.
 * Line and column are 1-based. The message also includes them so a
 * thrown error is readable in a test failure or the console.
 *
 * Parse and runtime errors will use this same shape in a later phase.
 */
export class LexError extends Error {
  readonly line: number
  readonly column: number

  constructor(message: string, line: number, column: number) {
    super(`${message} (line ${line}, column ${column})`)
    this.name = 'LexError'
    this.line = line
    this.column = column
  }
}
