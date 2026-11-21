/**
 * A tiny deterministic generator.
 * The same seed always produces the same sequence.
 * `random()` in a seeded run draws from one of these, in call order.
 */

/** A seeded generator whose `state` can be saved and put back. */
export interface SeededRandom {
  (): number
  state: number
}

export function mulberry32(seed: number): SeededRandom {
  const next = (() => {
    let state = next.state
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    next.state = state >>> 0
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }) as SeededRandom
  next.state = seed >>> 0
  return next
}
