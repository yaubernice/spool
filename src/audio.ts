import type { SourceLocation } from './ast.ts'
import { isQuantity } from './data.ts'
import { RuntimeError } from './errors.ts'
import type { HostFunction, Value } from './interpreter.ts'

/**
 * Sounds a program asked for. The interpreter only appends to this list.
 * The page plays it later, and stays quiet while a recording is scrubbed.
 */

export type Wave = 'sine' | 'square' | 'triangle' | 'saw'
export type SoundName = 'hit' | 'score' | 'boom'

export type Cue =
  | { kind: 'tone'; wave: Wave; freq: number; duration: number }
  | { kind: 'play'; name: SoundName }

const WAVES: readonly Wave[] = ['sine', 'square', 'triangle', 'saw']
const NAMES: readonly SoundName[] = ['hit', 'score', 'boom']

export class Speaker {
  readonly cues: Cue[] = []
  used = false

  /** Drop the sounds from the previous frame. */
  begin(): void {
    this.cues.length = 0
  }

  module(): Record<string, HostFunction> {
    return {
      beep: (args, at) => {
        this.used = true
        arity(args, 2, 'beep', at)
        this.cues.push({ kind: 'tone', wave: 'square', freq: frequency(args[0], 'beep', at), duration: seconds(args[1], 'beep', at) })
        return null
      },
      tone: (args, at) => {
        this.used = true
        arity(args, 3, 'tone', at)
        this.cues.push({
          kind: 'tone',
          wave: wave(args[0], at),
          freq: frequency(args[1], 'tone', at),
          duration: seconds(args[2], 'tone', at),
        })
        return null
      },
      play: (args, at) => {
        this.used = true
        arity(args, 1, 'play', at)
        this.cues.push({ kind: 'play', name: soundName(args[0], at) })
        return null
      },
    }
  }
}

function frequency(value: Value, name: string, at: SourceLocation): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RuntimeError('E1001', `${name} expects a frequency, a plain number above 0`, at.line, at.column)
  }
  return value
}

function seconds(value: Value, name: string, at: SourceLocation): number {
  if (!isQuantity(value) || value.unit.px !== 0 || value.unit.s !== 1 || value.value < 0 || !Number.isFinite(value.value)) {
    throw new RuntimeError('E1002', `${name} expects a time in seconds, like 0.2s`, at.line, at.column)
  }
  return value.value
}

function wave(value: Value, at: SourceLocation): Wave {
  if (typeof value === 'string' && (WAVES as readonly string[]).includes(value)) return value as Wave
  throw new RuntimeError('E1004', "tone expects a wave: sine, square, triangle, or saw", at.line, at.column)
}

function soundName(value: Value, at: SourceLocation): SoundName {
  if (typeof value === 'string' && (NAMES as readonly string[]).includes(value)) return value as SoundName
  throw new RuntimeError('E1005', 'play expects "hit", "score", or "boom"', at.line, at.column)
}

function arity(args: Value[], expected: number, name: string, at: SourceLocation): void {
  if (args.length !== expected) {
    const noun = expected === 1 ? 'argument' : 'arguments'
    throw new RuntimeError('E1003', `${name} expects ${expected} ${noun}, got ${args.length}`, at.line, at.column)
  }
}
