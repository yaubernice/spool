import { describe, expect, it } from 'vitest'
import { examples } from '../src/playground/examples.ts'
import { LexError } from '../src/errors.ts'
import { tokenize } from '../src/lexer.ts'
import { spoolTokenize, type SpoolLexResult } from '../src/selfhost/lex.ts'

const malformed = [
  '@',
  '!',
  '|',
  '1.',
  '1.x',
  'let s = "hi',
  '"\\q"',
  '"hi\n"',
  'let y = @',
  '"\\',
  '"{',
  '"a{',
  '"a{1"',
]

const fixtures = [
  '',
  '# only comment',
  'let x = 1',
  '1.5s 120px 80px/s',
  '"hello"',
  '""',
  '"say \\"hi\\"\\n\\t\\\\"',
  'forward 40',
  'a == b != c <= d >= e',
  '+= -= *= |> =>',
  '1..3',
  'let x = 1 # ignore\nlet y = 2',
  '  let',
  'let x = 1\nlet y = 2',
  'let\n',
  'let\r\ny',
  'true false and or not',
  'fn square(s) {\n  repeat 4 { forward s  turn 90 }\n}\n',
  '"a{x}b"',
  '"\\{kept\\}"',
  'letter note trueish',
  ...examples.map((example) => example.code),
]

describe('self-hosted lexer differential', () => {
  const compared = fixtures.length + malformed.length

  it(`matches TypeScript on ${fixtures.length} programs and ${malformed.length} malformed inputs (${compared} total)`, () => {
    let n = 0
    for (const source of fixtures) {
      expect(spoolTokenize(source), preview(source)).toEqual(tsLex(source))
      n++
    }
    for (const source of malformed) {
      const ts = tsLex(source)
      const sp = spoolTokenize(source)
      expect(sp.ok, preview(source)).toBe(false)
      expect(ts.ok, preview(source)).toBe(false)
      if (!sp.ok && !ts.ok) {
        expect({ code: sp.code, line: sp.line, column: sp.column }, preview(source)).toEqual({
          code: ts.code,
          line: ts.line,
          column: ts.column,
        })
      }
      n++
    }
    expect(n).toBe(compared)
  })
})

function tsLex(source: string): SpoolLexResult {
  try {
    return {
      ok: true,
      tokens: tokenize(source).map((token) => ({
        type: token.type,
        lexeme: token.lexeme,
        line: token.line,
        column: token.column,
      })),
    }
  } catch (error) {
    if (!(error instanceof LexError)) throw error
    return {
      ok: false,
      code: error.code,
      detail: error.detail,
      line: error.line,
      column: error.column,
    }
  }
}

function preview(source: string): string {
  return source.length > 60 ? `${JSON.stringify(source.slice(0, 60))}…` : JSON.stringify(source)
}
