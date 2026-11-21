/**
 * The page inside an exported HTML file.
 * It reads the program from `<script type="text/spool">` and plays it.
 * No editor, no timeline. The same VM, the same modules, the same clock.
 */

import { Speaker } from './audio.ts'
import type { KeyEvent } from './clock.ts'
import { Display } from './draw.ts'
import { InputState } from './input.ts'
import { paintDisplay, playDrawing } from './playground/canvas.ts'
import { createSoundPlayer } from './playground/sound.ts'
import { Turtle } from './turtle.ts'
import { openVm } from './vm.ts'

const source = document.querySelector('script[type="text/spool"]')?.textContent ?? ''
const canvas = document.querySelector<HTMLCanvasElement>('#stage')
const errorBox = document.querySelector<HTMLElement>('#spool-error')

if (canvas) {
  try {
    play(canvas, source)
  } catch (error) {
    report(error)
  }
}

function play(stage: HTMLCanvasElement, program: string): void {
  const seed = readSeed()
  const turtle = new Turtle()
  const commands = turtle.builtins()
  const display = new Display()
  const input = new InputState()
  const speaker = new Speaker()
  const sounds = createSoundPlayer()
  const opened = openVm(program, {
    builtins: commands,
    modules: { turtle: commands, draw: display.module(), input: input.module(), audio: speaker.module() },
    seed,
    optimize: { fold: true, dce: true },
  })
  let step = opened.generator.next()
  while (!step.done) step = opened.generator.next()
  sounds.unlock()
  sounds.play(speaker.cues)
  if (display.used) paintDisplay(stage, display)
  else playDrawing(stage, turtle.strokes, () => 160, turtle)
  if (opened.handlerCount() === 0) return

  stage.focus()
  const keys: KeyEvent[] = []
  const typing = (event: Event) => {
    const target = event.target
    return target instanceof HTMLElement && target.closest('input, textarea') !== null
  }
  window.addEventListener('keydown', (event) => {
    if (event.repeat || typing(event)) return
    sounds.unlock()
    event.preventDefault()
    const key = keyName(event)
    input.press(key)
    keys.push({ type: 'key', key })
  })
  window.addEventListener('keyup', (event) => {
    if (typing(event)) return
    input.release(keyName(event))
    keys.push({ type: 'key_up', key: keyName(event) })
  })
  stage.addEventListener('mousemove', (event) => {
    const rect = stage.getBoundingClientRect()
    input.x = event.clientX - rect.left
    input.y = event.clientY - rect.top
  })
  stage.addEventListener('mousedown', () => {
    sounds.unlock()
    input.click = true
  })

  let last = performance.now()
  let acc = 0
  let playback: { stop: () => void } | null = null
  const stepMs = 1000 / 60
  const loop = (now: number) => {
    acc += Math.min(now - last, 100)
    last = now
    let guard = 0
    try {
      while (acc >= stepMs && guard < 5) {
        acc -= stepMs
        display.begin()
        speaker.begin()
        const events = keys.splice(0, keys.length)
        opened.frame(events)
        input.endFrame()
        sounds.play(speaker.cues)
        guard++
      }
    } catch (error) {
      report(error)
      return
    }
    playback?.stop()
    if (display.used) paintDisplay(stage, display)
    else playback = playDrawing(stage, turtle.strokes, () => Number.POSITIVE_INFINITY, turtle)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
}

function readSeed(): number {
  const raw = Number(new URLSearchParams(location.search).get('seed') ?? '1')
  return Number.isFinite(raw) ? Math.trunc(raw) : 1
}

function keyName(event: KeyboardEvent): string {
  if (event.key === ' ') return 'space'
  if (event.key === 'ArrowLeft') return 'left'
  if (event.key === 'ArrowRight') return 'right'
  if (event.key === 'ArrowUp') return 'up'
  if (event.key === 'ArrowDown') return 'down'
  return event.key.toLowerCase()
}

function report(error: unknown): void {
  if (!errorBox) return
  errorBox.textContent = error instanceof Error ? error.message : 'The program stopped.'
}
