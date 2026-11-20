import { describe, expect, it } from 'vitest'
import { RuntimeError } from '../src/errors.ts'
import { examples } from '../src/playground/examples.ts'
import { trace } from '../src/turtle.ts'

describe('turtle', () => {
  it('walks north, then a square back to the start', () => {
    const { strokes } = trace('forward 100')
    expect(strokes).toHaveLength(1)
    expect(strokes[0].x2).toBeCloseTo(0)
    expect(strokes[0].y2).toBeCloseTo(100)
    expect(strokes[0].draw).toBe(true)

    const square = trace('repeat 4 { forward 50 turn 90 }')
    const end = square.strokes.at(-1)
    expect(end?.x2).toBeCloseTo(0)
    expect(end?.y2).toBeCloseTo(0)
  })

  it('lifts the pen, jumps, and remembers color and width', () => {
    const { strokes } = trace(`
penup
forward 10
pendown
color "red"
width 4
goto 3 4
`)
    expect(strokes[0].draw).toBe(false)
    expect(strokes[1]).toMatchObject({ x2: 3, y2: 4, color: 'red', width: 4, draw: true })
  })

  it('prints values', () => {
    expect(trace('print 1 < 2\nprint "hi"').prints).toEqual(['true', 'hi'])
  })

  it('rejects a bad color at the call', () => {
    try {
      trace('color 1')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError)
      expect((error as RuntimeError).message).toContain('color expects a string')
      expect((error as RuntimeError).line).toBe(1)
    }
  })

  it('runs every gallery example', () => {
    for (const example of examples) {
      const { strokes } = trace(example.code)
      expect(strokes.some((stroke) => stroke.draw), example.name).toBe(true)
    }
  })
})
