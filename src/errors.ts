/**
 * An error that points at a place in the source.
 * Line and column are 1-based.
 *
 * `detail` is the sentence ("Division by zero").
 * `message` starts as that sentence plus the location. The public entry
 * points (`tokenize`, `parse`, `interpret`) replace `message` with the
 * report from `formatError`, which also shows the source line and a caret.
 */
export class SourceError extends Error {
  readonly detail: string
  readonly line: number
  readonly column: number

  constructor(detail: string, line: number, column: number) {
    super(`${detail} (line ${line}, column ${column})`)
    this.name = new.target.name
    this.detail = detail
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

/**
 * A multi-line report: the sentence, then the source line, then a caret.
 *
 * A tab counts as one column in the lexer, so it is shown as one space
 * here and the caret stays under the right character.
 */
export function formatError(error: SourceError, source: string): string {
  const lines = source.split('\n').map((line) => line.replace(/\r$/, ''))
  const shown = (lines[error.line - 1] ?? '').replaceAll('\t', ' ')
  const column = error.column < 1 ? 1 : error.column
  const caret = `${' '.repeat(column - 1)}^`
  const lineNo = String(error.line)
  const pad = ' '.repeat(lineNo.length)
  return [
    `${error.name}: ${error.detail} (line ${error.line}, column ${error.column})`,
    ` ${lineNo} | ${shown}`,
    ` ${pad} | ${caret}`,
  ].join('\n')
}

/** Replace `error.message` with the source report and return the same error. */
export function presentError<T extends SourceError>(error: T, source: string): T {
  error.message = formatError(error, source)
  return error
}
