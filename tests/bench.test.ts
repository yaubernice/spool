import { describe, expect, it } from 'vitest'
import { benchPrograms, foldCounts, medianMilliseconds, runBench } from '../src/benchmark.ts'

describe('benchmarks', () => {
  it('folds 1 + 2 * 3 down to fewer instructions', () => {
    const counts = foldCounts()
    expect(counts.source).toBe('1 + 2 * 3')
    expect(counts.after).toBeLessThan(counts.before)
  })

  it('takes the middle sample after one warmup', () => {
    let calls = 0
    const mid = medianMilliseconds(() => {
      calls += 1
    }, 3)
    expect(calls).toBe(4)
    expect(mid).toBeGreaterThanOrEqual(0)
  })

  for (const program of benchPrograms) {
    it(
      `${program.name} agrees on every engine`,
      () => {
        expect(runBench(program, 'tree')).toBe(program.expect)
        expect(runBench(program, 'vm')).toBe(program.expect)
        expect(runBench(program, 'opt')).toBe(program.expect)
      },
      30_000,
    )
  }
})
