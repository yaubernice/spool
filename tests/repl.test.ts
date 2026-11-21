import { describe, expect, it } from 'vitest'
import { loadGame as loadTree } from '../src/interpreter.ts'
import { loadGame as loadVm } from '../src/vm.ts'

const SOURCE = `let extra = 0
let mark = 0
on tick(dt) { mark += 1 }
on key "r" { rewind 1s }
`

function play(engine: 'tree' | 'vm') {
  const load = engine === 'tree' ? loadTree : loadVm
  return load(SOURCE, { seed: 1 })
}

describe('REPL against a running game', () => {
  for (const engine of ['tree', 'vm'] as const) {
    it(`${engine}: evaluates now and replays the same line after rewind`, () => {
      const game = play(engine)
      for (let i = 0; i < 30; i++) game.frame([])
      expect(game.eval('extra = 7')).toBeNull()
      for (let i = 0; i < 90; i++) game.frame([])
      game.frame([{ type: 'key', key: 'r' }])
      expect(game.rewound()).toBe(true)
      expect(game.get('extra')).toBe(7)
      expect(game.get('mark')).toBe(60)
    })

    it(`${engine}: a rewind that passes the line forgets it`, () => {
      const game = play(engine)
      for (let i = 0; i < 10; i++) game.frame([])
      game.eval('extra = 7')
      for (let i = 0; i < 10; i++) game.frame([])
      game.frame([{ type: 'key', key: 'r' }])
      expect(game.rewound()).toBe(true)
      expect(game.get('extra')).toBe(0)
    })
  }

  it('counts living entities and can spawn one', () => {
    const source = `entity Ball { r }
spawn Ball at (0px, 0px) { r: 1px }
spawn Ball at (8px, 0px) { r: 1px }
`
    for (const load of [loadTree, loadVm]) {
      const game = load(source, { seed: 1 })
      expect(game.eval('Ball.count')).toBe(2)
      game.eval('spawn Ball at (100px, 50px) { r: 1px }')
      expect(game.eval('Ball.count')).toBe(3)
    }
  })
})
