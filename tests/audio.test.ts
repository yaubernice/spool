import { describe, expect, it } from 'vitest'
import { Speaker } from '../src/audio.ts'
import { RuntimeError } from '../src/errors.ts'
import { loadGame as loadTree } from '../src/interpreter.ts'
import { loadGame as loadVm } from '../src/vm.ts'

const engines = [
  ['tree-walker', loadTree],
  ['vm', loadVm],
] as const

const source = `use audio
on tick(dt) {
  audio.beep(440, 0.05s)
  audio.tone("sine", 880, 0.2s)
  audio.play("score")
}`

for (const [engine, load] of engines) {
  describe(`audio (${engine})`, () => {
    it('records a beep, a tone, and a named sound', () => {
      const speaker = new Speaker()
      const game = load(source, { modules: { audio: speaker.module() } })
      speaker.begin()
      game.frame([])
      expect(speaker.cues).toEqual([
        { kind: 'tone', wave: 'square', freq: 440, duration: 0.05 },
        { kind: 'tone', wave: 'sine', freq: 880, duration: 0.2 },
        { kind: 'play', name: 'score' },
      ])
      speaker.begin()
      expect(speaker.cues).toEqual([])
    })

    it('rejects a bad frequency, duration, wave, name, or arity', () => {
      const speaker = new Speaker()
      const modules = { audio: speaker.module() }
      expect(() => load('use audio\naudio.beep(440px, 0.1s)', { modules })).toThrow(/plain number/)
      expect(() => load('use audio\naudio.beep(440, 0.1)', { modules })).toThrow(/time in seconds/)
      expect(() => load('use audio\naudio.tone("noise", 440, 0.1s)', { modules })).toThrow(/wave/)
      expect(() => load('use audio\naudio.play("honk")', { modules })).toThrow(/hit/)
      expect(() => load('use audio\naudio.beep(440)', { modules })).toThrow(RuntimeError)
      expect(() => load('use audio\naudio.beep(440)', { modules })).toThrow(/expects 2 arguments/)
    })
  })
}
