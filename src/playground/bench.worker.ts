import { benchPrograms, medianMilliseconds, runBench, type BenchEngine, type BenchProgram } from '../benchmark.ts'

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
      const tree = sample(program, 'tree')
      const vm = sample(program, 'vm')
      const optimized = sample(program, 'opt')
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

function sample(program: BenchProgram, engine: BenchEngine): number {
  return medianMilliseconds(() => {
    runBench(program, engine)
  }, program.times)
}
