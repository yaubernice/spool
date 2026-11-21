import type { SourceLocation } from './ast.ts'
import { RuntimeError } from './errors.ts'
import type { HostFunction, Value } from './interpreter.ts'

/**
 * Array and string operations that belong to the language.
 * `push` changes the array in place and returns that same array.
 * `len` is the number of items in an array, or characters in a string.
 */

export function collectionBuiltins(): Record<string, HostFunction> {
  return {
    len: (args, at) => {
      if (args.length !== 1) arity('len', 1, args.length, at)
      const value = args[0]
      if (typeof value === 'string') return value.length
      if (isArray(value)) return value.items.length
      throw new RuntimeError('E0502', 'len expects an array or a string', at.line, at.column)
    },
    push: (args, at) => {
      if (args.length !== 2) arity('push', 2, args.length, at)
      const array = args[0]
      if (!isArray(array)) {
        throw new RuntimeError('E0503', 'push expects an array', at.line, at.column)
      }
      array.items.push(args[1])
      return array
    },
  }
}

export function isArray(value: Value): value is { type: 'array'; items: Value[] } {
  return typeof value === 'object' && value !== null && value.type === 'array'
}

function arity(name: string, expected: number, got: number, at: SourceLocation): never {
  const noun = expected === 1 ? 'argument' : 'arguments'
  throw new RuntimeError('E0501', `${name} expects ${expected} ${noun}, got ${got}`, at.line, at.column)
}
