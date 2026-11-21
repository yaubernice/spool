import { isQuantity, quantity, type Quantity } from './data.ts'
import { RuntimeError } from './errors.ts'

/** One update of the game clock. 60 of these make one second. */
export const TICK_DT: Quantity = quantity(1 / 60, { px: 0, s: 1 })

export interface KeyEvent {
  type: 'key' | 'key_up'
  key: string
}

/** One recorded frame: keys, plus any REPL lines typed before it. */
export interface FrameTape {
  events: KeyEvent[]
  repl: string[]
}

/** How many 60Hz ticks a time in seconds lasts. `1.5s` is 90. */
export function ticksFor(value: unknown, at: { line: number; column: number }, what = 'wait'): number {
  if (!isQuantity(value) || value.unit.px !== 0 || value.unit.s !== 1 || value.value < 0 || !Number.isFinite(value.value)) {
    throw new RuntimeError('E0902', `${what} expects a time in seconds, like 1.5s`, at.line, at.column)
  }
  return Math.round(value.value * 60)
}
