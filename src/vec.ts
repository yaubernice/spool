import { componentUnit, sameUnit, unitLabel, valueLabel, type VecValue } from './data.ts'
import { RuntimeError } from './errors.ts'
import type { HostFunction } from './interpreter.ts'

/**
 * `vec(x, y)`. Both components are numbers or quantities, and they share a unit.
 * Operators live in `data.ts` so the tree-walker and the VM stay in step.
 */
export function vecBuiltins(): Record<string, HostFunction> {
  return {
    vec: (args, at) => {
      if (args.length !== 2) {
        throw new RuntimeError('E0501', `vec expects 2 arguments, got ${args.length}`, at.line, at.column)
      }
      const x = componentUnit(args[0])
      const y = componentUnit(args[1])
      if (!x || !y) {
        const bad = x ? args[1] : args[0]
        throw new RuntimeError(
          'E0504',
          `vec expects a number or a quantity, but got ${valueLabel(bad)}`,
          at.line,
          at.column,
        )
      }
      if (!sameUnit(x, y)) {
        throw new RuntimeError(
          'E0217',
          `vec components must share a unit (${unitLabel(x)} and ${unitLabel(y)})`,
          at.line,
          at.column,
        )
      }
      const vec: VecValue = { type: 'vec', x: args[0] as VecValue['x'], y: args[1] as VecValue['y'] }
      return vec
    },
  }
}
