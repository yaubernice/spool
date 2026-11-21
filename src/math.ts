import type { SourceLocation } from './ast.ts'
import { isQuantity, isVec, negate, quantity, sameUnit, type Quantity } from './data.ts'
import { RuntimeError } from './errors.ts'
import type { HostFunction, Value } from './interpreter.ts'

/**
 * Pure functions that belong to the language, not to the turtle.
 * `sin` and `cos` take radians. `hsl` returns a CSS color string.
 * `random` returns a number from 0 up to, but not including, 1.
 */

export function mathBuiltins(random: () => number = Math.random): Record<string, HostFunction> {
  return {
    sin: (args, at) => Math.sin(oneNumber(args, 'sin', at)),
    cos: (args, at) => Math.cos(oneNumber(args, 'cos', at)),
    sqrt: (args, at) => {
      const value = oneNumber(args, 'sqrt', at)
      if (value < 0) {
        throw new RuntimeError('E0402', 'sqrt expects a number that is zero or greater', at.line, at.column)
      }
      return Math.sqrt(value)
    },
    abs: (args, at) => Math.abs(oneNumber(args, 'abs', at)),
    random: (args, at) => {
      if (args.length !== 0) {
        throw new RuntimeError('E0403', `random expects 0 arguments, got ${args.length}`, at.line, at.column)
      }
      return random()
    },
    min: (args, at) => fold(args, 'min', at, Math.min),
    max: (args, at) => fold(args, 'max', at, Math.max),
    hsl: (args, at) => {
      if (args.length !== 3) {
        throw new RuntimeError('E0403', `hsl expects 3 arguments, got ${args.length}`, at.line, at.column)
      }
      const [hue, saturation, lightness] = args.map((arg) => numberAt(arg, 'hsl', at))
      return `hsl(${hue}, ${saturation}%, ${lightness}%)`
    },
    clamp: (args, at) => clampValue(args, at),
    lerp: (args, at) => lerpValue(args, at),
    bounce: (args, at) => bounceValue(args, at),
  }
}

type Axis = number | Quantity

function clampValue(args: Value[], at: SourceLocation): Value {
  if (args.length !== 3) {
    throw new RuntimeError('E0403', `clamp expects 3 arguments, got ${args.length}`, at.line, at.column)
  }
  const [value, low, high] = args
  if (typeof value === 'number' && typeof low === 'number' && typeof high === 'number') {
    return Math.max(low, Math.min(high, value))
  }
  if (isQuantity(value) && isQuantity(low) && isQuantity(high) && sameUnit(value.unit, low.unit) && sameUnit(value.unit, high.unit)) {
    return quantity(Math.max(low.value, Math.min(high.value, value.value)), value.unit)
  }
  throw new RuntimeError('E0401', 'clamp expects three numbers, or three quantities with the same unit', at.line, at.column)
}

function lerpValue(args: Value[], at: SourceLocation): Value {
  if (args.length !== 3) {
    throw new RuntimeError('E0403', `lerp expects 3 arguments, got ${args.length}`, at.line, at.column)
  }
  const [from, to, t] = args
  if (typeof t !== 'number') {
    throw new RuntimeError('E0401', 'lerp expects the third argument to be a number', at.line, at.column)
  }
  if (isVec(from) && isVec(to)) {
    return { type: 'vec', x: mix(from.x, to.x, t, at), y: mix(from.y, to.y, t, at) }
  }
  if ((typeof from === 'number' || isQuantity(from)) && (typeof to === 'number' || isQuantity(to))) {
    return mix(from, to, t, at)
  }
  throw new RuntimeError('E0401', 'lerp expects two numbers, two quantities, or two vecs', at.line, at.column)
}

function mix(from: Axis, to: Axis, t: number, at: SourceLocation): Axis {
  if (typeof from === 'number' && typeof to === 'number') return from + (to - from) * t
  if (isQuantity(from) && isQuantity(to) && sameUnit(from.unit, to.unit)) {
    return quantity(from.value + (to.value - from.value) * t, from.unit)
  }
  throw new RuntimeError('E0401', 'lerp expects both ends to share a unit', at.line, at.column)
}

function bounceValue(args: Value[], at: SourceLocation): Value {
  if (args.length !== 1) {
    throw new RuntimeError('E0403', `bounce expects 1 argument, got ${args.length}`, at.line, at.column)
  }
  const flipped = negate(args[0])
  if (flipped.status === 'value') return flipped.value
  throw new RuntimeError('E0401', 'bounce expects a number, a quantity, or a vec', at.line, at.column)
}

function oneNumber(args: Value[], name: string, at: SourceLocation): number {
  if (args.length !== 1) {
    throw new RuntimeError('E0403', `${name} expects 1 argument, got ${args.length}`, at.line, at.column)
  }
  return numberAt(args[0], name, at)
}

function fold(args: Value[], name: string, at: SourceLocation, combine: (a: number, b: number) => number): number {
  if (args.length < 2) {
    throw new RuntimeError('E0403', `${name} expects at least 2 arguments, got ${args.length}`, at.line, at.column)
  }
  return args.map((arg) => numberAt(arg, name, at)).reduce((a, b) => combine(a, b))
}

function numberAt(value: Value, name: string, at: SourceLocation): number {
  if (typeof value !== 'number') {
    throw new RuntimeError('E0401', `${name} expects a number`, at.line, at.column)
  }
  return value
}
