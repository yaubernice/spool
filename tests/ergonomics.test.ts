import { describe, expect, it } from 'vitest'
import { RuntimeError } from '../src/errors.ts'
import { interpret as interpretTree, loadGame as loadTree } from '../src/interpreter.ts'
import { interpretVm, loadGame as loadVm } from '../src/vm.ts'

const programs = [
  ['tree-walker', interpretTree, loadTree],
  ['vm', interpretVm, loadVm],
] as const

function px(value: number) {
  return { type: 'quantity', value, unit: { px: 1, s: 0 } }
}

describe('game ergonomics', () => {
  for (const [name, interpret, load] of programs) {
    it(`${name} updates with +=, -=, and *=`, () => {
      expect(interpret('let n = 2\nn += 3\nn *= 4\nn -= 1\nn')).toBe(19)
      expect(interpret('let v = 10px\nv += 5px\nv')).toEqual(px(15))
      expect(interpret('let items = [1, 2]\nitems[0] += 4\nitems[0]')).toBe(5)
      expect(interpret('let p = vec(1px, 2px)\np.x += 3px\np.y')).toEqual(px(2))
    })

    it(`${name} clamps, lerps, and bounces`, () => {
      expect(interpret('clamp(5, 0, 3)')).toBe(3)
      expect(interpret('clamp(1px, 4px, 9px)')).toEqual(px(4))
      expect(interpret('lerp(0px, 10px, 0.25)')).toEqual(px(2.5))
      expect(interpret('bounce(4)')).toBe(-4)
      expect(interpret('bounce(vec(3px, -1px)).y')).toEqual(px(1))
      expect(() => interpret('clamp(1px, 0, 2)')).toThrow(RuntimeError)
    })

    it(`${name} visits every entity when where is omitted`, () => {
      const game = load(
        `entity Item { n }
let sum = 0
spawn Item at (0px, 0px) { n: 1 }
spawn Item at (8px, 0px) { n: 2 }
on tick(dt) {
  each item in Item { sum += item.n }
}`,
        { seed: 1 },
      )
      game.frame([])
      expect(game.get('sum')).toBe(3)
    })

    it(`${name} moves a pos vec and collides with it`, () => {
      const game = load(
        `entity Mover { r, vel, pos }
entity Wall { w, h, pos }
let x = 0px
let hits = 0
spawn Mover at (0px, 10px) { r: 4px, vel: vec(60px/s, 0px/s) }
spawn Wall at (40px, 10px) { w: 8px, h: 20px }
on tick(dt) {
  each m in Mover {
    m.pos += m.vel * dt
    x = m.pos.x
  }
}
when m in Mover touches w in Wall { hits += 1 }`,
        { seed: 1 },
      )
      for (let frame = 0; frame < 60; frame++) game.frame([])
      expect(game.get('x')).toEqual(px(60))
      expect(game.get('hits')).toBeGreaterThan(0)
    })
  }
})
