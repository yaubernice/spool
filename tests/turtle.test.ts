import { describe, expect, it } from 'vitest'
import { RuntimeError } from '../src/errors.ts'
import { interpret } from '../src/interpreter.ts'
import { examples } from '../src/playground/examples.ts'
import { trace } from '../src/turtle.ts'
import { interpretVm } from '../src/vm.ts'

const engines = [
  ['tree-walker', interpret],
  ['vm', interpretVm],
] as const

for (const [engine, run] of engines) {
describe(`turtle (${engine})`, () => {
  const draw = (source: string) => trace(source, run)

  it('walks north, then a square back to the start', () => {
    const { strokes } = draw('forward 100')
    expect(strokes).toHaveLength(1)
    expect(strokes[0].x2).toBeCloseTo(0)
    expect(strokes[0].y2).toBeCloseTo(100)
    expect(strokes[0].draw).toBe(true)

    const square = draw('repeat 4 { forward 50 turn 90 }')
    const end = square.strokes.at(-1)
    expect(end?.x2).toBeCloseTo(0)
    expect(end?.y2).toBeCloseTo(0)
  })

  it('lifts the pen, jumps, and remembers color and width', () => {
    const { strokes } = draw(`
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
    expect(draw('print 1 < 2\nprint "hi"').prints).toEqual(['true', 'hi'])
  })

  it('rejects a bad color at the call', () => {
    try {
      draw('color 1')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError)
      expect((error as RuntimeError).message).toContain('color expects a string')
      expect((error as RuntimeError).line).toBe(1)
    }
  })

  it('runs every gallery example', () => {
    for (const example of examples) {
      if (example.code.includes('use draw')) continue
      const result = draw(example.code)
      const drew = result.strokes.some((stroke) => stroke.draw)
      const printed = result.prints.length > 0
      expect(drew || printed, example.name).toBe(true)
    }
  })

  it('draws Sierpinski as a triangle', () => {
    const example = examples.find((item) => item.name === 'Sierpinski')
    if (!example) throw new Error('missing Sierpinski')
    const { strokes } = draw(example.code)
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const stroke of strokes) {
      minX = Math.min(minX, stroke.x1, stroke.x2)
      maxX = Math.max(maxX, stroke.x1, stroke.x2)
      minY = Math.min(minY, stroke.y1, stroke.y2)
      maxY = Math.max(maxY, stroke.y1, stroke.y2)
    }
    const width = maxX - minX
    const height = maxY - minY
    expect(width).toBeGreaterThan(100)
    expect(height / width).toBeGreaterThan(0.9)
    expect(height / width).toBeLessThan(1.4)
  })
})
}
