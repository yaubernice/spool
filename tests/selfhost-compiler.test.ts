import { describe, expect, it } from 'vitest'
import { compile as tsCompile } from '../src/compile.ts'
import { LexError, ParseError } from '../src/errors.ts'
import { parse } from '../src/parser.ts'
import { examples } from '../src/playground/examples.ts'
import {
  compilerSpoolSource,
  normalizeChunk,
  spoolCompile,
  type SpoolCompileResult,
} from '../src/selfhost/compile.ts'

const fixtures = [
  '',
  '1',
  'true',
  'false',
  'let x = 1',
  'let x = 1.5s',
  'let x = 120px',
  'let x = 80px/s',
  'let s = "hi"',
  '1 + 2 * 3',
  'not true and false',
  '-1 + 2',
  'if true { 1 } else { 2 }',
  'while false { 1 }',
  'repeat 3 { 1 }',
  'for i in 0..3 { i }',
  'for x in [1, 2] { x }',
  'let a = [1, 2]\na[0] = 3',
  'let m = { a: 1, "b": 2 }',
  'fn f() { return 1 }\nf()',
  'fn f() { return }\nf()',
  'let f = fn(x) { return x + 1 }\nf(2)',
  'fn square(s) {\n  repeat 4 { forward s  turn 90 }\n}\nsquare(50)\n',
  'forward 40',
  'goto 10 20',
  'use turtle',
  'record Paddle { x, y }\nPaddle { x: 1, y: 2 }',
  'match n { 0 => "zero" n => "other" }',
  'n += 1\nn -= 1\nn *= 2',
  'player.x = 1\nplayer.x += 2',
  'draw.text(0px, 0px, "{score}", "#fff")',
  'entity Ball { r }\nspawn Ball at (0px, 0px) { r: 2px }',
  'on start { }\non tick(dt) { }\non key "space" { }',
  '1 + 2 |> abs',
]

const gallery = examples.map((example) => example.code)

const programs = [...fixtures, ...gallery]

describe('self-hosted compiler differential', () => {
  it(`matches TypeScript on ${programs.length} programs`, () => {
    let n = 0
    for (const source of programs) {
      const ts = tsCompileSource(source)
      const sp = spoolCompile(source)
      expect(sp, preview(source)).toEqual(ts)
      n++
    }
    expect(n).toBe(programs.length)
  })
})

describe('self-hosted compiler bootstrap', () => {
  it('stage1 TypeScript compile of compiler.spool equals stage2 Spool compile of the same source', () => {
    const source = compilerSpoolSource
    const stage1 = tsCompileSource(source)
    const stage2 = spoolCompile(source)
    expect(stage1.ok).toBe(true)
    expect(stage2.ok).toBe(true)
    if (stage1.ok && stage2.ok) {
      expect(stage2.chunk).toEqual(stage1.chunk)
    }
  })
})

function tsCompileSource(source: string): SpoolCompileResult {
  try {
    return { ok: true, chunk: normalizeChunk(tsCompile(parse(source))) }
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
  const oneLine = source.replace(/\n/g, '\\n')
  return oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine
}
