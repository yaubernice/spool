/**
 * Programs the benchmark panel runs on every backend.
 * Each sample is checked against `expect`, so a broken pass cannot
 * report a time for a program that returned the wrong value.
 * The entity program is a game: spawn once, then update every tick.
 */

import { countInstructions } from './bytecode.ts'
import { compile } from './compile.ts'
import { loadGame as loadTree, interpret } from './interpreter.ts'
import { optimize } from './optimize.ts'
import { parse } from './parser.ts'
import { loadGame as loadVm, interpretVm } from './vm.ts'

export interface BenchProgram {
  name: string
  source: string
  expect: number
  times: number
  /** When set, the sample runs this many game frames and reads `total`. */
  frames?: number
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
    name: '1000 entities',
    expect: 20000,
    times: 3,
    frames: 20,
    source: `entity Mote { n }
let total = 0
for i in 0..1000 {
  spawn Mote at (0px, 0px) { n: 0 }
}
on tick(dt) {
  each mote in Mote where true {
    mote.x = mote.x + 40px/s * dt
    mote.n = mote.n + 1
    total = total + 1
  }
}
`,
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

export type BenchEngine = 'tree' | 'vm' | 'opt'

/** Run one program on one backend and return the checked result. */
export function runBench(program: BenchProgram, engine: BenchEngine): number {
  const options: BenchOptions =
    engine === 'opt' ? { ...benchOptions, optimize: { fold: true, dce: true } } : benchOptions
  const value = program.frames ? runFrames(program, engine, options) : runScript(program, engine, options)
  if (value !== program.expect) {
    throw new Error(`${program.name} returned ${String(value)}`)
  }
  return value
}

function runScript(program: BenchProgram, engine: BenchEngine, options: BenchOptions): unknown {
  return engine === 'tree' ? interpret(program.source, options) : interpretVm(program.source, options)
}

function runFrames(program: BenchProgram, engine: BenchEngine, options: BenchOptions): unknown {
  const game = engine === 'tree' ? loadTree(program.source, options) : loadVm(program.source, options)
  for (let frame = 0; frame < (program.frames ?? 0); frame++) game.frame([])
  return game.get('total')
}

/** How many instructions constant folding removes from `1 + 2 * 3`. */
export function foldCounts(): { source: string; before: number; after: number } {
  const source = '1 + 2 * 3'
  const raw = compile(parse(source))
  const after = optimize(raw, { fold: true, dce: true })
  return { source, before: countInstructions(raw), after: countInstructions(after) }
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
