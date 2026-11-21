import { describe, expect, it } from 'vitest'
import { RuntimeError } from '../src/errors.ts'
import { interpret as interpretTree, type HostFunction } from '../src/interpreter.ts'
import { parse } from '../src/parser.ts'
import { trace } from '../src/turtle.ts'
import { interpretVm } from '../src/vm.ts'

const engines = [
  ['tree-walker', interpretTree],
  ['vm', interpretVm],
] as const

function host() {
  const calls: unknown[][] = []
  const rect: HostFunction = (args) => {
    calls.push(args)
    return args.length
  }
  const key: HostFunction = () => true
  return {
    calls,
    modules: {
      draw: { rect },
      input: { key },
    },
  }
}

describe('parser', () => {
  it('parses use', () => {
    const program = parse('use turtle\nuse draw')
    expect(program.body).toEqual([
      expect.objectContaining({ type: 'UseStmt', name: 'turtle' }),
      expect.objectContaining({ type: 'UseStmt', name: 'draw' }),
    ])
  })
})

for (const [engine, interpret] of engines) {
  describe(`modules (${engine})`, () => {
    it('calls whatever the host registered', () => {
      const { calls, modules } = host()
      expect(interpret('use draw\ndraw.rect(1, 2)', { modules })).toBe(2)
      expect(calls).toEqual([[1, 2]])
      expect(interpret('use input\ninput.key()', { modules })).toBe(true)
    })

    it('rejects an unknown module, a missing export, and assignment', () => {
      const { modules } = host()
      expect(() => interpret('use turtle')).toThrow(RuntimeError)
      expect(() => interpret('use turtle')).toThrow(/Unknown module 'turtle'/)
      expect(() => interpret('use canvas', { modules })).toThrow(/Unknown module 'canvas'/)
      expect(() => interpret('use draw\ndraw.circle(1)', { modules })).toThrow(/Module 'draw' has no 'circle'/)
      expect(() => interpret('use draw\ndraw.rect = 1', { modules })).toThrow(/Cannot assign to module 'draw'/)
    })

    it('draws through use turtle, and a bare command still works', () => {
      const qualified = trace('use turtle\nturtle.forward(30)\nturtle.turn(90)\nturtle.forward(10)', interpret)
      expect(qualified.x).toBeCloseTo(10)
      expect(qualified.y).toBeCloseTo(30)
      const bare = trace('forward 30', interpret)
      expect(bare.y).toBeCloseTo(30)
    })
  })
}
