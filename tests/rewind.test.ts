import { describe, expect, it } from 'vitest'
import type { KeyEvent } from '../src/clock.ts'
import { loadGame as loadTree, type Game } from '../src/interpreter.ts'
import { loadGame as loadVm, openVm } from '../src/vm.ts'

const SOURCE = `entity Ball { r, vel, pos }
let mark = 0
let roll = 0
let steps = 0
let x = 0px
spawn Ball at (10px, 20px) { r: 3px, vel: vec(30px/s, 0px/s) }
task ticker {
  wait 0.5s
  steps += 1
  wait 10s
}
on tick(dt) {
  mark += 1
  roll = random()
  each b in Ball {
    b.pos += b.vel * dt
    x = b.pos.x
  }
}
on key "r" { rewind 1s }
`

function play(load: (source: string, options: { seed: number }) => Game, frames: number, events: (index: number) => KeyEvent[] = () => []): Game {
  const game = load(SOURCE, { seed: 1 })
  for (let index = 0; index < frames; index++) game.frame(events(index))
  return game
}

describe('rewind', () => {
  for (const [name, load] of [
    ['tree-walker', loadTree],
    ['vm', loadVm],
  ] as const) {
    it(`${name} restores variables, the task, and the random stream`, () => {
      const past = play(load, 60)
      const live = play(load, 120)
      live.frame([{ type: 'key', key: 'r' }])
      expect(live.rewound()).toBe(true)
      expect(live.get('mark')).toBe(past.get('mark'))
      expect(live.get('roll')).toBe(past.get('roll'))
      expect(live.get('steps')).toBe(past.get('steps'))
      expect(live.get('x')).toEqual(past.get('x'))
      expect(live.get('steps')).toBe(1)

      const control = play(load, 120)
      for (let index = 0; index < 60; index++) live.frame([])
      expect(live.get('mark')).toBe(control.get('mark'))
      expect(live.get('roll')).toBe(control.get('roll'))
      expect(live.get('steps')).toBe(control.get('steps'))
      expect(live.get('x')).toEqual(control.get('x'))
    })
  }

  it('vm entities and the saved machine match the earlier frame', () => {
    const session = openVm(SOURCE, { seed: 1 })
    let step = session.generator.next()
    while (!step.done) step = session.generator.next()
    for (let index = 0; index < 60; index++) session.frame([])
    const entities = JSON.stringify(session.captureEntities())
    const mark = session.read('mark')
    const roll = session.read('roll')
    for (let index = 0; index < 60; index++) session.frame([])
    session.frame([{ type: 'key', key: 'r' }])
    expect(session.consumeRewind()).toBe(true)
    expect(JSON.stringify(session.captureEntities())).toBe(entities)
    expect(session.read('mark')).toBe(mark)
    expect(session.read('roll')).toBe(roll)

    const control = openVm(SOURCE, { seed: 1 })
    step = control.generator.next()
    while (!step.done) step = control.generator.next()
    for (let index = 0; index < 120; index++) control.frame([])
    for (let index = 0; index < 60; index++) session.frame([])
    expect(JSON.stringify(session.captureEntities())).toBe(JSON.stringify(control.captureEntities()))
    expect(session.read('roll')).toBe(control.read('roll'))
    expect(session.image().rng).toBe(control.image().rng)
  })
})
