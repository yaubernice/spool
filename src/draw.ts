import { isQuantity } from './data.ts'
import { RuntimeError } from './errors.ts'
import type { HostFunction, Value } from './interpreter.ts'
import type { SourceLocation } from './ast.ts'

/**
 * A list of draw commands. The interpreter records them.
 * The page paints the list later, on its own animation frame.
 */

export type DrawOp =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string }
  | { kind: 'circle'; x: number; y: number; r: number; color: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string }
  | { kind: 'text'; x: number; y: number; text: string; color: string }
  | { kind: 'sprite'; x: number; y: number; art: string; color: string }

export class Display {
  background = '#f4efe6'
  cameraX = 0
  cameraY = 0
  readonly ops: DrawOp[] = []
  used = false

  /** Drop the shapes from the previous frame. The background and camera stay. */
  begin(): void {
    this.ops.length = 0
  }

  module(): Record<string, HostFunction> {
    return {
      background: (args, at) => {
        this.used = true
        this.background = text(args, 'background', at)
        return null
      },
      camera: (args, at) => {
        this.used = true
        arity(args, 2, 'camera', at)
        const [x, y] = pair(args, 'camera', at)
        this.cameraX = x
        this.cameraY = y
        return null
      },
      rect: (args, at) => {
        this.used = true
        const [x, y, w, h, color] = box(args, 'rect', at)
        this.ops.push({ kind: 'rect', x, y, w, h, color })
        return null
      },
      circle: (args, at) => {
        this.used = true
        const [x, y, r, color] = circle(args, at)
        this.ops.push({ kind: 'circle', x, y, r, color })
        return null
      },
      line: (args, at) => {
        this.used = true
        const [x1, y1, x2, y2, color] = line(args, at)
        this.ops.push({ kind: 'line', x1, y1, x2, y2, color })
        return null
      },
      text: (args, at) => {
        this.used = true
        arity(args, 4, 'text', at)
        const [x, y] = pair(args, 'text', at)
        this.ops.push({ kind: 'text', x, y, text: stringAt(args, 2, 'text', at), color: stringAt(args, 3, 'text', at) })
        return null
      },
      sprite: (args, at) => {
        this.used = true
        if (args.length !== 3 && args.length !== 4) arity(args, 3, 'sprite', at)
        const [x, y] = pair(args, 'sprite', at)
        const art = stringAt(args, 2, 'sprite', at)
        const color = args.length === 4 ? stringAt(args, 3, 'sprite', at) : '#1c1917'
        this.ops.push({ kind: 'sprite', x, y, art, color })
        return null
      },
    }
  }
}

function box(args: Value[], name: string, at: SourceLocation): [number, number, number, number, string] {
  arity(args, 5, name, at)
  return [px(args[0], name, at), px(args[1], name, at), px(args[2], name, at), px(args[3], name, at), stringAt(args, 4, name, at)]
}

function circle(args: Value[], at: SourceLocation): [number, number, number, string] {
  arity(args, 4, 'circle', at)
  return [px(args[0], 'circle', at), px(args[1], 'circle', at), px(args[2], 'circle', at), stringAt(args, 3, 'circle', at)]
}

function line(args: Value[], at: SourceLocation): [number, number, number, number, string] {
  arity(args, 5, 'line', at)
  return [px(args[0], 'line', at), px(args[1], 'line', at), px(args[2], 'line', at), px(args[3], 'line', at), stringAt(args, 4, 'line', at)]
}

function pair(args: Value[], name: string, at: SourceLocation): [number, number] {
  if (args.length < 2) arity(args, 2, name, at)
  return [px(args[0], name, at), px(args[1], name, at)]
}

function text(args: Value[], name: string, at: SourceLocation): string {
  arity(args, 1, name, at)
  return stringAt(args, 0, name, at)
}

function px(value: Value, name: string, at: SourceLocation): number {
  if (typeof value === 'number') return value
  if (isQuantity(value) && value.unit.px === 1 && value.unit.s === 0) return value.value
  throw new RuntimeError('E0701', `${name} expects a number or a px quantity`, at.line, at.column)
}

function stringAt(args: Value[], index: number, name: string, at: SourceLocation): string {
  const value = args[index]
  if (typeof value !== 'string') {
    throw new RuntimeError('E0702', `${name} expects a string`, at.line, at.column)
  }
  return value
}

function arity(args: Value[], expected: number, name: string, at: SourceLocation): void {
  if (args.length !== expected) {
    const noun = expected === 1 ? 'argument' : 'arguments'
    throw new RuntimeError('E0703', `${name} expects ${expected} ${noun}, got ${args.length}`, at.line, at.column)
  }
}
