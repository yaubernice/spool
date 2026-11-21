import { describe, expect, it } from 'vitest'
import { LexError } from '../src/errors.ts'
import { tokenize } from '../src/lexer.ts'
import { spoolTokenize } from '../src/selfhost/lex.ts'

describe('self-hosted lexer smoke', () => {
  for (const source of ['let x = 1', '1.5s', '"hi"', 'forward 40', 'a + b', '"a{x}b"', '1..3']) {
    it(`matches TypeScript on ${JSON.stringify(source)}`, () => {
      const ts = tsLex(source)
      const sp = spoolTokenize(source)
      expect(sp).toEqual(ts)
    })
  }

  it('matches an unexpected character error', () => {
    expect(spoolTokenize('@')).toEqual(tsLex('@'))
  })
})

function tsLex(source: string) {
  try {
    return {
      ok: true as const,
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
      ok: false as const,
      code: error.code,
      detail: error.detail,
      line: error.line,
      column: error.column,
    }
  }
}
