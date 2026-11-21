import { describe, expect, it } from 'vitest'
import { interpretVm, openVm, resumeVm } from '../src/vm.ts'

const source = `fn make() {
  let x = 10
  fn add(y) { return x + y }
  return add
}
let f = make()
f(1) + random()`

describe('vm image', () => {
  it('resumes a saved machine and matches a full run', () => {
    const full = interpretVm(source, { seed: 7 })
    const session = openVm(source, { seed: 7 })
    let step = session.generator.next()
    while (!step.done && step.value.line < 7) step = session.generator.next()
    const saved = JSON.parse(JSON.stringify(session.image()))
    expect(saved.frames.length).toBeGreaterThan(0)
    expect(JSON.stringify(saved)).not.toContain('function')
    expect(resumeVm(source, saved, { seed: 7 })).toBe(full)
  })
})
