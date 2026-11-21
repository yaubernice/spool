import { describe, expect, it } from 'vitest'
import { RuntimeError } from '../src/errors.ts'
import { interpret as interpretTree, loadGame as loadTree } from '../src/interpreter.ts'
import { parse } from '../src/parser.ts'
import { interpretVm, loadGame as loadVm } from '../src/vm.ts'

const engines = [
  ['tree-walker', interpretTree, loadTree],
  ['vm', interpretVm, loadVm],
] as const

describe('parser', () => {
  it('parses entities, queries, and collision rules', () => {
    const program = parse(`entity Ball { r }
let ball = spawn Ball at (0px, 0px) { r: 2px }
each b in Ball where b.x > 1px { }
when ball in Ball touches wall in Wall { despawn ball }`)
    expect(program.body.map((statement) => statement.type)).toEqual(['EntityStmt', 'LetStmt', 'EachStmt', 'WhenStmt'])
  })
})

for (const [engine, interpret, load] of engines) {
  describe(`entities (${engine})`, () => {
    it('counts a circle touch, a miss, a query, and a despawn', () => {
      const touch = `entity Ball { r }
let n = 0
let a = spawn Ball at (0px, 0px) { r: 2px }
let b = spawn Ball at (3px, 0px) { r: 2px }
when a in Ball touches b in Ball { n = n + 1 }
n`
      expect(load(touch).get('n')).toBe(1)
      const game = load(touch)
      game.frame([])
      expect(game.get('n')).toBe(2)

      const miss = `entity Ball { r }
let n = 0
spawn Ball at (0px, 0px) { r: 1px }
spawn Ball at (10px, 0px) { r: 1px }
when a in Ball touches b in Ball { n = n + 1 }
n`
      expect(load(miss).get('n')).toBe(0)

      const query = `entity Ball { r }
spawn Ball at (0px, 0px) { r: 1px }
spawn Ball at (10px, 0px) { r: 1px }
let n = 0
each b in Ball where b.x > 5px { n = n + 1 }
n`
      expect(interpret(query)).toBe(1)

      const gone = `entity Ball { r }
let b = spawn Ball at (0px, 0px) { r: 1px }
despawn b
let n = 0
each b in Ball where true { n = n + 1 }
n`
      expect(interpret(gone)).toBe(0)
    })

    it('overlaps a rectangle and a circle, and rejects a bad spawn', () => {
      const rects = `entity Wall { w, h }
let n = 0
spawn Wall at (0px, 0px) { w: 10px, h: 2px }
spawn Wall at (6px, 0px) { w: 10px, h: 2px }
when a in Wall touches b in Wall { n = n + 1 }
n`
      expect(load(rects).get('n')).toBe(1)

      const mixed = `entity Ball { r }
entity Wall { w, h }
let n = 0
spawn Ball at (0px, 0px) { r: 2px }
spawn Wall at (3px, 0px) { w: 2px, h: 2px }
when ball in Ball touches wall in Wall { n = n + 1 }
n`
      expect(load(mixed).get('n')).toBe(1)

      expect(() => interpret('entity Ball { r }\nspawn Ball at (0px, 0px) { }')).toThrow(RuntimeError)
      expect(() => interpret('entity Ball { r }\nspawn Ball at (0px, 0px) { }')).toThrow(/missing field 'r'/)
      expect(() =>
        interpret(`entity Ball { r }
spawn Ball at (0px, 0px) { r: 1px }
spawn Ball at (0, 0) { r: 1 }
when a in Ball touches b in Ball { }`),
      ).toThrow(/units do not match/i)
    })
  })
}
