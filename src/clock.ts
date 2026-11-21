import { quantity, type Quantity } from './data.ts'

/** One update of the game clock. 60 of these make one second. */
export const TICK_DT: Quantity = quantity(1 / 60, { px: 0, s: 1 })

export interface KeyEvent {
  type: 'key' | 'key_up'
  key: string
}
