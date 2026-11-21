/**
 * Programs the benchmark panel runs on every backend.
 * The sort is bubble sort of 5000 reversed numbers, so every backend
 * does the same comparisons. `expect` is checked so a broken pass
 * cannot report a time for an empty program.
 */

export interface BenchProgram {
  name: string
  source: string
  expect: number
  times: number
}

export const benchPrograms: BenchProgram[] = [
  {
    name: 'fib(27)',
    expect: 196418,
    times: 5,
    source: `fn fib(n) {
  if n < 2 { return n }
  return fib(n - 1) + fib(n - 2)
}
fib(27)`,
  },
  {
    name: 'nested loop',
    expect: 120000,
    times: 5,
    source: `let s = 0
for i in 0..200 {
  for j in 0..200 {
    s = s + 1 + 2
  }
}
s`,
  },
  {
    name: 'sort of 5000',
    expect: 1,
    times: 3,
    source: `let n = 5000
let a = []
for i in 0..n {
  push(a, n - i)
}
for i in 0..n {
  for j in 0..(n - 1) {
    if a[j] > a[j + 1] {
      let tmp = a[j]
      a[j] = a[j + 1]
      a[j + 1] = tmp
    }
  }
}
a[0]`,
  },
]

export interface BenchOptions {
  maxSteps: number
  maxCallDepth: number
  seed: number
  optimize?: { fold: boolean; dce: boolean }
}

export const benchOptions: BenchOptions = {
  maxSteps: 100_000_000,
  maxCallDepth: 100_000,
  seed: 1,
}

/** One warmup, then the median of `times` samples, in milliseconds. */
export function medianMilliseconds(run: () => void, times: number): number {
  run()
  const samples: number[] = []
  for (let i = 0; i < times; i++) {
    const started = performance.now()
    run()
    samples.push(performance.now() - started)
  }
  samples.sort((left, right) => left - right)
  return samples[Math.floor((samples.length - 1) / 2)]
}
