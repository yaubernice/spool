import type { SourceLocation } from './ast.ts'
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
  }
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
