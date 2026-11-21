import { describe, expect, it } from 'vitest'
import { isQuantity } from '../src/data.ts'
import { ParseError, RuntimeError } from '../src/errors.ts'
import { interpret as interpretTree } from '../src/interpreter.ts'
import { tokenize } from '../src/lexer.ts'
import { parse, parseExpression } from '../src/parser.ts'
import { interpretVm } from '../src/vm.ts'

const engines = [
  ['tree-walker', interpretTree],
  ['vm', interpretVm],
] as const

function quantity(value: number, px: number, s: number) {
  return { type: 'quantity', value, unit: { px, s } }
}

describe('lexer', () => {
  it('reads units, fields, pipes, and interpolation', () => {
    const units = tokenize('1.5s 120px 80px/s')
    expect(units.slice(0, 3).map((token) => token.literal)).toEqual([
      quantity(1.5, 0, 1),
      quantity(120, 1, 0),
      quantity(80, 1, -1),
    ])
    expect(tokenize('3.14')[0].literal).toBe(3.14)
    expect(tokenize('p.x').map((token) => token.type).slice(0, 3)).toEqual(['IDENTIFIER', 'DOT', 'IDENTIFIER'])
    expect(tokenize('|> =>').map((token) => token.type).slice(0, 2)).toEqual(['PIPE', 'ARROW'])
    const hole = tokenize('"score: {n}"')
    expect(hole.map((token) => token.type).slice(0, 3)).toEqual(['TEMPLATE_HEAD', 'IDENTIFIER', 'TEMPLATE_TAIL'])
    expect(hole[0].literal).toBe('score: ')
    expect(tokenize('"\\{score\\}"')[0]).toMatchObject({ type: 'STRING', literal: '{score}' })
  })
})

describe('parser', () => {
  it('parses a map, a record, a match, and a pipe', () => {
    const program = parse(`record Paddle { x, y }
let p = Paddle { x: 1, y: 2 }
let m = { "a": 1, b: 2 }
for n in m { }
match p { Paddle { x: x, y: _ } => x }`)
    expect(program.body.map((statement) => statement.type)).toEqual([
      'RecordStmt',
      'LetStmt',
      'LetStmt',
      'ForInStmt',
      'ExprStmt',
    ])
    expect(parseExpression('1 + 2 |> inc')).toMatchObject({
      type: 'BinaryExpr',
      operator: '|>',
      left: { type: 'BinaryExpr', operator: '+' },
    })
  })

  it('rejects a repeated field and a repeated pattern name', () => {
    expect(() => parse('record P { x, x }')).toThrow(ParseError)
    expect(() => parse('match v { vec(x, x) => x }')).toThrow(ParseError)
  })
})

for (const [engine, interpret] of engines) {
  describe(`spool core (${engine})`, () => {
    it('adds quantities only when the units match, and cancels px/s * s', () => {
      expect(interpret('1px + 2px')).toEqual(quantity(3, 1, 0))
      expect(interpret('80px/s * 1.5s')).toEqual(quantity(120, 1, 0))
      expect(interpret('10px / 2px')).toBe(5)
      expect(interpret('120px / 2')).toEqual(quantity(60, 1, 0))
      expect(interpret('-1.5s')).toEqual(quantity(-1.5, 0, 1))
      expect(interpret('1px == 1px')).toBe(true)
      expect(interpret('1px == 1')).toBe(false)
      expect(() => interpret('1px + 1s')).toThrow(RuntimeError)
      try {
        interpret('1px + 1')
        expect.unreachable()
      } catch (error) {
        expect((error as RuntimeError).code).toBe('E0216')
      }
    })

    it('builds vecs and scales them', () => {
      expect(interpret('let v = vec(1px, 2px) + vec(3px, 4px)\nv.x')).toEqual(quantity(4, 1, 0))
      expect(interpret('let v = vec(80px/s, 40px/s) * 1.5s\nv.y')).toEqual(quantity(60, 1, 0))
      expect(interpret('vec(2, 3) == 2 * vec(1, 1) + vec(0, 1)')).toBe(true)
      expect(() => interpret('vec(1px, 1s)')).toThrow(RuntimeError)
      expect(() => interpret('vec(1, 2) * vec(3, 4)')).toThrow(RuntimeError)
    })

    it('stores maps in insertion order and records by field', () => {
      expect(interpret('let m = { b: 1, "a": 2 }\nm["a"] = m["b"] + 3\nm["a"]')).toBe(4)
      expect(
        interpret(`let m = { b: 1, a: 2 }
let s = ""
for k in m { s = s + k }
s`),
      ).toBe('ba')
      expect(
        interpret(`record Paddle { x, y }
let p = Paddle { y: 2px, x: 1px }
p.x = p.x + 3px
p.x`),
      ).toEqual(quantity(4, 1, 0))
      expect(() => interpret('record P { x }\nP { z: 1 }')).toThrow(RuntimeError)
      expect(interpret('record Marker { }\nMarker { }')).toMatchObject({ type: 'record', name: 'Marker', fields: {} })
      expect(interpret('let ready = true\nif ready { }\n1')).toBe(1)
    })

    it('interpolates, pipes, and matches', () => {
      expect(interpret('let score = 3\n"score: {score}"')).toBe('score: 3')
      expect(interpret('"n {1 + 2}"')).toBe('n 3')
      expect(interpret('"t {1.5s}"')).toBe('t 1.5s')
      expect(
        interpret(`fn inc(n) { return n + 1 }
fn add(a, b) { return a + b }
1 + 2 |> inc |> add(10)`),
      ).toBe(14)
      expect(interpret('[1, 2, 3] |> len')).toBe(3)
      const word = `fn word(n) {
  return match n {
    0 => "zero"
    1px => "px"
    vec(x, 0) => x
    n => "other"
  }
}`
      expect(interpret(`${word}\nword(0)`)).toBe('zero')
      expect(interpret(`${word}\nword(vec(4, 0))`)).toBe(4)
      expect(interpret(`${word}\nword(1px)`)).toBe('px')
      expect(() => interpret('match 1 { 0 => "no" }')).toThrow(RuntimeError)
    })

    it('gives each for-in pass its own binding', () => {
      expect(
        interpret(`let fns = []
for n in [10, 20] {
  push(fns, fn() { return n })
}
fns[0]() + fns[1]()`),
      ).toBe(30)
      expect(
        interpret(`let s = ""
for c in "ab" { s = s + c }
s`),
      ).toBe('ab')
    })

    it('runs the record, unit, and interpolation example', () => {
      expect(
        interpret(`record Paddle { x, y }
fn nudge(p, dt) {
  return match p {
    Paddle { x: x, y: y } => Paddle { x: x + 40px/s * dt, y: y }
  }
}
let score = 0
let p = Paddle { x: 10px, y: 20px }
p = nudge(p, 1.5s)
"score: {score} at {p.x}"`),
      ).toBe('score: 0 at 70px')
    })

    it('matches a record field and leaves the other one alone', () => {
      expect(
        interpret(`record Point { x, y }
match Point { x: 2, y: 9 } {
  Point { x: 0, y: y } => y
  Point { x: x, y: _ } => x
}`),
      ).toBe(2)
    })
  })
}

describe('quantities are not plain numbers', () => {
  it('tags a literal', () => {
    const value = interpretTree('120px')
    expect(isQuantity(value)).toBe(true)
  })
})
