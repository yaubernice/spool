import { describe, expect, it } from 'vitest'
import { examples } from '../src/playground/examples.ts'
import { LexError, ParseError } from '../src/errors.ts'
import { parse } from '../src/parser.ts'
import { normalizeAst, spoolParse, type SpoolParseResult } from '../src/selfhost/parse.ts'

const malformed = [
  'let',
  'let =',
  'if true',
  'return 1',
  'forward',
  '1 +',
  '(1',
  'fn f(a, a) { }',
  'match x { }',
  '{ a: 1, a: 2 }',
]

const fixtures = [
  '',
  'fn() { return 1 }',
  'let x = 1',
  'let x = 1.5s',
  'let x = 120px',
  'let x = 80px/s',
  'let s = "hi"',
  'let s = "a\\nb"',
  'true',
  'false',
  '1 + 2 * 3',
  'not true and false',
  '-1 + 2',
  'forward 40',
  'goto 10 20',
  'penup',
  'print "hi"',
  'fn square(s) {\n  repeat 4 { forward s  turn 90 }\n}\nsquare(50)\n',
  'if true { 1 } else { 2 }',
  'while false { 1 }',
  'for i in 0..3 { i }',
  'for x in [1, 2] { x }',
  'let a = [1, 2]\na[0] = 3',
  'let m = { a: 1, "b": 2 }',
  'record Paddle { x, y }\nPaddle { x: 1, y: 2 }',
  'use turtle',
  'fn f() { return 1 }\nf()',
  'fn f() { return }\nf()',
  'let f = fn(x) { return x + 1 }\nf(2)',
  'match n { 0 => "zero" n => "other" }',
  'draw.text(0px, 0px, "{score}", "#fff")',
  'entity Ball { r }\nspawn Ball at (0px, 0px) { r: 2px }',
  'on start { }\non tick(dt) { }\non key "space" { }',
  'n += 1\nn -= 1\nn *= 2',
  'player.x = 1\nplayer.x += 2',
  ...examples.map((example) => example.code),
]

describe('self-hosted parser differential', () => {
  const compared = fixtures.length + malformed.length

  it(`matches TypeScript on ${fixtures.length} programs and ${malformed.length} malformed inputs (${compared} total)`, () => {
    let n = 0
    for (const source of fixtures) {
      const ts = tsParse(source)
      const sp = spoolParse(source)
      expect(sp, preview(source)).toEqual(ts)
      n++
    }
    for (const source of malformed) {
      const ts = tsParse(source)
      const sp = spoolParse(source)
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

function tsParse(source: string): SpoolParseResult {
  try {
    return { ok: true, program: normalizeAst(parse(source)) }
  } catch (error) {
    if (error instanceof LexError || error instanceof ParseError) {
      return {
        ok: false,
        code: error.code,
        detail: error.detail,
        line: error.line,
        column: error.column,
      }
    }
    throw error
  }
}

function preview(source: string): string {
  return source.length > 60 ? `${JSON.stringify(source.slice(0, 60))}…` : JSON.stringify(source)
}
