import { describe, expect, it } from 'vitest'
import type { KeyEvent } from '../src/clock.ts'
import { openVm } from '../src/vm.ts'

function drain(session: ReturnType<typeof openVm>): void {
  let step = session.generator.next()
  while (!step.done) step = session.generator.next()
}

function play(source: string, events: KeyEvent[][], seed = 1): ReturnType<typeof openVm> {
  const session = openVm(source, { seed })
  drain(session)
  for (const frame of events) session.frame(frame)
  return session
}

describe('rewind', () => {
  it('restores a game and replays the same frames', () => {
    const source = `let n = 0
on tick(dt) { n = n + 1 + random() }
on key "a" { n = n + 10 }`
    const events: KeyEvent[][] = [[], [{ type: 'key', key: 'a' }], [], [], [], []]
    const full = play(source, events)
    const session = openVm(source, { seed: 1 })
    drain(session)
    for (const frame of events.slice(0, 2)) session.frame(frame)
    const saved = JSON.parse(JSON.stringify(session.image()))
    expect(JSON.stringify(saved)).not.toContain('function')
    for (const frame of events.slice(2)) session.frame(frame)
    expect(session.read('n')).toBe(full.read('n'))
    session.restore(saved)
    expect(session.read('n')).not.toBe(full.read('n'))
    for (const frame of events.slice(2)) session.frame(frame)
    expect(session.read('n')).toBe(full.read('n'))
  })

  it('keeps a waiting task, a collision, and entity types', () => {
    const source = `entity Ball { r }
let n = 0
let woke = 0
let a = spawn Ball at (0px, 0px) { r: 2px }
let b = spawn Ball at (10px, 0px) { r: 2px }
on tick(dt) {
  b.x = b.x - 1px
  spawn Ball at (0px, 20px) { r: 1px }
}
when left in Ball touches right in Ball { n = n + 1 }
task later {
  wait 0.5s
  woke = 1
}`
    const frames = 40
    const full = play(source, Array.from({ length: frames }, () => []))
    const session = openVm(source, { seed: 1 })
    drain(session)
    for (let i = 0; i < 10; i++) session.frame([])
    const saved = JSON.parse(JSON.stringify(session.image()))
    expect(session.read('woke')).toBe(0)
    session.restore(saved)
    for (let i = 0; i < frames - 10; i++) session.frame([])
    expect(session.read('n')).toBe(full.read('n'))
    expect(session.read('woke')).toBe(1)
    expect(session.glance().entities.length).toBe(full.glance().entities.length)
  })
})
