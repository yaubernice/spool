import { quantity } from './data.ts'
import { RuntimeError } from './errors.ts'
import type { HostFunction, Value } from './interpreter.ts'
import type { SourceLocation } from './ast.ts'

/**
 * Keys, the pointer, and clicks for one running program.
 * The page writes this. The interpreter only reads it.
 */

export class InputState {
  private readonly held = new Set<string>()
  x = 0
  y = 0
  /** True after the button goes down, until the frame ends. */
  click = false

  press(key: string): void {
    this.held.add(key)
  }

  release(key: string): void {
    this.held.delete(key)
  }

  endFrame(): void {
    this.click = false
  }

  capture(): { held: string[]; x: number; y: number } {
    return { held: [...this.held], x: this.x, y: this.y }
  }

  adopt(shot: { held: string[]; x: number; y: number }): void {
    this.held.clear()
    for (const key of shot.held) this.held.add(key)
    this.x = shot.x
    this.y = shot.y
    this.click = false
  }

  module(): Record<string, HostFunction> {
    return {
      key: (args, at) => {
        one(args, 'key', at)
        if (typeof args[0] !== 'string') {
          throw new RuntimeError('E0702', 'key expects a string', at.line, at.column)
        }
        return this.held.has(args[0])
      },
      mouse: (args, at) => {
        none(args, 'mouse', at)
        const unit = { px: 1, s: 0 }
        return { type: 'vec', x: quantity(this.x, unit), y: quantity(this.y, unit) }
      },
      click: (args, at) => {
        none(args, 'click', at)
        return this.click
      },
    }
  }
}

function one(args: Value[], name: string, at: SourceLocation): void {
  if (args.length !== 1) {
    throw new RuntimeError('E0703', `${name} expects 1 argument, got ${args.length}`, at.line, at.column)
  }
}

function none(args: Value[], name: string, at: SourceLocation): void {
  if (args.length !== 0) {
    throw new RuntimeError('E0703', `${name} expects 0 arguments, got ${args.length}`, at.line, at.column)
  }
}
