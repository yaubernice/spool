import { benchOptions, benchPrograms, medianMilliseconds } from '../benchmark.ts'
import type { Value } from '../interpreter.ts'
import { interpret } from '../interpreter.ts'
import { interpretVm } from '../vm.ts'

export interface BenchRow {
  name: string
  tree: number
  vm: number
  optimized: number
  speedupVm: number
  speedupOptimized: number
}

self.onmessage = () => {
  try {
    for (const program of benchPrograms) {
      const tree = sample(() => interpret(program.source, benchOptions), program.expect, program.name)
      const vm = sample(() => interpretVm(program.source, benchOptions), program.expect, program.name)
      const optimized = sample(
        () => interpretVm(program.source, { ...benchOptions, optimize: { fold: true, dce: true } }),
        program.expect,
        program.name,
      )
      const row: BenchRow = {
        name: program.name,
        tree,
        vm,
        optimized,
        speedupVm: tree / vm,
        speedupOptimized: tree / optimized,
      }
      self.postMessage({ type: 'row', row })
    }
    self.postMessage({ type: 'done' })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Benchmark failed' })
  }
}

function sample(run: () => Value, expect: number, name: string): number {
  return medianMilliseconds(() => {
    const value = run()
    if (value !== expect) throw new Error(`${name} returned ${String(value)}`)
  }, benchPrograms.find((program) => program.name === name)?.times ?? 5)
}
