import { describe, expect, it } from 'vitest'
import type { Game } from '../src/interpreter.ts'
import { RuntimeError } from '../src/errors.ts'
import { interpret as interpretTree, loadGame as loadTree } from '../src/interpreter.ts'
import { parse } from '../src/parser.ts'
import { interpretVm, loadGame as loadVm } from '../src/vm.ts'

const engines = [
  ['tree-walker', interpretTree, loadTree],
  ['vm', interpretVm, loadVm],
] as const

function frames(game: Game, count: number): void {
  for (let i = 0; i < count; i++) game.frame([])
}

describe('parser', () => {
  it('parses tasks, waits, every, and after', () => {
    const program = parse(`task flash {
  wait 1.5s
  wait until ready
}
every 2s { n = 1 }
after 3s { n = 2 }`)
    expect(program.body.map((statement) => statement.type)).toEqual(['TaskStmt', 'EveryStmt', 'AfterStmt'])
    const task = program.body[0]
    if (task?.type !== 'TaskStmt') throw new Error('expected a task')
    expect(task.body.statements.map((statement) => statement.type)).toEqual(['WaitStmt', 'WaitStmt'])
  })
})

for (const [engine, interpret, load] of engines) {
  describe(`tasks (${engine})`, () => {
    it('wakes a task after 1.5s of game time, not before', () => {
      const source = `let n = 0
task flash {
  wait 1.5s
  n = 1
}`
      const game = load(source)
      expect(game.get('n')).toBe(0)
      frames(game, 89)
      expect(game.get('n')).toBe(0)
      game.frame([])
      expect(game.get('n')).toBe(1)
    })

    it('runs every and after on the same clock, in source order', () => {
      const source = `let n = 0
let log = ""
task mark {
  wait 1s
  log = log + "a"
}
every 1s { log = log + "e" }
after 1s { n = 5 }`
      const game = load(source)
      frames(game, 59)
      expect(game.get('n')).toBe(0)
      expect(game.get('log')).toBe('')
      game.frame([])
      expect(game.get('n')).toBe(5)
      expect(game.get('log')).toBe('ae')
      frames(game, 60)
      expect(game.get('n')).toBe(5)
      expect(game.get('log')).toBe('aee')
    })

    it('checks wait until after on tick', () => {
      const source = `let t = 0
let n = 0
on tick(dt) { t = t + 1 }
task gate {
  wait until t > 3
  n = 1
}`
      const game = load(source)
      frames(game, 3)
      expect(game.get('n')).toBe(0)
      game.frame([])
      expect(game.get('t')).toBe(4)
      expect(game.get('n')).toBe(1)
    })

    it('runs a task with no wait at the end of the script', () => {
      const game = load(`let n = 0
task now { n = 1 }`)
      expect(game.get('n')).toBe(1)
    })

    it('rejects a wait that is not a time in seconds, or not inside a task', () => {
      expect(() => interpret('wait 1s')).toThrow(RuntimeError)
      expect(() => interpret('wait 1s')).toThrow(/only allowed inside a task/)
      expect(() => load(`task t { wait 2 }`).get('n')).toThrow(/time in seconds/)
      expect(() =>
        load(`fn later() { wait 1s }
task t { later() }`).get('n'),
      ).toThrow(/only allowed inside a task/)
    })
  })
}

it('keeps the same wake time when the vm folds and deletes dead code', () => {
  const source = `let n = 0
task flash {
  wait 1.5s
  n = 1
}
every 1s { n = n + 10 }`
  const game = loadVm(source, { optimize: { fold: true, dce: true } })
  frames(game, 90)
  expect(game.get('n')).toBe(1)
  frames(game, 30)
  expect(game.get('n')).toBe(11)
})
