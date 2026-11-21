import type { SourceLocation } from './ast.ts'
import { RuntimeError } from './errors.ts'
import { interpret, textValue, type HostFunction, type InterpretOptions, type Value } from './interpreter.ts'

/** Anything that can run a program the way `interpret` does. */
export type ProgramRunner = (source: string, options?: InterpretOptions) => Value

/**
 * Turtle: a pen that remembers position, heading, color, and width.
 *
 * It does not know about a canvas. Each command appends a stroke
 * (a straight move) or a printed line. The playground draws the strokes.
 *
 * Heading is in degrees. 0 points up, and positive `turn` rotates clockwise.
 */

export interface Stroke {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  width: number
  /** False when the pen is up: the turtle still moves, but nothing is drawn. */
  draw: boolean
  /** Degrees from north, clockwise, while this stroke is drawn. `back` does not change it. */
  heading: number
}

export interface TurtleResult {
  strokes: Stroke[]
  prints: string[]
  /** Where the turtle is when the program finishes, including turns after the last line. */
  x: number
  y: number
  heading: number
  steps: number
  maxCallDepth: number
}

export class Turtle {
  x = 0
  y = 0
  /** Degrees from north, clockwise. */
  heading = 0
  penDown = true
  color = '#1c1917'
  width = 1.5
  readonly strokes: Stroke[] = []
  readonly prints: string[] = []

  /** Built-ins to hand to the interpreter. */
  builtins(): Record<string, HostFunction> {
    return {
      forward: (args, at) => {
        this.move(this.number(args, 'forward', at))
        return null
      },
      back: (args, at) => {
        this.move(-this.number(args, 'back', at))
        return null
      },
      turn: (args, at) => {
        this.heading += this.number(args, 'turn', at)
        return null
      },
      penup: (_args, _at) => {
        this.penDown = false
        return null
      },
      pendown: (_args, _at) => {
        this.penDown = true
        return null
      },
      color: (args, at) => {
        this.one(args, 'color', at)
        const value = args[0]
        if (typeof value !== 'string') {
          throw new RuntimeError('E0301', 'color expects a string, like "red"', at.line, at.column)
        }
        this.color = value
        return null
      },
      width: (args, at) => {
        const width = this.number(args, 'width', at)
        if (width <= 0) {
          throw new RuntimeError('E0302', 'width must be greater than 0', at.line, at.column)
        }
        this.width = width
        return null
      },
      goto: (args, at) => {
        this.two(args, 'goto', at)
        const x = args[0]
        const y = args[1]
        if (typeof x !== 'number' || typeof y !== 'number') {
          throw new RuntimeError('E0303', 'goto expects two numbers', at.line, at.column)
        }
        this.lineTo(x, y)
        return null
      },
      print: (args, at) => {
        this.one(args, 'print', at)
        this.prints.push(showValue(args[0]))
        return null
      },
    }
  }

  private move(distance: number): void {
    const radians = (this.heading * Math.PI) / 180
    this.lineTo(this.x + distance * Math.sin(radians), this.y + distance * Math.cos(radians))
  }

  private lineTo(x: number, y: number): void {
    this.strokes.push({
      x1: this.x,
      y1: this.y,
      x2: x,
      y2: y,
      color: this.color,
      width: this.width,
      draw: this.penDown,
      heading: this.heading,
    })
    this.x = x
    this.y = y
  }

  private one(args: Value[], name: string, at: SourceLocation): void {
    if (args.length !== 1) this.arity(name, 1, args.length, at)
  }

  private two(args: Value[], name: string, at: SourceLocation): void {
    if (args.length !== 2) this.arity(name, 2, args.length, at)
  }

  private number(args: Value[], name: string, at: SourceLocation): number {
    this.one(args, name, at)
    if (typeof args[0] !== 'number') {
      throw new RuntimeError('E0304', `${name} expects a number`, at.line, at.column)
    }
    return args[0]
  }

  private arity(name: string, expected: number, got: number, at: SourceLocation): never {
    const noun = expected === 1 ? 'argument' : 'arguments'
    throw new RuntimeError('E0305', `${name} expects ${expected} ${noun}, got ${got}`, at.line, at.column)
  }
}

/** Run a program with the turtle commands and collect what it drew. */
export function trace(source: string, run: ProgramRunner = interpret): TurtleResult {
  const turtle = new Turtle()
  const stats = { steps: 0, maxCallDepth: 0 }
  run(source, { builtins: turtle.builtins(), stats })
  return {
    strokes: turtle.strokes,
    prints: turtle.prints,
    x: turtle.x,
    y: turtle.y,
    heading: turtle.heading,
    steps: stats.steps,
    maxCallDepth: stats.maxCallDepth,
  }
}

function showValue(value: Value, seen: Set<object> = new Set()): string {
  return textValue(value, seen)
}
