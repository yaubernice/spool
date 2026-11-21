import type { SourceLocation } from './ast.ts'
import { valueLabel } from './data.ts'
import { RuntimeError } from './errors.ts'
import type { HostFunction, Value } from './interpreter.ts'

/**
 * Array and string operations that belong to the language.
 * `push` changes the array in place and returns that same array.
 * `len` is the number of items in an array, or characters in a string.
 * `pop` removes the last array item. `slice` copies a half-open range.
 * `ord` / `char` convert between a one-character string and a code unit.
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
    pop: (args, at) => {
      if (args.length !== 1) arity('pop', 1, args.length, at)
      const array = args[0]
      if (!isArray(array)) {
        throw new RuntimeError('E0504', 'pop expects an array', at.line, at.column)
      }
      if (array.items.length === 0) {
        throw new RuntimeError('E0505', 'pop expects a non-empty array', at.line, at.column)
      }
      return array.items.pop() as Value
    },
    slice: (args, at) => {
      if (args.length !== 3) arity('slice', 3, args.length, at)
      const value = args[0]
      const start = wholeIndex(args[1], 'slice start', at)
      const end = wholeIndex(args[2], 'slice end', at)
      if (typeof value === 'string') {
        const bounds = sliceBounds(start, end, value.length, at)
        return value.slice(bounds.start, bounds.end)
      }
      if (isArray(value)) {
        const bounds = sliceBounds(start, end, value.items.length, at)
        return { type: 'array', items: value.items.slice(bounds.start, bounds.end) }
      }
      throw new RuntimeError('E0506', 'slice expects an array or a string', at.line, at.column)
    },
    ord: (args, at) => {
      if (args.length !== 1) arity('ord', 1, args.length, at)
      const value = args[0]
      if (typeof value !== 'string' || value.length !== 1) {
        throw new RuntimeError('E0507', 'ord expects a string of length 1', at.line, at.column)
      }
      return value.charCodeAt(0)
    },
    char: (args, at) => {
      if (args.length !== 1) arity('char', 1, args.length, at)
      const code = args[0]
      if (typeof code !== 'number' || !Number.isInteger(code) || code < 0 || code > 0xffff) {
        throw new RuntimeError(
          'E0508',
          'char expects a whole number from 0 to 65535',
          at.line,
          at.column,
        )
      }
      return String.fromCharCode(code)
    },
  }
}

export function isArray(value: Value): value is { type: 'array'; items: Value[] } {
  return typeof value === 'object' && value !== null && value.type === 'array'
}

/** Shared by `s[i]` and array indexing error messages. */
export function indexInRange(index: Value, length: number, at: SourceLocation, kind: 'array' | 'string'): number {
  if (typeof index !== 'number' || !Number.isInteger(index)) {
    throw new RuntimeError('E0214', `Expected a whole number index, but got ${valueLabel(index)}`, at.line, at.column)
  }
  if (index < 0 || index >= length) {
    throw new RuntimeError(
      'E0215',
      `Index ${index} is out of range for ${kind === 'string' ? 'a string' : 'an array'} of length ${length}`,
      at.line,
      at.column,
    )
  }
  return index
}

function sliceBounds(start: number, end: number, length: number, at: SourceLocation): { start: number; end: number } {
  if (start < 0 || start > length) {
    throw new RuntimeError('E0509', `slice start ${start} is out of range for length ${length}`, at.line, at.column)
  }
  if (end < start || end > length) {
    throw new RuntimeError('E0510', `slice end ${end} is out of range for length ${length}`, at.line, at.column)
  }
  return { start, end }
}

function wholeIndex(value: Value, label: string, at: SourceLocation): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new RuntimeError('E0214', `Expected a whole number ${label}, but got ${valueLabel(value)}`, at.line, at.column)
  }
  return value
}

function arity(name: string, expected: number, got: number, at: SourceLocation): never {
  const noun = expected === 1 ? 'argument' : 'arguments'
  throw new RuntimeError('E0501', `${name} expects ${expected} ${noun}, got ${got}`, at.line, at.column)
}
