import { describe, expect, it } from 'vitest'
import { TICK_DT, type KeyEvent } from '../src/clock.ts'
import { RuntimeError } from '../src/errors.ts'
import { loadGame as loadTree } from '../src/interpreter.ts'
import { parse } from '../src/parser.ts'
import { loadGame as loadVm } from '../src/vm.ts'

const engines = [
  ['tree-walker', loadTree],
  ['vm', loadVm],
] as const

const source = `let n = 0
let last = 0
let roll = 0
on start { n = 1 }
on tick(dt) {
  n = n + 1
  last = dt
  roll = random()
}
on key "space" { n = n + 10 }
on key_up "space" { n = n + 100 }`

const log: KeyEvent[][] = [
  [],
  [{ type: 'key', key: 'space' }],
  [{ type: 'key_up', key: 'space' }],
]

function play(load: (typeof engines)[number][1], frames: KeyEvent[][], seed = 4) {
  const game = load(source, { seed })
  for (const events of frames) game.frame(events)
  return game
}

describe('parser', () => {
  it('parses event blocks', () => {
    const program = parse('on start { }\non tick(dt) { }\non key "space" { }\non key_up "left" { }')
    expect(program.body.map((statement) => (statement.type === 'OnStmt' ? statement.event : statement.type))).toEqual([
      'start',
      'tick',
      'key',
      'key_up',
    ])
  })
})

for (const [engine, load] of engines) {
  describe(`clock (${engine})`, () => {
    it('replays one input log the same way twice, and matches the other details', () => {
      const first = play(load, log)
      const second = play(load, log)
      expect(first.get('n')).toBe(114)
      expect(second.get('n')).toBe(first.get('n'))
      expect(first.get('last')).toEqual(TICK_DT)
      expect(first.get('roll')).toBe(second.get('roll'))
      expect(play(load, [[], [], []]).get('n')).toBe(4)
    })

    it('agrees with the other engine', () => {
      const other = engine === 'vm' ? loadTree : loadVm
      expect(play(load, log).get('roll')).toBe(play(other, log).get('roll'))
    })

    it('stops a tick that never ends', () => {
      const game = load('on tick(dt) { while true { } }', { maxSteps: 20 })
      expect(() => game.frame([])).toThrow(RuntimeError)
    })
  })
}
