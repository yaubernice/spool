import { describe, expect, it } from 'vitest'
import { RuntimeError } from '../src/errors.ts'
import { interpret } from '../src/interpreter.ts'

describe('expressions, variables, and scopes', () => {
  it('evaluates arithmetic with precedence', () => {
    expect(interpret('1 + 2 * 3')).toBe(7)
    expect(interpret('(1 + 2) * 3')).toBe(9)
    expect(interpret('10 - 3 - 2')).toBe(5)
    expect(interpret('10 % 4')).toBe(2)
    expect(interpret('-(2 + 3)')).toBe(-5)
  })

  it('compares values and short-circuits and / or', () => {
    expect(interpret('1 < 2')).toBe(true)
    expect(interpret('2 <= 2')).toBe(true)
    expect(interpret('"a" == "a"')).toBe(true)
    expect(interpret('1 == "1"')).toBe(false)
    expect(interpret('not 1 == 0')).toBe(true)
    expect(interpret('1 == 0 and (1 / 0)')).toBe(false)
    expect(interpret('1 == 1 or (1 / 0)')).toBe(true)
  })

  it('remembers variables and returns the last expression', () => {
    expect(interpret('let size = 50\nsize + 1')).toBe(51)
    expect(interpret('let size = 50')).toBeNull()
    expect(interpret('')).toBeNull()
  })

  it('lets a block shadow a name without changing the outer one', () => {
    const source = `fn f() {
  let a = 1
  if a == 1 {
    let a = 2
  }
  return a
}
f()`
    expect(interpret(source)).toBe(1)
  })

  it('reports a bad operation with line and column', () => {
    expect(() => interpret('1 / 0')).toThrow(RuntimeError)
    try {
      interpret('1 / 0')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError)
      expect((error as RuntimeError).message).toContain('Division by zero')
      expect((error as RuntimeError).line).toBe(1)
      expect((error as RuntimeError).column).toBe(3)
    }

    try {
      interpret('let x = 1\ny')
      expect.unreachable()
    } catch (error) {
      expect((error as RuntimeError).message).toContain("Undefined variable 'y'")
      expect((error as RuntimeError).line).toBe(2)
      expect((error as RuntimeError).column).toBe(1)
    }

    try {
      interpret('let a = 1\nlet a = 2')
      expect.unreachable()
    } catch (error) {
      expect((error as RuntimeError).message).toContain("'a' is already defined")
      expect((error as RuntimeError).line).toBe(2)
    }
  })
})

describe('control flow', () => {
  it('runs only the chosen branch', () => {
    let ticks = 0
    const tick = () => {
      ticks++
      return null
    }
    interpret(
      `if 1 == 1 {
  tick()
} else {
  tick()
  tick()
}`,
      { builtins: { tick } },
    )
    expect(ticks).toBe(1)
  })

  it('repeats a block a whole number of times', () => {
    const log: string[] = []
    interpret('repeat 1 + 2 { print "x" }', {
      builtins: {
        print: (args) => {
          log.push(String(args[0]))
          return null
        },
      },
    })
    expect(log).toEqual(['x', 'x', 'x'])
    expect(interpret('repeat 0 { 1 }')).toBeNull()
  })

  it('stops a while when the condition becomes false', () => {
    let left = 3
    interpret('while ready() { tick() }', {
      builtins: {
        ready: () => left > 0,
        tick: () => {
          left--
          return null
        },
      },
    })
    expect(left).toBe(0)
  })

  it('rejects a non-boolean condition and a bad repeat count', () => {
    expect(() => interpret('if 1 { }')).toThrow(RuntimeError)
    expect(() => interpret('repeat 2.5 { }')).toThrow(RuntimeError)
    expect(() => interpret('repeat -1 { }')).toThrow(RuntimeError)
    try {
      interpret('if 1 { }')
      expect.unreachable()
    } catch (error) {
      expect((error as RuntimeError).message).toContain('Expected a boolean')
      expect((error as RuntimeError).column).toBe(4)
    }
  })
})

describe('functions, return, and limits', () => {
  it('recurses and returns early', () => {
    const source = `fn fact(n) {
  if n == 0 {
    return 1
  } else {
    return n * fact(n - 1)
  }
}
fact(5)`
    expect(interpret(source)).toBe(120)
  })

  it('closes over the environment where the function was defined', () => {
    const source = `fn outer(x) {
  fn inner() {
    return x
  }
  return inner()
}
outer(7)`
    expect(interpret(source)).toBe(7)
  })

  it('does not run statements after return', () => {
    let printed = 0
    const value = interpret(
      `fn f() {
  return 1
  print "no"
}
f()`,
      {
        builtins: {
          print: () => {
            printed++
            return null
          },
        },
      },
    )
    expect(value).toBe(1)
    expect(printed).toBe(0)
  })

  it('checks the argument count', () => {
    expect(() => interpret('fn f(a) { return a }\nf()')).toThrow(RuntimeError)
    try {
      interpret('fn f(a) { return a }\nf()')
      expect.unreachable()
    } catch (error) {
      expect((error as RuntimeError).message).toContain("'f' expects 1 argument, got 0")
    }
  })

  it('stops infinite recursion and infinite loops', () => {
    try {
      interpret('fn f() { f() }\nf()', { maxCallDepth: 4 })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError)
      expect((error as RuntimeError).message).toContain('Call depth limit of 4')
    }

    try {
      interpret('while 1 == 1 { }', { maxSteps: 10 })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError)
      expect((error as RuntimeError).message).toContain('Step limit of 10')
      expect((error as RuntimeError).line).toBe(1)
    }
  })

  it('runs the square spiral by calling injected turtle commands', () => {
    const moves: string[] = []
    const record = (name: string) => (args: unknown[]) => {
      moves.push(`${name} ${String(args[0])}`)
      return null
    }
    interpret(
      `fn square(s) {
  repeat 4 { forward s  turn 90 }
}
repeat 36 {
  square(100)
  turn 10
}`,
      { builtins: { forward: record('forward'), turn: record('turn') } },
    )
    expect(moves.slice(0, 9)).toEqual([
      'forward 100',
      'turn 90',
      'forward 100',
      'turn 90',
      'forward 100',
      'turn 90',
      'forward 100',
      'turn 90',
      'turn 10',
    ])
    expect(moves.filter((move) => move === 'forward 100')).toHaveLength(144)
    expect(moves.filter((move) => move === 'turn 90')).toHaveLength(144)
    expect(moves.filter((move) => move === 'turn 10')).toHaveLength(36)
  })
})
