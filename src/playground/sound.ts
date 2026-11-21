import type { Cue, Wave } from '../audio.ts'

/**
 * Plays a speaker's cue list through Web Audio.
 * The timeline never calls this. `silence` cuts off anything still ringing.
 */

export interface SoundPlayer {
  /** Create the audio context during a click, so later ticks are allowed to play. */
  unlock(): void
  play(cues: readonly Cue[]): void
  silence(): void
}

export function createSoundPlayer(): SoundPlayer {
  let context: AudioContext | null = null
  const live: AudioScheduledSourceNode[] = []

  const ensure = (): AudioContext | null => {
    try {
      const Ctx = window.AudioContext
      if (!Ctx) return null
      if (!context) context = new Ctx()
      if (context.state === 'suspended') void context.resume().catch(() => undefined)
      return context
    } catch {
      return null
    }
  }

  return {
    unlock() {
      ensure()
    },
    play(cues) {
      const audio = ensure()
      if (!audio || cues.length === 0) return
      const when = audio.currentTime
      for (const cue of cues) schedule(audio, cue, when, live)
    },
    silence() {
      for (const node of live) {
        try {
          node.stop()
        } catch {
          /* The note already ended. */
        }
      }
      live.length = 0
    },
  }
}

function schedule(audio: AudioContext, cue: Cue, when: number, live: AudioScheduledSourceNode[]): void {
  if (cue.kind === 'tone') {
    note(audio, cue.wave, cue.freq, cue.freq, cue.duration, when, live)
    return
  }
  if (cue.name === 'hit') note(audio, 'square', 180, 180, 0.06, when, live)
  else if (cue.name === 'score') {
    note(audio, 'sine', 660, 660, 0.1, when, live)
    note(audio, 'sine', 880, 880, 0.12, when + 0.1, live)
  } else note(audio, 'saw', 120, 40, 0.4, when, live)
}

function note(
  audio: AudioContext,
  wave: Wave,
  freq: number,
  endFreq: number,
  duration: number,
  when: number,
  live: AudioScheduledSourceNode[],
): void {
  if (duration <= 0) return
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = wave === 'saw' ? 'sawtooth' : wave
  osc.frequency.setValueAtTime(freq, when)
  if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(endFreq, 1), when + duration)
  const end = when + duration
  const attack = Math.min(0.01, duration / 2)
  gain.gain.setValueAtTime(0.0001, when)
  gain.gain.exponentialRampToValueAtTime(0.18, when + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, end)
  osc.connect(gain)
  gain.connect(audio.destination)
  osc.start(when)
  osc.stop(end)
  live.push(osc)
  osc.onended = () => {
    const index = live.indexOf(osc)
    if (index >= 0) live.splice(index, 1)
  }
}
