/**
 * An error that points at a place in the source.
 * Line and column are 1-based. `code` is a stable id such as `E0203`.
 *
 * `detail` is the sentence ("Division by zero").
 * `message` starts as that sentence plus the location. The public entry
 * points (`tokenize`, `parse`, `interpret`) replace `message` with the
 * report from `formatError`, which also shows the source line and a caret.
 */
export class SourceError extends Error {
  readonly code: string
  readonly detail: string
  readonly line: number
  readonly column: number

  constructor(code: string, detail: string, line: number, column: number) {
    super(`${detail} (line ${line}, column ${column})`)
    this.name = new.target.name
    this.code = code
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
 * A multi-line report: the code and sentence, then the source line, then a caret.
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
    `${error.name} ${error.code}: ${error.detail} (line ${error.line}, column ${error.column})`,
    ` ${lineNo} | ${shown}`,
    ` ${pad} | ${caret}`,
  ].join('\n')
}

/** Replace `error.message` with the source report and return the same error. */
export function presentError<T extends SourceError>(error: T, source: string): T {
  error.message = formatError(error, source)
  return error
}

/**
 * Closest name within two edits, for "Did you mean".
 * Names shorter than 3 characters are skipped: `y` is one edit from every
 * other letter, and that hint is noise.
 */
export function suggestName(typed: string, names: readonly string[]): string | null {
  if (typed.length < 3) return null
  let best: string | null = null
  let bestDistance = 3
  for (const name of names) {
    if (name === typed || name.length < 3) continue
    const distance = levenshtein(typed, name)
    if (distance < bestDistance) {
      best = name
      bestDistance = distance
    }
  }
  return best
}

/** Edit distance. Used only for short names, so the table stays tiny. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const rows = a.length + 1
  const cols = b.length + 1
  const table = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  for (let i = 0; i < rows; i++) table[i][0] = i
  for (let j = 0; j < cols; j++) table[0][j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      table[i][j] = Math.min(table[i - 1][j] + 1, table[i][j - 1] + 1, table[i - 1][j - 1] + cost)
    }
  }
  return table[a.length][b.length]
}
