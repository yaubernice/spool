import { describe, expect, it } from 'vitest'
import { Speaker } from '../src/audio.ts'
import { Display } from '../src/draw.ts'
import { InputState } from '../src/input.ts'
import { examples } from '../src/playground/examples.ts'
import { loadGame as loadTree, type Game } from '../src/interpreter.ts'
import { loadGame as loadVm } from '../src/vm.ts'

const source = examples.find((example) => example.name === 'Undo')!.code

function open(load: typeof loadVm): Game {
  return load(source, {
    seed: 1,
    modules: { draw: new Display().module(), input: new InputState().module(), audio: new Speaker().module() },
  })
}

describe('undo demo', () => {
  it('stays under 70 lines', () => {
    expect(source.trim().split('\n').length).toBeLessThanOrEqual(70)
  })

  for (const [name, load] of [
    ['tree-walker', loadTree],
    ['vm', loadVm],
  ] as const) {
    it(`${name} rewinds to the earlier score and energy`, () => {
      const past = open(load)
      past.frame([{ type: 'key', key: 'space' }])
      for (let frame = 0; frame < 60; frame++) past.frame([])

      const live = open(load)
      live.frame([{ type: 'key', key: 'space' }])
      for (let frame = 0; frame < 180; frame++) live.frame([])
      live.frame([{ type: 'key', key: 'space' }])
      expect(live.rewound()).toBe(true)
      expect(live.get('mode')).toBe(past.get('mode'))
      expect(live.get('score')).toBe(past.get('score'))
      expect(live.get('energy')).toEqual(past.get('energy'))
    })
  }
})
