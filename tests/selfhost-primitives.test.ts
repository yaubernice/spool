import { describe, expect, it } from 'vitest'
import { RuntimeError } from '../src/errors.ts'
import { interpret as interpretTree } from '../src/interpreter.ts'
import { interpretVm } from '../src/vm.ts'

const engines = [
  ['tree-walker', interpretTree],
  ['vm', interpretVm],
] as const

for (const [engine, interpret] of engines) {
  describe(`self-host primitives (${engine})`, () => {
    it('indexes a string by character', () => {
      expect(interpret('"hi"[0]')).toBe('h')
      expect(interpret('"hi"[1]')).toBe('i')
      expect(interpret('let s = "ab"\ns[0] + s[1]')).toBe('ab')
    })

    it('rejects a bad string index and assignment into a string', () => {
      expect(() => interpret('"hi"[2]')).toThrow(RuntimeError)
      expect(() => interpret('"hi"[-1]')).toThrow(RuntimeError)
      try {
        interpret('let s = "a"\ns[0] = "b"')
        expect.unreachable()
      } catch (error) {
        expect((error as RuntimeError).code).toBe('E0217')
      }
    })

    it('pops the last array item', () => {
      expect(interpret('let a = [1, 2, 3]\npop(a)')).toBe(3)
      expect(interpret('let a = [1, 2, 3]\npop(a)\nlen(a)')).toBe(2)
      expect(() => interpret('pop([])')).toThrow(RuntimeError)
      expect(() => interpret('pop("a")')).toThrow(RuntimeError)
    })

    it('slices arrays and strings with a half-open range', () => {
      expect(interpret('slice("hello", 1, 4)')).toBe('ell')
      expect(interpret('slice("hi", 0, 2)')).toBe('hi')
      expect(interpret('slice("hi", 2, 2)')).toBe('')
      expect(interpret('let a = [1, 2, 3, 4]\nslice(a, 1, 3)')).toEqual({ type: 'array', items: [2, 3] })
      expect(() => interpret('slice("hi", 0, 3)')).toThrow(RuntimeError)
      expect(() => interpret('slice("hi", 2, 1)')).toThrow(RuntimeError)
      expect(() => interpret('slice(1, 0, 1)')).toThrow(RuntimeError)
    })

    it('converts between a character and its code unit', () => {
      expect(interpret('ord("A")')).toBe(65)
      expect(interpret('ord("0")')).toBe(48)
      expect(interpret('char(65)')).toBe('A')
      expect(interpret('char(ord("z"))')).toBe('z')
      expect(interpret('ord("0") <= ord("5") and ord("5") <= ord("9")')).toBe(true)
      expect(() => interpret('ord("ab")')).toThrow(RuntimeError)
      expect(() => interpret('ord("")')).toThrow(RuntimeError)
      expect(() => interpret('char(1.5)')).toThrow(RuntimeError)
      expect(() => interpret('char(-1)')).toThrow(RuntimeError)
    })
  })
}
