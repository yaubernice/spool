import { describe, expect, it } from 'vitest'
import { Speaker } from '../src/audio.ts'
import type { KeyEvent } from '../src/clock.ts'
import { Display } from '../src/draw.ts'
import { InputState } from '../src/input.ts'
import { loadGame as loadTree } from '../src/interpreter.ts'
import { examples } from '../src/playground/examples.ts'
import { loadGame as loadVm } from '../src/vm.ts'

/** Games in the gallery. Each one is a real program the page can load. */
const GAMES = ['Pong', 'Snake', 'Breakout', 'Asteroids', 'Flappy']

const keys: Record<string, string[]> = {
  Pong: ['w'],
  Snake: ['down'],
  Breakout: ['left'],
  Asteroids: ['left', 'up', 'space'],
  Flappy: [],
}

function play(load: typeof loadVm, source: string, name: string, optimize: boolean): { ops: Display['ops']; read: (name: string) => unknown } {
  const display = new Display()
  const input = new InputState()
  const speaker = new Speaker()
  const game = load(source, {
    seed: 1,
    modules: { draw: display.module(), input: input.module(), audio: speaker.module() },
    ...(optimize ? { optimize: { fold: true, dce: true } } : {}),
  })
  expect(game.hasHandlers()).toBe(true)
  for (const key of keys[name] ?? []) input.press(key)
  for (let frame = 0; frame < 180; frame++) {
    display.begin()
    speaker.begin()
    const events: KeyEvent[] = name === 'Flappy' && frame % 25 === 0 ? [{ type: 'key', key: 'space' }] : []
    game.frame(events)
  }
  expect(display.ops.length).toBeGreaterThan(0)
  return { ops: display.ops, read: (binding) => game.get(binding) }
}

describe('gallery games', () => {
  for (const name of GAMES) {
    const example = examples.find((item) => item.name === name)
    it(`${name} stays under 80 lines and runs`, () => {
      expect(example).toBeTruthy()
      const source = example!.code
      expect(source.trim().split('\n').length).toBeLessThanOrEqual(80)
      const tree = play(loadTree, source, name, false)
      const vm = play(loadVm, source, name, false)
      const opt = play(loadVm, source, name, true)
      const texts = (ops: Display['ops']) => ops.filter((op) => op.kind === 'text').map((op) => op.text)
      expect(texts(tree.ops)).toEqual(texts(vm.ops))
      expect(texts(opt.ops)).toEqual(texts(vm.ops))
      if (name === 'Pong') {
        const paddle = vm.ops.find((op) => op.kind === 'rect')
        expect(paddle && paddle.kind === 'rect' && paddle.y).toBeLessThan(90)
      }
      if (name === 'Snake') expect(texts(vm.ops)).toContain('crashed')
      if (name === 'Breakout') expect(Number(vm.read('score'))).toBeGreaterThan(0)
      if (name === 'Asteroids') expect(vm.ops.some((op) => op.kind === 'line')).toBe(true)
      if (name === 'Flappy') expect(vm.ops.some((op) => op.kind === 'rect')).toBe(true)
    })
  }
})
