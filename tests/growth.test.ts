import { describe, expect, it } from 'vitest'
import { RuntimeError } from '../src/errors.ts'
import { interpret as interpretTree } from '../src/interpreter.ts'
import { parse } from '../src/parser.ts'
import { trace } from '../src/turtle.ts'
import { interpretVm, openVm } from '../src/vm.ts'

const engines = [
  ['tree-walker', interpretTree],
  ['vm', interpretVm],
] as const

for (const [engine, interpret] of engines) {
  describe(`language growth (${engine})`, () => {
    it('builds arrays, reads them, and changes an item', () => {
      expect(interpret('let a = [1, 2, 3]\na[1]')).toBe(2)
      expect(interpret('let a = [1]\na[0] = 4\na[0]')).toBe(4)
      expect(interpret('let a = []\npush(a, 10)\npush(a, 20)\nlen(a)')).toBe(2)
      expect(interpret('len("hi")')).toBe(2)
      expect(interpret('let a = [1, 2]\nlen(a)')).toBe(2)
    })

    it('rejects a bad index', () => {
      expect(() => interpret('let a = [1]\na[1]')).toThrow(RuntimeError)
      expect(() => interpret('let a = [1]\na["x"]')).toThrow(RuntimeError)
      expect(() => interpret('len(1)')).toThrow(RuntimeError)
      try {
        interpret('[][0]')
        expect.unreachable()
      } catch (error) {
        expect((error as RuntimeError).message).toContain('out of range')
      }
    })

    it('loops with an exclusive range and a fresh binding each time', () => {
      expect(
        interpret(`let s = 0
for i in 0..4 { s = s + i }
s`),
      ).toBe(6)
      expect(
        interpret(`let n = 0
for i in 3..3 { n = 1 }
n`),
      ).toBe(0)
      expect(
        interpret(`let fns = []
for i in 0..3 {
  push(fns, fn() { return i })
}
fns[0]() + fns[1]() * 10 + fns[2]() * 100`),
      ).toBe(210)
    })

    it('concatenates strings and refuses to mix them with numbers', () => {
      expect(interpret('"Fizz" + "Buzz"')).toBe('FizzBuzz')
      expect(() => interpret('"a" + 1')).toThrow(RuntimeError)
      try {
        interpret('1 + "a"')
        expect.unreachable()
      } catch (error) {
        expect((error as RuntimeError).code).toBe('E0212')
      }
    })

    it('passes functions around and closes over the arguments', () => {
      expect(
        interpret(`fn adder(n) {
  return fn(x) { return x + n }
}
let add3 = adder(3)
add3(4)`),
      ).toBe(7)
      expect(
        interpret(`fn apply(f, x) { return f(x) }
fn inc(n) { return n + 1 }
apply(inc, 4)`),
      ).toBe(5)
    })

    it('sorts, lists primes, and builds fizzbuzz', () => {
      const sorted = trace(
        `let a = [5, 1, 4, 2, 8]
let n = len(a)
for i in 0..n {
  for j in 0..(n - 1) {
    if a[j] > a[j + 1] {
      let tmp = a[j]
      a[j] = a[j + 1]
      a[j + 1] = tmp
    }
  }
}
for i in 0..n { print a[i] }`,
        interpret,
      )
      expect(sorted.prints).toEqual(['1', '2', '4', '5', '8'])

      const primes = trace(
        `fn isPrime(n) {
  if n < 2 { return false }
  for i in 2..n {
    if n % i == 0 { return false }
  }
  return true
}
for n in 2..30 {
  if isPrime(n) { print n }
}`,
        interpret,
      )
      expect(primes.prints).toEqual(['2', '3', '5', '7', '11', '13', '17', '19', '23', '29'])
    })

    it('draws the same random numbers from the same seed', () => {
      const once = interpret('random()', { seed: 4 })
      const first = interpret('let a = random()\nlet b = random()\na', { seed: 4 })
      expect(first).toBe(once)
      expect(once).toBeGreaterThanOrEqual(0)
      expect(once).toBeLessThan(1)
      expect(interpret('random()', { seed: 4 })).not.toBe(interpret('random()', { seed: 5 }))
      expect(interpret('random()', { seed: 4 })).toBe(interpretTree('random()', { seed: 4 }))
      expect(interpret('random()', { seed: 4 })).toBe(interpretVm('random()', { seed: 4 }))
    })
  })
}

describe('parser growth', () => {
  it('parses a for loop, an array, an index assignment, and a function expression', () => {
    const program = parse(`let f = fn(x) { return x }
for i in 0..len(f) { }
let a = [1, 2]
a[0] = a[1]`)
    expect(program.body.map((statement) => statement.type)).toEqual([
      'LetStmt',
      'ForStmt',
      'LetStmt',
      'IndexAssignStmt',
    ])
  })
})

describe('vm debugger', () => {
  it('pauses before each statement and records the call', () => {
    const session = openVm('let n = 1\nn = n + 1\nn')
    const first = session.generator.next()
    if (first.done) throw new Error('expected a pause')
    expect(first.value).toMatchObject({ line: 1, steps: 0, chunk: '<program>' })
    expect(first.value.ip).toBeGreaterThanOrEqual(0)
    expect(first.value.scopes[0].bindings).toEqual([])

    const second = session.generator.next()
    if (second.done) throw new Error('expected a pause')
    expect(second.value.scopes[0].bindings).toEqual([{ name: 'n', value: '1' }])

    const third = session.generator.next()
    if (third.done) throw new Error('expected a pause')
    expect(third.value.scopes[0].bindings).toEqual([{ name: 'n', value: '2' }])

    const last = session.generator.next()
    expect(last.done).toBe(true)
    if (last.done) expect(last.value).toBe(2)

    const call = openVm('fn id(s) {\n  return s\n}\nid(4)')
    call.generator.next()
    call.generator.next()
    const inside = call.generator.next()
    if (inside.done) throw new Error('expected to be inside id')
    expect(inside.value.stack[0].name).toBe('id')
    expect(inside.value.scopes[0].label).toBe('id')
    expect(inside.value.scopes[0].bindings).toEqual([{ name: 's', value: '4' }])
    expect(inside.value.maxCallDepth).toBe(1)
  })
})
