import './playground/design.css'
import './style.css'
import { foldCounts } from './benchmark.ts'
import { gamePage } from './export.ts'
import { disassemble } from './bytecode.ts'
import type { KeyEvent } from './clock.ts'
import { compile } from './compile.ts'
import { SourceError } from './errors.ts'
import { formatValue, type DebugPause, type ExecutionStats, type ScopeSnapshot, type StackFrame, type Value } from './interpreter.ts'
import { optimize } from './optimize.ts'
import { parse } from './parser.ts'
import type { BenchRow } from './playground/bench.worker.ts'
import { Speaker } from './audio.ts'
import { Display, type DrawOp } from './draw.ts'
import type { VmImage } from './image.ts'
import { InputState } from './input.ts'
import { fieldPoint, type DebugOverlay } from './playground/canvas.ts'
import { createSoundPlayer } from './playground/sound.ts'
import { paintDisplay, playDrawing, type Playback } from './playground/canvas.ts'
import { spoolWords } from './playground/complete.ts'
import { createEditor } from './playground/editor.ts'
import { examples } from './playground/examples.ts'
import {
  controlsHint,
  entityShape,
  isModified,
  library,
  libraryFile,
  originCode,
  readLibraryCode,
  nextUntitledName,
  readUserFiles,
  resetLibraryCode,
  tidyUserFiles,
  saveLibraryCode,
  writeUserFiles,
  type UserFile,
} from './playground/files.ts'
import { iconEl, mountIcons } from './playground/icons.ts'
import { attachMascot, pipkinMarkup } from './playground/mascot.ts'
import { studioHtml } from './playground/shell.ts'
import type { EntityShot } from './vm.ts'
import {
  countNodes,
  inspectSource,
  markInstruction,
  markTreeCursor,
  renderBytecode,
  renderEntities,
  renderOutput,
  renderScopes,
  renderStack,
  renderTokens,
  renderTree,
  spanFromNode,
  type Inspection,
} from './playground/inspector.ts'
import type { Stroke } from './turtle.ts'
import { Turtle } from './turtle.ts'
import { openVm } from './vm.ts'

const TRACE_CAP = 10_000
/** A rewind snapshot covers this many game frames. */
const SNAP_EVERY = 4
/** How many snapshots the timeline keeps. Older play is dropped. */
const SNAP_CAP = 240

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app')

const savedTheme = localStorage.getItem('tiny-theme')
document.documentElement.dataset.theme = savedTheme === 'light' ? 'light' : 'dark'

app.innerHTML = studioHtml
mountIcons(app)
const pipkin = attachMascot(document.querySelector('#mascot-slot')!, document.querySelector('#mascot-float')!)

const layout = readLayout()
document.documentElement.style.setProperty('--side-w', `${layout.side}px`)
document.documentElement.style.setProperty('--preview-w', `${layout.preview}px`)
document.documentElement.style.setProperty('--bottom-h', `${layout.bottom}px`)

const runButton = document.querySelector<HTMLButtonElement>('#run')!
const stepButton = document.querySelector<HTMLButtonElement>('#step')!
const pauseButton = document.querySelector<HTMLButtonElement>('#pause')!
const continueButton = document.querySelector<HTMLButtonElement>('#continue')!
const stopButton = document.querySelector<HTMLButtonElement>('#stop')!
const themeButton = document.querySelector<HTMLButtonElement>('#theme')!
const speedInput = document.querySelector<HTMLInputElement>('#speed')!
const seedInput = document.querySelector<HTMLInputElement>('#seed')!
const backButton = document.querySelector<HTMLButtonElement>('#back')!
const forwardButton = document.querySelector<HTMLButtonElement>('#forward')!
const timeline = document.querySelector<HTMLInputElement>('#timeline')!
const traceNote = document.querySelector<HTMLSpanElement>('#trace-note')!
const timeReadout = document.querySelector<HTMLSpanElement>('#time-readout')!
const foldBox = document.querySelector<HTMLInputElement>('#pass-fold')!
const dceBox = document.querySelector<HTMLInputElement>('#pass-dce')!
const bytecodeView = document.querySelector<HTMLElement>('#bytecode-view')!
const exportButton = document.querySelector<HTMLButtonElement>('#export')!
const benchButton = document.querySelector<HTMLButtonElement>('#bench-run')!
const benchFold = document.querySelector<HTMLElement>('#bench-fold')!
const benchStatus = document.querySelector<HTMLElement>('#bench-status')!
const benchTable = document.querySelector<HTMLElement>('#bench-table')!
const folded = foldCounts()
benchFold.textContent = `Constant folding turns "${folded.source}" from ${folded.before} instructions to ${folded.after}. The Bytecode tab shows the open program before and after.`
const runState = document.querySelector<HTMLSpanElement>('#run-state')!
const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!
const editorHost = document.querySelector<HTMLDivElement>('#editor')!
const welcome = document.querySelector<HTMLElement>('#welcome')!
const banner = document.querySelector<HTMLPreElement>('#banner')!
const panes = {
  problems: document.querySelector<HTMLElement>('[data-pane="problems"]')!,
  output: document.querySelector<HTMLElement>('[data-pane="output"]')!,
  tokens: document.querySelector<HTMLElement>('[data-pane="tokens"]')!,
  ast: document.querySelector<HTMLElement>('[data-pane="ast"]')!,
  variables: document.querySelector<HTMLElement>('[data-pane="variables"]')!,
  entities: document.querySelector<HTMLElement>('[data-pane="entities"]')!,
  stack: document.querySelector<HTMLElement>('[data-pane="stack"]')!,
  bytecode: document.querySelector<HTMLElement>('[data-pane="bytecode"]')!,
  bench: document.querySelector<HTMLElement>('[data-pane="bench"]')!,
}

const editor = createEditor(editorHost, '', onEdit, run, onCursor)

interface RewindShot {
  image: VmImage
  inputLength: number
  held: string[]
  x: number
  y: number
  background: string
  cameraX: number
  cameraY: number
  ops: DrawOp[]
  view: DebugPause
}

interface TraceFrame {
  line: number
  column: number
  ip: number
  chunk: string
  scopes: ScopeSnapshot[]
  entities: DebugPause['entities']
  stack: StackFrame[]
  steps: number
  maxCallDepth: number
  strokeCount: number
  x: number
  y: number
  heading: number
}

let playback: Playback | null = null
let inspection: Inspection = { tokens: null, program: null, banner: null }
let inspectTimer = 0
let cursorLine = 1
let cursorColumn = 1
let prints: string[] = []
let session: {
  iterator: Generator<DebugPause, Value, void>
  turtle: Turtle
  stats: ExecutionStats
  finalPause: () => DebugPause
} | null = null
let stopContinue = false
let pumping = false
let seed = 1
let strokes: Stroke[] = []
let frames: TraceFrame[] = []
let traceIndex = 0
let traceTruncated = false
let benchWorker: Worker | null = null
let benchRows: BenchRow[] = []
let clock = 0
let keyQueue: KeyEvent[] = []
const inputLog: KeyEvent[][] = []
const liveInput = new InputState()
const sounds = createSoundPlayer()
let display = new Display()
let speaker = new Speaker()
let live: ReturnType<typeof openVm> | null = null
let shots: RewindShot[] = []
let shotIndex = 0
let rewinding = false
let scrubbing = false
let resumePlay = false
let toldFull = false
let washUntil = 0
let ghostMarks: { x: number; y: number }[] = []
const trail: { x: number; y: number }[][] = []
const GUIDE = [
  'Drag the timeline to rewind time',
  'Alt-click a number in the code to change it live',
  'Click a game object to inspect it',
]
let guideStep = 0
let gamePaused = false
let stepOnce = false
let muted = localStorage.getItem('spool-muted') !== '0'
let autoRun = localStorage.getItem('spool-autorun') !== '0'
let selectedId: number | null = null
let dragging = false
let reloadTimer = 0
let toastTimer = 0
let lastShape = ''
let logFilter: 'all' | 'print' | 'error' = 'all'
let problems: { code: string; message: string; line: number; column: number }[] = []
let currentId: string | null = null
let sharing = false
let gallery = localStorage.getItem('spool-gallery') !== '0'
let focusOn = false
let userFiles: UserFile[] = tidyUserFiles(readUserFiles())
writeUserFiles(userFiles)
const openIds: string[] = []
let suppressEdit = false
const collapsed = new Set<string>()
let sideOpen = layout.sideOpen
let bottomOpen = layout.bottomOpen
let frameStamp = performance.now()
let fps = 0

const autoRunBox = document.querySelector<HTMLInputElement>('#auto-run')!
autoRunBox.checked = autoRun

runButton.addEventListener('click', () => run())
stepButton.addEventListener('click', () => (clock ? stepGame() : step()))
pauseButton.addEventListener('click', () => (clock ? toggleGamePause() : pause()))
continueButton.addEventListener('click', () => {
  if (clock) {
    gamePaused = false
    resumePlay = true
    return
  }
  void continueRun()
})
stopButton.addEventListener('click', () => halt('Stopped'))
backButton.addEventListener('click', stepBack)
forwardButton.addEventListener('click', stepForward)
document.querySelector('#scrub-play')!.addEventListener('click', () => {
  if (clock) toggleGamePause()
  else if (shots.length > 0) resumePlay = true
})
timeline.addEventListener('input', () => {
  if (shots.length > 0) showRewind(Number(timeline.value))
  else showTrace(Number(timeline.value))
  paintTime()
})
timeline.addEventListener('pointerdown', () => {
  if (shots.length === 0) return
  scrubbing = true
  pipkin.noteScrub(true)
  sounds.silence()
})
window.addEventListener('pointerup', () => {
  if (!scrubbing) return
  scrubbing = false
  pipkin.noteScrub(false)
  resumePlay = true
  dragging = false
})
seedInput.addEventListener('change', () => {
  const next = Number(seedInput.value)
  seed = Number.isFinite(next) ? Math.trunc(next) : 1
  seedInput.value = String(seed)
  writeHash(editor.getCode())
})
autoRunBox.addEventListener('change', () => {
  autoRun = autoRunBox.checked
  localStorage.setItem('spool-autorun', autoRun ? '1' : '0')
})
foldBox.addEventListener('change', onPasses)
dceBox.addEventListener('change', onPasses)
benchButton.addEventListener('click', runBenchmarks)
exportButton.addEventListener('click', () => void exportGame())
themeButton.addEventListener('click', toggleTheme)
document.querySelector('#palette-open')!.addEventListener('click', openPalette)
document.querySelector('#new-file')!.addEventListener('click', newFile)
document.querySelector('#duplicate-file')!.addEventListener('click', duplicateFile)
document.querySelector('#reset-file')!.addEventListener('click', resetFile)
document.querySelector('#filter')!.addEventListener('input', renderFiles)
document.querySelector('#search-box')!.addEventListener('input', renderSearch)
document.querySelector('#mute')!.addEventListener('click', toggleMute)
document.querySelector('#fullscreen')!.addEventListener('click', () => {
  const frame = document.querySelector('#stage-frame')!
  if (document.fullscreenElement) void document.exitFullscreen()
  else void frame.requestFullscreen()
})
document.querySelector('#debug-menu')!.addEventListener('click', () => {
  const pop = document.querySelector<HTMLElement>('#debug-pop')!
  pop.hidden = !pop.hidden
})
for (const id of ['dbg-bounds', 'dbg-labels', 'dbg-velocity', 'dbg-grid', 'dbg-fps']) {
  document.querySelector(`#${id}`)!.addEventListener('change', () => {
    document.querySelector<HTMLElement>('#hud')!.hidden = !debugOn('dbg-fps')
    repaint()
  })
}
const playOverlay = document.querySelector<HTMLElement>('#play-overlay')!
playOverlay.addEventListener('pointerdown', (event) => {
  event.preventDefault()
  canvas.focus()
  playOverlay.hidden = true
})
document.addEventListener('focusin', (event) => {
  playOverlay.hidden = event.target === canvas
})
document.querySelector('#out-clear')!.addEventListener('click', () => {
  prints = []
  showConsole(null)
})
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-log]')) {
  button.addEventListener('click', () => {
    logFilter = (button.dataset.log as 'all' | 'print' | 'error') ?? 'all'
    for (const item of document.querySelectorAll<HTMLButtonElement>('[data-log]')) item.classList.toggle('active', item === button)
    showConsole(null)
  })
}
document.querySelector('#stat-problems')!.addEventListener('click', () => {
  setBottom(true)
  selectTab('problems')
})
document.querySelector('#panel-side')!.addEventListener('click', () => setSide(!sideOpen))
document.querySelector('#panel-bottom')!.addEventListener('click', () => setBottom(!bottomOpen))
document.querySelector('#sheet-close')!.addEventListener('click', () => {
  document.querySelector<HTMLElement>('#sheet')!.hidden = true
})
document.querySelector('#palette')!.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closePalette()
})
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-activity]')) {
  button.addEventListener('click', () => {
    for (const item of document.querySelectorAll<HTMLButtonElement>('[data-activity]')) item.classList.toggle('active', item === button)
    const name = button.dataset.activity ?? 'explorer'
    for (const view of document.querySelectorAll<HTMLElement>('.side-view')) view.hidden = view.dataset.view !== name
    if (!sideOpen) setSide(true)
    if (window.innerWidth <= 900) document.querySelector('#sidepanel')!.classList.add('open')
  })
}
window.addEventListener('keydown', (event) => {
  const mod = event.metaKey || event.ctrlKey
  if (mod && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    openPalette()
    return
  }
  if (mod && event.key.toLowerCase() === 's') {
    event.preventDefault()
    saveCurrent()
    return
  }
  if (mod && event.key.toLowerCase() === 'b') {
    event.preventDefault()
    setSide(!sideOpen)
    return
  }
  if (mod && event.key.toLowerCase() === 'j') {
    event.preventDefault()
    setBottom(!bottomOpen)
    return
  }
  if (mod && event.key === '.') {
    event.preventDefault()
    toggleFocus()
    return
  }
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  if (event.key === 'ArrowLeft') stepBack()
  else stepForward()
})
for (const tab of document.querySelectorAll<HTMLButtonElement>('.panel-tab')) {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab ?? 'output'))
}
panes.ast.addEventListener('mouseover', (event) => {
  const node = (event.target as HTMLElement).closest<HTMLElement>('details.node')
  const span = node ? spanFromNode(node) : null
  editor.highlightRange(span)
})
panes.ast.addEventListener('mouseleave', () => editor.highlightRange(null))
canvas.addEventListener('pointerdown', onPreviewDown)
canvas.addEventListener('pointermove', onPreviewMove)

dragWidth(document.querySelector<HTMLElement>('#split-side')!, '--side-w', 180, 480, (value) => {
  layout.side = value
  saveLayout()
})
dragWidth(document.querySelector<HTMLElement>('#split-x')!, '--preview-w', 280, 720, (value) => {
  layout.preview = value
  saveLayout()
}, true)
dragHeight(document.querySelector<HTMLElement>('#split-y')!, (value) => {
  layout.bottom = value
  document.documentElement.style.setProperty('--bottom-h', `${value}px`)
  bottomOpen = true
  document.querySelector('#bottom')!.classList.remove('collapsed')
  saveLayout()
})

window.addEventListener('hashchange', () => {
  const shared = readHash()
  seed = shared.seed
  seedInput.value = String(seed)
  if (shared.code === null || shared.code === editor.getCode()) return
  showShared(shared.code)
})

applyThemeLabel()
applyMute()
document.querySelector('#guide-next')?.addEventListener('click', () => {
  guideStep += 1
  if (guideStep >= GUIDE.length) dismissGuide()
  else paintGuide()
})
document.querySelector('#guide-dismiss')?.addEventListener('click', dismissGuide)
document.querySelector('#focus-toggle')!.addEventListener('click', toggleFocus)
document.querySelector('#focus-exit')!.addEventListener('click', toggleFocus)
document.querySelector('#view-mode')!.addEventListener('click', () => {
  gallery = !gallery
  localStorage.setItem('spool-gallery', gallery ? '1' : '0')
  document.querySelector('#view-mode')!.textContent = gallery ? 'List' : 'Gallery'
  renderFiles()
})
document.querySelector('#view-mode')!.textContent = gallery ? 'List' : 'Gallery'
document.querySelector('.workspace')!.addEventListener('pointerdown', (event) => {
  if (!sideOpen) return
  if ((event.target as HTMLElement).closest('#sidepanel, #panel-side, #settings-open')) return
  setSide(false)
})
wireRepl()
wireMascotSettings()
window.addEventListener('pointermove', (event) => {
  pipkin.notePointer((event.clientX - window.innerWidth / 2) / 280, (event.clientY - window.innerHeight / 2) / 200)
})
window.addEventListener('spool-tweak', (event) => {
  pipkin.noteTweak(Boolean((event as CustomEvent<boolean>).detail))
})
document.addEventListener('visibilitychange', () => {
  document.documentElement.classList.toggle('mascot-paused', document.hidden)
})
const minimapBox = document.querySelector<HTMLInputElement>('#minimap')!
minimapBox.checked = localStorage.getItem('spool-minimap') === '1'
editor.setMinimap(minimapBox.checked)
minimapBox.addEventListener('change', () => {
  localStorage.setItem('spool-minimap', minimapBox.checked ? '1' : '0')
  editor.setMinimap(minimapBox.checked)
})
renderFiles()
renderWelcome()
const remembered = localStorage.getItem('spool-panel-tab')
if (remembered) selectTab(remembered)
setSide(sideOpen)
setBottom(bottomOpen)
const starting = readHash()
seed = starting.seed
seedInput.value = String(seed)
if (starting.code) showShared(starting.code)
else showWelcome()



function onEdit(code: string): void {
  if (suppressEdit) return
  pipkin.noteKey()
  writeHash(code)
  markDirty()
  const problem = syntaxProblem(code)
  editor.setError(problem)
  setProblems(problem)
  if (problem) pipkin.noteError()
  window.clearTimeout(inspectTimer)
  inspectTimer = window.setTimeout(() => refreshInspector(code), 180)
  if (!autoRun || currentId === null && welcome.hidden === false) return
  if (problem) return
  window.clearTimeout(reloadTimer)
  reloadTimer = window.setTimeout(() => {
    reloadKeeping()
    toast('Reloaded')
  }, 420)
}

function onCursor(line: number, column: number, selected = 0): void {
  cursorLine = line
  cursorColumn = column
  pipkin.lookCaret(line, column)
  document.querySelector('#stat-pos')!.textContent = `${line}:${column}`
  document.querySelector('#stat-sel')!.textContent = selected > 0 ? `${selected} selected` : 'no selection'
  markTreeCursor(panes.ast, editor.getCode(), line, column)
}

function run(): void {
  halt('Running')
  frames = []
  traceTruncated = false
  const code = editor.getCode()
  const problem = syntaxProblem(code)
  if (problem) {
    fail(problem)
    runState.textContent = 'Fix the error, then run again.'
    return
  }
  pipkin.noteCompiled()
  const turtle = new Turtle()
  const stats: ExecutionStats = { steps: 0, maxCallDepth: 0 }
  const started = performance.now()
  try {
    display = new Display()
    speaker = new Speaker()
    const commands = turtle.builtins()
    const opened = openVm(code, {
      builtins: commands,
      modules: { turtle: commands, draw: display.module(), input: liveInput.module(), audio: speaker.module(), mascot: mascotHost() },
      stats,
      seed,
      optimize: passes(),
    })
    let step = opened.generator.next()
    while (!step.done) {
      remember(frameFrom(step.value, turtle))
      step = opened.generator.next()
    }
    remember(frameFrom(opened.finalPause(), turtle))
    const ms = performance.now() - started
    strokes = turtle.strokes
    prints = turtle.prints
    editor.setError(null)
    showConsole(null)
    renderOutput(panes.output, prints)
    setStats(stats.steps, stats.maxCallDepth, ms)
    playback?.stop()
    runState.textContent = 'Drawing…'
    const end = frames.at(-1)
    if (end) {
      traceIndex = frames.length - 1
      timeline.max = String(traceIndex)
      timeline.value = String(traceIndex)
      renderScopes(panes.variables, end.scopes)
      showEntities( end.entities)
      renderStack(panes.stack, end.stack)
      setLive(null, end.entities.length)
    }
    playback = playDrawing(canvas, strokes, unitsPerSecond, turtle, () => {
      if (runState.textContent === 'Drawing…') runState.textContent = 'Done'
    })
    if (display.used) repaint()
    sounds.unlock()
    if (!muted) sounds.play(speaker.cues)
    live = opened
    lastShape = entityShape(code)
    if (opened.handlerCount() > 0) startClock(opened, turtle)
  } catch (error) {
    strokes = turtle.strokes
    fail(error)
    runState.textContent = 'The program stopped.'
  }
}

function step(): void {
  if (pumping) {
    pause()
    return
  }
  if (!session && !arm()) return
  advance()
}

function pause(): void {
  stopContinue = true
  if (session) runState.textContent = 'Paused'
}

async function continueRun(): Promise<void> {
  if (pumping) return
  if (!session && !arm()) return
  pumping = true
  stopContinue = false
  runState.textContent = 'Running'
  let batch = 0
  while (!stopContinue && session) {
    if (!advance(false)) break
    batch++
    if (batch >= 24) {
      batch = 0
      paintSession()
      await new Promise((resolve) => window.setTimeout(resolve, 16))
    }
  }
  paintSession()
  pumping = false
  if (session && stopContinue) runState.textContent = 'Paused'
}

function startClock(opened: ReturnType<typeof openVm>, turtle: Turtle): void {
  const heard = speaker
  let last = performance.now()
  let acc = 0
  const stepMs = 1000 / 60
  const loop = (now: number) => {
    if (rewinding || scrubbing) {
      if (rewinding && shotIndex > 0) showRewind(shotIndex - 1)
      last = now
      acc = 0
      clock = requestAnimationFrame(loop)
      return
    }
    if (gamePaused && !stepOnce) {
      last = now
      acc = 0
      clock = requestAnimationFrame(loop)
      return
    }
    if (shots.length > 0 && shotIndex < shots.length - 1 && !resumePlay) {
      last = now
      acc = 0
      clock = requestAnimationFrame(loop)
      return
    }
    if (resumePlay && shotIndex < shots.length - 1) {
      shots.length = shotIndex + 1
      timeline.max = String(Math.max(0, shots.length - 1))
    }
    resumePlay = false
    acc += Math.min(now - last, 100)
    last = now
    let guard = 0
    const frameStarted = performance.now()
    try {
      while (acc >= stepMs && guard < 5) {
        acc -= stepMs
        display.begin()
        heard.begin()
        const events = keyQueue.splice(0, keyQueue.length)
        inputLog.push(events)
        opened.frame(events)
        liveInput.endFrame()
        const pulled = opened.consumeRewind()
        for (const cue of heard.cues) {
          if (cue.kind !== 'play') continue
          if (cue.name === 'score') pipkin.noteScore()
          if (cue.name === 'hit' || cue.name === 'boom') pipkin.noteHit()
        }
        if (pulled) {
          sounds.silence()
          washUntil = performance.now() + 800
          ghostMarks = trail.flat()
        } else if (!muted) sounds.play(heard.cues)
        const glance = opened.glance()
        trail.push(centersOf(glance.entities))
        if (trail.length > 30) trail.shift()
        if (inputLog.length % SNAP_EVERY === 0) takeShot()
        guard++
        if (stepOnce) {
          stepOnce = false
          acc = 0
          break
        }
      }
    } catch (error) {
      if (clock) cancelAnimationFrame(clock)
      clock = 0
      fail(error)
      runState.textContent = 'The program stopped.'
      return
    }
    playback?.stop()
    if (display.used) repaint()
    else playback = playDrawing(canvas, turtle.strokes, () => Number.POSITIVE_INFINITY, turtle)
    const view = opened.glance()
    const instant = performance.now()
    fps = 1000 / Math.max(1, instant - frameStamp)
    frameStamp = instant
    const hud = document.querySelector('#hud')
    if (hud) hud.textContent = `${fps.toFixed(0)} fps · ${(instant - frameStarted).toFixed(1)} ms`
    renderScopes(panes.variables, view.scopes)
    showEntities( view.entities)
    renderStack(panes.stack, view.stack)
    prints = turtle.prints
    showConsole(null)
    runState.textContent = `Playing · frame ${inputLog.length}`
    paintTime()
    watchPlay(view)
    setLive(performance.now() - frameStarted, view.entities.length)
    clock = requestAnimationFrame(loop)
  }
  inputLog.length = 0
  shots = []
  toldFull = false
  trail.length = 0
  ghostMarks = []
  washUntil = 0
  takeShot()
  clock = requestAnimationFrame(loop)
}

function takeShot(): void {
  if (!live) return
  const input = liveInput.capture()
  shots.push({
    image: live.image(),
    inputLength: inputLog.length,
    held: input.held,
    x: input.x,
    y: input.y,
    background: display.background,
    cameraX: display.cameraX,
    cameraY: display.cameraY,
    ops: display.ops.map((op) => ({ ...op })),
    view: live.glance(),
  })
  if (shots.length > SNAP_CAP) {
    shots.shift()
    if (!toldFull) {
      toldFull = true
      toast('Rewind buffer is full. Earlier frames were dropped.')
    }
  }
  shotIndex = shots.length - 1
  timeline.max = String(Math.max(0, shots.length - 1))
  if (!scrubbing && !rewinding) timeline.value = String(shotIndex)
}

function showRewind(index: number): void {
  if (!live || shots.length === 0) return
  sounds.silence()
  playback?.stop()
  shotIndex = Math.max(0, Math.min(shots.length - 1, index))
  const shot = shots[shotIndex]
  if (!shot) return
  live.restore(shot.image)
  liveInput.adopt({ held: shot.held, x: shot.x, y: shot.y })
  inputLog.length = shot.inputLength
  display.background = shot.background
  display.cameraX = shot.cameraX
  display.cameraY = shot.cameraY
  display.ops.length = 0
  display.ops.push(...shot.ops.map((op) => ({ ...op })))
  if (shot.view.line > 0) editor.highlightLine(shot.view.line)
  else editor.highlightLine(null)
  renderScopes(panes.variables, shot.view.scopes)
  showEntities( shot.view.entities)
  renderStack(panes.stack, shot.view.stack)
  setLive(null, shot.view.entities.length)
  timeline.value = String(shotIndex)
  if (display.used) repaint()
  runState.textContent = `Rewound · frame ${shot.inputLength}`
  paintTime()
}

function keyName(event: KeyboardEvent): string {
  if (event.key === ' ') return 'space'
  if (event.key === 'ArrowLeft') return 'left'
  if (event.key === 'ArrowRight') return 'right'
  if (event.key === 'ArrowUp') return 'up'
  if (event.key === 'ArrowDown') return 'down'
  return event.key.toLowerCase()
}

window.addEventListener('keydown', (event) => {
  if (!previewFocused()) return
  if ((event.key === 'r' || event.key === 'R') && !event.altKey && !event.ctrlKey && !event.metaKey) {
    if (shots.length === 0) return
    event.preventDefault()
    if (!event.repeat) rewinding = true
    return
  }
  if (!clock || event.repeat) return
  event.preventDefault()
  const key = keyName(event)
  liveInput.press(key)
  keyQueue.push({ type: 'key', key })
})

window.addEventListener('keyup', (event) => {
  if (!previewFocused() && event.key !== 'r' && event.key !== 'R') return
  if (event.key === 'r' || event.key === 'R') {
    if (previewFocused() || rewinding) {
      rewinding = false
      resumePlay = true
      event.preventDefault()
    }
    return
  }
  if (!clock) return
  event.preventDefault()
  const key = keyName(event)
  liveInput.release(key)
  keyQueue.push({ type: 'key_up', key })
})

canvas.addEventListener('mousemove', (event) => {
  const rect = canvas.getBoundingClientRect()
  liveInput.x = event.clientX - rect.left
  liveInput.y = event.clientY - rect.top
})
canvas.addEventListener('mousedown', () => {
  liveInput.click = true
})

function halt(label: string): void {
  stopContinue = true
  sounds.silence()
  rewinding = false
  scrubbing = false
  resumePlay = false
  shots = []
  shotIndex = 0
  toldFull = false
  live = null
  if (clock) cancelAnimationFrame(clock)
  clock = 0
  keyQueue = []
  session = null
  editor.highlightLine(null)
  if (label !== 'Running' && label !== 'Editing') runState.textContent = label
  if (label === 'Stopped' || label === 'Editing') {
    frames = []
    traceTruncated = false
    timeline.value = '0'
    timeline.max = '0'
    traceNote.textContent = ''
    renderScopes(panes.variables, null)
    showEntities( null)
    renderStack(panes.stack, null)
    setLive(null, 0)
  }
}

function arm(): boolean {
  const problem = syntaxProblem(editor.getCode())
  if (problem) {
    fail(problem)
    runState.textContent = 'Fix the error, then step.'
    return false
  }
  const turtle = new Turtle()
  const stats: ExecutionStats = { steps: 0, maxCallDepth: 0 }
  frames = []
  traceTruncated = false
  display = new Display()
  speaker = new Speaker()
  const commands = turtle.builtins()
  const opened = openVm(editor.getCode(), {
    builtins: commands,
    modules: { turtle: commands, draw: display.module(), input: liveInput.module(), audio: speaker.module(), mascot: mascotHost() },
    stats,
    seed,
    optimize: passes(),
  })
  session = { iterator: opened.generator, turtle, stats, finalPause: opened.finalPause }
  prints = []
  editor.setError(null)
  showConsole(null)
  playback?.stop()
  return true
}

/** Run until the next pause. Returns false when the program has finished or failed. */
function advance(paint = true): boolean {
  if (!session) return false
  try {
    const result = session.iterator.next()
    if (result.done) {
      prints = session.turtle.prints
      const stats = session.stats
      strokes = session.turtle.strokes
      remember(frameFrom(session.finalPause(), session.turtle))
      paintTurtle(session.turtle)
      session = null
      editor.highlightLine(null)
      renderOutput(panes.output, prints)
      showConsole(null)
      setStats(stats.steps, stats.maxCallDepth, null)
      runState.textContent = 'Done'
      return false
    }
    showPause(result.value, paint)
    return true
  } catch (error) {
    if (session) paintTurtle(session.turtle)
    session = null
    fail(error)
    runState.textContent = 'The program stopped.'
    return false
  }
}

function showPause(pauseAt: DebugPause, paint: boolean): void {
  if (!session) return
  prints = session.turtle.prints
  strokes = session.turtle.strokes
  remember(frameFrom(pauseAt, session.turtle))
  editor.highlightLine(pauseAt.line)
  renderOutput(panes.output, prints)
  renderScopes(panes.variables, pauseAt.scopes)
  showEntities( pauseAt.entities)
  renderStack(panes.stack, pauseAt.stack)
  markInstruction(bytecodeView, pauseAt.chunk, pauseAt.ip)
  showConsole(null)
  setStats(pauseAt.steps, pauseAt.maxCallDepth, null)
  if (paint) paintTurtle(session.turtle)
  if (!pumping) runState.textContent = `Paused at ${pauseAt.line}:${pauseAt.column}`
}

function paintSession(): void {
  if (session) paintTurtle(session.turtle)
}

function paintTurtle(turtle: Turtle): void {
  playback?.stop()
  playback = playDrawing(canvas, turtle.strokes, () => Number.POSITIVE_INFINITY, turtle)
}

function refreshInspector(code: string): void {
  inspection = inspectSource(code, inspection)
  renderTokens(panes.tokens, inspection.tokens)
  renderTree(panes.ast, inspection.program)
  showBytecode(inspection.program)
  markTreeCursor(panes.ast, code, cursorLine, cursorColumn)
  const tokenCount = inspection.tokens?.length ?? 0
  document.querySelector('#stat-tokens')!.textContent = `${tokenCount} tokens`
  document.querySelector('#stat-nodes')!.textContent = `${countNodes(inspection.program)} nodes`
  if (inspection.banner) {
    banner.hidden = false
    banner.textContent = inspection.banner
  } else {
    banner.hidden = true
    banner.textContent = ''
  }
}

function selectTab(name: string): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.panel-tab')) {
    tab.classList.toggle('active', tab.dataset.tab === name)
  }
  for (const [key, pane] of Object.entries(panes)) {
    pane.hidden = key !== name
  }
  localStorage.setItem('spool-panel-tab', name)
}

function toggleTheme(): void {
  const dark = document.documentElement.dataset.theme !== 'light'
  document.documentElement.classList.add('theme-switching')
  window.setTimeout(() => document.documentElement.classList.remove('theme-switching'), 220)
  document.documentElement.dataset.theme = dark ? 'light' : 'dark'
  localStorage.setItem('tiny-theme', dark ? 'light' : 'dark')
  editor.setTheme(!dark)
  applyThemeLabel()
  if (frames.length > 0) showTrace(traceIndex)
  else if (session) paintTurtle(session.turtle)
  else if (strokes.length > 0) {
    playback?.stop()
    playback = playDrawing(canvas, strokes, () => Number.POSITIVE_INFINITY, { x: 0, y: 0, heading: 0 })
  }
}

function applyThemeLabel(): void {
  themeButton.replaceChildren(iconEl(document.documentElement.dataset.theme === 'light' ? 'Moon' : 'Sun'))
  themeButton.title = document.documentElement.dataset.theme === 'light' ? 'Switch to dark' : 'Switch to light'
}

function unitsPerSecond(): number {
  const stepValue = Number(speedInput.value)
  if (stepValue >= 8) return Number.POSITIVE_INFINITY
  return 80 * 2 ** (stepValue - 1)
}

function syntaxProblem(code: string): SourceError | null {
  try {
    parse(code)
    return null
  } catch (error) {
    return error instanceof SourceError ? error : null
  }
}

function fail(error: unknown): void {
  pipkin.noteError()
  const sourceError = error instanceof SourceError ? error : null
  editor.setError(sourceError)
  editor.highlightLine(null)
  showConsole(error instanceof Error ? error.message : 'Something went wrong.')
  playback?.stop()
}

function showConsole(error: string | null): void {
  const host = document.querySelector<HTMLElement>('#output-log')
  if (!host) return
  host.replaceChildren()
  const rows: { kind: 'print' | 'error'; text: string }[] = prints.map((text) => ({ kind: 'print', text }))
  if (error) rows.push({ kind: 'error', text: error })
  const shown = rows.filter((row) => logFilter === 'all' || row.kind === logFilter)
  if (shown.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'pane-note'
    empty.textContent = 'No output yet. print writes here.'
    host.append(empty)
    return
  }
  const time = new Date().toLocaleTimeString()
  for (const row of shown) {
    const line = document.createElement('div')
    line.className = `log-line ${row.kind}`
    const stamp = document.createElement('time')
    stamp.textContent = time
    const body = document.createElement('span')
    body.textContent = row.text
    line.append(stamp, body)
    host.append(line)
  }
}

function setStats(steps: number, depth: number, ms: number | null): void {
  document.querySelector('#stat-steps')!.textContent = `${steps} steps`
  document.querySelector('#stat-depth')!.textContent = `depth ${depth}`
  if (ms !== null) document.querySelector('#stat-ms')!.textContent = `${ms.toFixed(1)} ms`
}

function setLive(frameMs: number | null, entities: number | null): void {
  document.querySelector('#stat-frame')!.textContent = frameMs === null ? '—' : `frame ${frameMs.toFixed(1)} ms`
  if (entities === null) return
  document.querySelector('#stat-entities')!.textContent = entities === 1 ? '1 entity' : `${entities} entities`
}

function readHash(): { code: string | null; seed: number } {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : ''
  const match = /^s=(-?\d+)&([\s\S]*)$/.exec(raw)
  if (match) {
    try {
      return { code: decodeURIComponent(match[2]), seed: Number(match[1]) }
    } catch {
      return { code: null, seed: Number(match[1]) }
    }
  }
  const seedOnly = /^s=(-?\d+)$/.exec(raw)
  if (!raw || seedOnly) return { code: null, seed: seedOnly ? Number(seedOnly[1]) : 1 }
  try {
    return { code: decodeURIComponent(raw), seed: 1 }
  } catch {
    return { code: null, seed: 1 }
  }
}

function writeHash(code: string): void {
  const next = `#s=${seed}&${encodeURIComponent(code)}`
  if (location.hash === next) return
  history.replaceState(null, '', next)
}

function passes(): { fold: boolean; dce: boolean } {
  return { fold: foldBox.checked, dce: dceBox.checked }
}

function onPasses(): void {
  showBytecode(inspection.program)
  if (session) halt('Stopped')
}

function showBytecode(program: Inspection['program']): void {
  if (!program) {
    renderBytecode(bytecodeView, [], [], null)
    return
  }
  try {
    const raw = compile(program)
    const after = optimize(raw, passes())
    renderBytecode(bytecodeView, disassemble(raw), disassemble(after), null)
  } catch (error) {
    bytecodeView.textContent = error instanceof Error ? error.message : 'Could not compile'
  }
}

function frameFrom(pauseAt: DebugPause, turtle: Turtle): TraceFrame {
  return {
    line: pauseAt.line,
    column: pauseAt.column,
    ip: pauseAt.ip,
    chunk: pauseAt.chunk,
    scopes: pauseAt.scopes,
    entities: pauseAt.entities,
    stack: pauseAt.stack,
    steps: pauseAt.steps,
    maxCallDepth: pauseAt.maxCallDepth,
    strokeCount: turtle.strokes.length,
    x: turtle.x,
    y: turtle.y,
    heading: turtle.heading,
  }
}

function remember(frame: TraceFrame): void {
  if (frames.length >= TRACE_CAP) {
    traceTruncated = true
    traceNote.textContent = `Trace capped at ${TRACE_CAP} steps. Later steps are not on the timeline.`
    return
  }
  frames.push(frame)
  traceIndex = frames.length - 1
  timeline.max = String(Math.max(0, frames.length - 1))
  timeline.value = String(traceIndex)
  traceNote.textContent = traceTruncated ? `Trace capped at ${TRACE_CAP} steps. Later steps are not on the timeline.` : ''
}

function showTrace(index: number): void {
  if (frames.length === 0) return
  sounds.silence()
  playback?.stop()
  traceIndex = Math.max(0, Math.min(frames.length - 1, index))
  const frame = frames[traceIndex]
  timeline.value = String(traceIndex)
  if (frame.line > 0) editor.highlightLine(frame.line)
  else editor.highlightLine(null)
  renderScopes(panes.variables, frame.scopes)
  showEntities( frame.entities)
  renderStack(panes.stack, frame.stack)
  markInstruction(bytecodeView, frame.chunk, frame.ip)
  setStats(frame.steps, frame.maxCallDepth, null)
  runState.textContent = `Step ${traceIndex + 1} / ${frames.length}`
  const prefix = strokes.slice(0, frame.strokeCount)
  playback = playDrawing(canvas, prefix, () => Number.POSITIVE_INFINITY, frame)
}

function stepBack(): void {
  if (shots.length > 0) showRewind(shotIndex - 1)
  else showTrace(traceIndex - 1)
}

function stepForward(): void {
  if (shots.length > 0) {
    if (shotIndex < shots.length - 1) showRewind(shotIndex + 1)
    else resumePlay = true
    return
  }
  if (traceIndex < frames.length - 1) {
    showTrace(traceIndex + 1)
    return
  }
  if (session || frames.length === 0) step()
}

async function exportGame(): Promise<void> {
  exportButton.disabled = true
  runState.textContent = 'Building the player…'
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}player-bundle.js`)
    if (!response.ok) throw new Error('Could not build the player')
    const runtime = await response.text()
    const page = gamePage(editor.getCode(), runtime)
    const url = URL.createObjectURL(new Blob([page], { type: 'text/html' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'spool-game.html'
    link.click()
    URL.revokeObjectURL(url)
    runState.textContent = 'Exported spool-game.html'
  } catch (error) {
    fail(error)
    runState.textContent = 'Export failed.'
  } finally {
    exportButton.disabled = false
  }
}

function runBenchmarks(): void {
  if (benchWorker) benchWorker.terminate()
  benchRows = []
  renderBench()
  benchStatus.textContent = 'Running fib(27), a nested loop, and 1,000 entities. The page stays responsive.'
  benchButton.disabled = true
  benchWorker = new Worker(new URL('./playground/bench.worker.ts', import.meta.url), { type: 'module' })
  benchWorker.onmessage = (event: MessageEvent<{ type: string; row?: BenchRow; message?: string }>) => {
    const data = event.data
    if (data.type === 'row' && data.row) {
      benchRows.push(data.row)
      renderBench()
      benchStatus.textContent = `Finished ${data.row.name}.`
    } else if (data.type === 'done') {
      benchStatus.textContent = 'Done.'
      benchButton.disabled = false
    } else if (data.type === 'error') {
      benchStatus.textContent = data.message ?? 'Benchmark failed'
      benchButton.disabled = false
    }
  }
  benchWorker.onerror = () => {
    benchStatus.textContent = 'Benchmark failed.'
    benchButton.disabled = false
  }
  benchWorker.postMessage({ start: true })
}

function renderBench(): void {
  benchTable.replaceChildren()
  if (benchRows.length === 0) return
  const table = document.createElement('table')
  const head = document.createElement('tr')
  for (const label of ['Program', 'Tree-walk', 'VM', 'VM + passes', 'VM speedup', 'Optimized speedup']) {
    const cell = document.createElement('th')
    cell.textContent = label
    head.append(cell)
  }
  table.append(head)
  for (const row of benchRows) {
    const line = document.createElement('tr')
    const cells = [
      row.name,
      `${row.tree.toFixed(1)} ms`,
      `${row.vm.toFixed(1)} ms`,
      `${row.optimized.toFixed(1)} ms`,
      `${row.speedupVm.toFixed(1)}×`,
      `${row.speedupOptimized.toFixed(1)}×`,
    ]
    for (const text of cells) {
      const cell = document.createElement('td')
      cell.textContent = text
      line.append(cell)
    }
    table.append(line)
  }
  benchTable.append(table)
}

function showEntities(entities: Parameters<typeof renderEntities>[1]): void {
  renderEntities(panes.entities, entities)
  if (selectedId === null) return
  panes.entities.querySelector(`[data-entity="${selectedId}"]`)?.classList.add('selected')
}

function readLayout(): { side: number; preview: number; bottom: number; sideOpen: boolean; bottomOpen: boolean } {
  try {
    const raw = localStorage.getItem('spool-layout')
    if (raw) return { side: 320, preview: 460, bottom: 168, sideOpen: false, bottomOpen: true, ...JSON.parse(raw) }
  } catch {
    /* keep defaults */
  }
  return { side: 320, preview: 460, bottom: 168, sideOpen: false, bottomOpen: true }
}

function saveLayout(): void {
  localStorage.setItem('spool-layout', JSON.stringify({ ...layout, sideOpen, bottomOpen }))
}

function dragWidth(handle: HTMLElement, variable: string, min: number, max: number, onValue: (value: number) => void, fromRight = false): void {
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    const start = event.clientX
    const initial = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(variable)) || min
    const move = (ev: PointerEvent) => {
      const delta = ev.clientX - start
      const next = Math.min(max, Math.max(min, initial + delta * (fromRight ? -1 : 1)))
      document.documentElement.style.setProperty(variable, `${next}px`)
      onValue(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })
}

function dragHeight(handle: HTMLElement, onValue: (value: number) => void): void {
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    const start = event.clientY
    const initial = document.querySelector('#bottom')!.getBoundingClientRect().height
    const move = (ev: PointerEvent) => {
      const next = Math.min(480, Math.max(96, initial + (start - ev.clientY)))
      onValue(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })
}

function setSide(open: boolean): void {
  sideOpen = open
  const panel = document.querySelector<HTMLElement>('#sidepanel')!
  panel.hidden = false
  panel.classList.toggle('open', open)
  panel.inert = !open
  document.querySelector<HTMLElement>('#split-side')!.hidden = !open
  saveLayout()
}

function setBottom(open: boolean): void {
  bottomOpen = open
  document.querySelector('#bottom')!.classList.toggle('collapsed', !open)
  if (open) document.documentElement.style.setProperty('--bottom-h', `${layout.bottom}px`)
  saveLayout()
}

function renderFiles(): void {
  const host = document.querySelector<HTMLElement>('#tree')!
  const query = document.querySelector<HTMLInputElement>('#filter')!.value.trim().toLowerCase()
  host.replaceChildren()
  if (gallery) {
    renderGallery(host, query)
    return
  }
  const folders = ['Games', 'Graphics', 'Algorithms'] as const
  for (const folder of folders) {
    const files = library.filter((file) => file.folder === folder && file.name.includes(query))
    if (files.length === 0) continue
    host.append(folderBlock(folder, files.map((file) => ({ id: file.id, name: file.name, category: file.category }))))
  }
  const yours = userFiles.filter((file) => file.name.toLowerCase().includes(query))
  if (yours.length > 0) host.append(folderBlock('Yours', yours.map((file) => ({ id: file.id, name: file.name, category: 'game' as const }))))
}

function renderGallery(host: HTMLElement, query: string): void {
  const folders = ['Games', 'Graphics', 'Algorithms'] as const
  let any = false
  for (const folder of folders) {
    const files = library.filter((file) => file.folder === folder && (file.name.includes(query) || file.example.toLowerCase().includes(query)))
    if (files.length === 0) continue
    any = true
    const block = document.createElement('section')
    const title = document.createElement('h3')
    title.textContent = folder
    const grid = document.createElement('div')
    grid.className = 'gallery'
    for (const file of files) {
      const card = document.createElement('button')
      card.type = 'button'
      card.className = 'project-card'
      card.classList.toggle('active', file.id === currentId)
      const thumb = document.createElement('span')
      thumb.className = 'thumb'
      thumb.dataset.kind = file.category
      const name = document.createElement('span')
      name.className = 'card-title'
      name.textContent = file.example
      const blurb = document.createElement('span')
      blurb.className = 'card-blurb'
      blurb.textContent = controlsHint(originCode(file.example)) || file.name
      card.append(thumb, name, blurb)
      card.addEventListener('click', () => {
        openFile(file.id)
        if (window.innerWidth <= 900) setSide(false)
      })
      grid.append(card)
    }
    block.append(title, grid)
    host.append(block)
  }
  const yours = userFiles.filter((file) => file.name.toLowerCase().includes(query))
  if (yours.length > 0) {
    any = true
    host.append(folderBlock('Yours', yours.map((file) => ({ id: file.id, name: file.name, category: 'game' as const }))))
  }
  if (!any) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.innerHTML = pipkinMarkup('empty')
    const note = document.createElement('p')
    note.textContent = 'Nothing matches.'
    empty.append(note)
    host.append(empty)
  }
}

function folderBlock(name: string, files: { id: string; name: string; category: 'game' | 'graphics' | 'algorithm' }[]): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'folder'
  const head = document.createElement('button')
  head.type = 'button'
  head.append(iconEl(collapsed.has(name) ? 'ChevronRight' : 'ChevronDown'), document.createTextNode(name))
  head.addEventListener('click', () => {
    if (collapsed.has(name)) collapsed.delete(name)
    else collapsed.add(name)
    renderFiles()
  })
  wrap.append(head)
  if (!collapsed.has(name)) {
    for (const file of files) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'file-row'
      row.classList.toggle('active', file.id === currentId)
      const glyph = file.category === 'game' ? 'Gamepad2' : file.category === 'graphics' ? 'Shapes' : 'Binary'
      row.append(iconEl(glyph), document.createTextNode(file.name))
      row.addEventListener('click', () => openFile(file.id))
      wrap.append(row)
    }
  }
  return wrap
}

function renderSearch(): void {
  const host = document.querySelector<HTMLElement>('#search-list')!
  const query = document.querySelector<HTMLInputElement>('#search-box')!.value.trim().toLowerCase()
  host.replaceChildren()
  for (const file of library) {
    if (query && !file.name.includes(query) && !file.example.toLowerCase().includes(query)) continue
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'file-row'
    row.textContent = `${file.folder} / ${file.name}`
    row.addEventListener('click', () => openFile(file.id))
    host.append(row)
  }
}

function renderWelcome(): void {
  const host = document.querySelector<HTMLElement>('#welcome-links')!
  host.replaceChildren()
  for (const file of library.slice(0, 6)) {
    const button = document.createElement('button')
    button.type = 'button'
    button.append(iconEl(file.category === 'game' ? 'Gamepad2' : 'Shapes'), document.createTextNode(file.example))
    button.addEventListener('click', () => openFile(file.id))
    host.append(button)
  }
}

function renderTabs(): void {
  const host = document.querySelector<HTMLElement>('#file-tabs')!
  host.replaceChildren()
  const welcomeTab = document.createElement('button')
  welcomeTab.type = 'button'
  welcomeTab.className = 'file-tab'
  welcomeTab.classList.toggle('active', currentId === null && !sharing)
  welcomeTab.textContent = 'Welcome'
  welcomeTab.addEventListener('click', showWelcome)
  host.append(welcomeTab)
  if (sharing && currentId === null) {
    const sharedTab = document.createElement('button')
    sharedTab.type = 'button'
    sharedTab.className = 'file-tab active'
    sharedTab.textContent = 'Shared'
    host.append(sharedTab)
  }
  for (const id of openIds) {
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.className = 'file-tab'
    tab.classList.toggle('active', id === currentId)
    const label = document.createElement('span')
    label.textContent = fileName(id)
    tab.append(label)
    if (isFileDirty(id)) {
      const dot = document.createElement('span')
      dot.className = 'dirty'
      tab.append(dot)
    }
    const close = document.createElement('span')
    close.className = 'close'
    close.textContent = '×'
    close.addEventListener('click', (event) => {
      event.stopPropagation()
      closeFile(id)
    })
    tab.append(close)
    tab.addEventListener('click', () => openFile(id, false))
    host.append(tab)
  }
}

function fileName(id: string): string {
  return libraryFile(id)?.name ?? userFiles.find((file) => file.id === id)?.name ?? 'untitled.spool'
}

function fileCode(id: string): string {
  const known = libraryFile(id)
  if (known) return readLibraryCode(id)
  return userFiles.find((file) => file.id === id)?.code ?? ''
}

function isFileDirty(id: string): boolean {
  if (!libraryFile(id)) return true
  return isModified(id)
}

function showWelcome(): void {
  sharing = false
  currentId = null
  welcome.hidden = false
  editorHost.hidden = true
  document.querySelector('#file-name')!.textContent = 'Welcome'
  document.querySelector<HTMLElement>('#hint')!.hidden = true
  renderTabs()
  renderFiles()
  const demo = originCode('Undo')
  if (demo) {
    suppressEdit = true
    editor.setCode(demo)
    suppressEdit = false
    run()
  }
  showGuide()
}

function openFile(id: string, runIt = true): void {
  sharing = false
  if (!openIds.includes(id)) openIds.push(id)
  currentId = id
  welcome.hidden = true
  editorHost.hidden = false
  const code = fileCode(id)
  suppressEdit = true
  editor.setCode(code)
  suppressEdit = false
  document.querySelector('#file-name')!.textContent = fileName(id)
  const hint = controlsHint(code)
  const chip = document.querySelector<HTMLElement>('#hint')!
  chip.hidden = hint.length === 0
  chip.textContent = hint
  writeHash(code)
  refreshInspector(code)
  editor.setError(syntaxProblem(code))
  setProblems(syntaxProblem(code))
  renderTabs()
  renderFiles()
  if (runIt && autoRun) run()
}

function showShared(code: string): void {
  const match = library.find((file) => readLibraryCode(file.id) === code || examples.find((item) => item.name === file.example)?.code === code)
  if (match) {
    sharing = false
    openFile(match.id, false)
    return
  }
  const existing = userFiles.find((file) => file.code === code)
  if (existing) {
    sharing = false
    openFile(existing.id, false)
    return
  }
  sharing = true
  currentId = null
  welcome.hidden = true
  editorHost.hidden = false
  suppressEdit = true
  editor.setCode(code)
  suppressEdit = false
  document.querySelector('#file-name')!.textContent = 'Shared'
  refreshInspector(code)
  editor.setError(syntaxProblem(code))
  setProblems(syntaxProblem(code))
  renderTabs()
  renderFiles()
  if (autoRun) run()
}

function newFile(): void {
  sharing = false
  const id = `user-${Date.now()}`
  const file = { id, name: nextUntitledName(userFiles), code: '# New file\nprint "hello"\n' }
  userFiles.push(file)
  writeUserFiles(userFiles)
  openFile(id)
}

function duplicateFile(): void {
  if (!currentId) return
  const id = `user-${Date.now()}`
  const name = fileName(currentId).replace(/\.spool$/, '') + '-copy.spool'
  userFiles.push({ id, name, code: editor.getCode() })
  writeUserFiles(userFiles)
  openFile(id, false)
  toast('Duplicated')
}

function resetFile(): void {
  if (!currentId || !libraryFile(currentId)) return
  const code = resetLibraryCode(currentId)
  suppressEdit = true
  editor.setCode(code)
  suppressEdit = false
  renderTabs()
  if (autoRun) run()
  toast('Reset to original')
}

function closeFile(id: string): void {
  const index = openIds.indexOf(id)
  if (index >= 0) openIds.splice(index, 1)
  if (currentId === id) {
    const next = openIds[index] ?? openIds[index - 1]
    if (next) openFile(next, false)
    else showWelcome()
  } else renderTabs()
}

function saveCurrent(): void {
  if (!currentId) return
  const code = editor.getCode()
  if (libraryFile(currentId)) saveLibraryCode(currentId, code)
  else {
    const file = userFiles.find((item) => item.id === currentId)
    if (file) file.code = code
    writeUserFiles(userFiles)
  }
  renderTabs()
  toast('Saved')
}

function markDirty(): void {
  if (!currentId) return
  if (libraryFile(currentId)) saveLibraryCode(currentId, editor.getCode())
  else {
    const file = userFiles.find((item) => item.id === currentId)
    if (file) file.code = editor.getCode()
    writeUserFiles(userFiles)
  }
  renderTabs()
}

function reloadKeeping(): void {
  const code = editor.getCode()
  const shape = entityShape(code)
  const kept: EntityShot[] | null = live && shape === lastShape ? live.captureEntities() : null
  run()
  if (kept && live) live.adoptEntities(kept)
}

function toggleGamePause(): void {
  gamePaused = !gamePaused
  runState.textContent = gamePaused ? 'Paused' : runState.textContent
}

function stepGame(): void {
  if (!clock) return
  gamePaused = true
  stepOnce = true
}

function previewFocused(): boolean {
  return document.activeElement === canvas
}

function debugOn(id: string): boolean {
  return document.querySelector<HTMLInputElement>(`#${id}`)?.checked === true
}

function overlayNow(): DebugOverlay {
  return {
    grid: debugOn('dbg-grid'),
    bounds: debugOn('dbg-bounds'),
    labels: debugOn('dbg-labels'),
    velocity: debugOn('dbg-velocity'),
    selected: selectedId,
    entities: live?.glance().entities ?? [],
  }
}

function repaint(): void {
  const wash = performance.now() < washUntil ? { tint: true, ghosts: ghostMarks } : null
  paintDisplay(canvas, display, overlayNow(), wash)
  document.querySelector<HTMLElement>('#skeleton')!.hidden = true
}

function paintTime(): void {
  if (shots.length === 0) {
    timeReadout.textContent = `step ${traceIndex}`
    return
  }
  const liveHead = shotIndex >= shots.length - 1 && !scrubbing && !rewinding
  const frame = liveHead ? inputLog.length : (shots[shotIndex]?.inputLength ?? 0)
  const total = frame / 60
  const mins = Math.floor(total / 60)
  const secs = total - mins * 60
  timeReadout.textContent = `${mins}:${secs.toFixed(2).padStart(5, '0')} · ${frame}`
  paintTicks()
}

function paintTicks(): void {
  const host = document.querySelector<HTMLElement>('#ticks')
  if (!host) return
  host.replaceChildren()
  const total = Math.max(1, inputLog.length)
  const step = Math.max(1, Math.ceil(inputLog.length / 48))
  for (let i = 0; i < inputLog.length; i += step) {
    if ((inputLog[i] ?? []).length === 0) continue
    const mark = document.createElement('i')
    mark.style.left = `${(i / total) * 100}%`
    host.append(mark)
  }
}

let playedMood = ''

function watchPlay(view: DebugPause): void {
  const mode = view.scopes.flatMap((scope) => scope.bindings).find((item) => item.name === 'mode')?.value ?? ''
  const next = mode.includes('over') ? 'over' : mode.includes('win') ? 'win' : ''
  if (next !== playedMood) {
    if (next === 'over') pipkin.noteOver()
    if (next === 'win') pipkin.noteWin()
    playedMood = next
  }
  const entity = view.entities.find((item) => item.id === selectedId)
    ?? view.entities.find((item) => /ball|player/i.test(item.name))
  if (!entity) return
  const pos = entity.fields.find((field) => field.name === 'pos')?.value
  const vec = pos ? /^vec\(([^,]+),\s*([^)]+)\)/.exec(pos) : null
  const x = vec ? pointOf(vec[1] ?? '') : pointOf(entity.fields.find((field) => field.name === 'x')?.value ?? '')
  const y = vec ? pointOf(vec[2] ?? '') : pointOf(entity.fields.find((field) => field.name === 'y')?.value ?? '')
  if (x !== null && y !== null) pipkin.lookEntity(x, y)
}

function toggleFocus(): void {
  focusOn = !focusOn
  document.querySelector('.ide')!.classList.toggle('focus', focusOn)
}

function mascotHost(): Record<string, (args: Value[]) => Value> {
  return {
    react: (args) => {
      if (typeof args[0] === 'string') pipkin.react(args[0])
      return null
    },
  }
}

function wireMascotSettings(): void {
  const mascotBox = document.querySelector<HTMLInputElement>('#mascot-on')!
  const bubbleBox = document.querySelector<HTMLInputElement>('#bubbles-on')!
  const sizeBox = document.querySelector<HTMLSelectElement>('#mascot-size')!
  mascotBox.checked = localStorage.getItem('spool-mascot') !== '0'
  bubbleBox.checked = localStorage.getItem('spool-bubbles') !== '0'
  sizeBox.value = localStorage.getItem('spool-mascot-size') === 'medium' ? 'medium' : 'small'
  pipkin.setEnabled(mascotBox.checked)
  pipkin.setBubbles(bubbleBox.checked)
  pipkin.setSize(sizeBox.value === 'medium' ? 'medium' : 'small')
  pipkin.setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  mascotBox.addEventListener('change', () => {
    localStorage.setItem('spool-mascot', mascotBox.checked ? '1' : '0')
    pipkin.setEnabled(mascotBox.checked)
  })
  bubbleBox.addEventListener('change', () => {
    localStorage.setItem('spool-bubbles', bubbleBox.checked ? '1' : '0')
    pipkin.setBubbles(bubbleBox.checked)
  })
  sizeBox.addEventListener('change', () => {
    localStorage.setItem('spool-mascot-size', sizeBox.value)
    pipkin.setSize(sizeBox.value === 'medium' ? 'medium' : 'small')
  })
}

const replHistory: string[] = []
let replCursor = 0

function wireRepl(): void {
  const form = document.querySelector<HTMLFormElement>('#repl')!
  const input = document.querySelector<HTMLInputElement>('#repl-input')!
  const suggest = document.querySelector<HTMLElement>('#repl-suggest')!
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    submitRepl(input.value)
    input.value = ''
    suggest.hidden = true
    replCursor = replHistory.length
  })
  input.addEventListener('input', () => showReplSuggest(input, suggest))
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      if (event.key === 'ArrowUp') replCursor = Math.max(0, replCursor - 1)
      else replCursor = Math.min(replHistory.length, replCursor + 1)
      input.value = replHistory[replCursor] ?? ''
    }
  })
}

function showReplSuggest(input: HTMLInputElement, suggest: HTMLElement): void {
  const match = /[A-Za-z_][\w]*$/.exec(input.value)
  const prefix = match?.[0] ?? ''
  const words = prefix ? spoolWords(prefix) : []
  suggest.replaceChildren()
  suggest.hidden = words.length === 0
  for (const word of words) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = word
    button.addEventListener('click', () => {
      input.value = input.value.slice(0, input.value.length - prefix.length) + word
      input.focus()
      suggest.hidden = true
    })
    suggest.append(button)
  }
}

function submitRepl(raw: string): void {
  const text = raw.trim()
  if (!text) return
  replHistory.push(text)
  if (replHistory.length > 80) replHistory.shift()
  const log = document.querySelector<HTMLElement>('#repl-log')!
  const inputLine = document.createElement('div')
  inputLine.className = 'in'
  inputLine.textContent = `› ${text}`
  log.append(inputLine)
  const out = document.createElement('div')
  if (!live) {
    out.className = 'err'
    out.textContent = 'Run a program first.'
  } else {
    try {
      const value = live.eval(text)
      out.className = 'out'
      out.textContent = value === null ? 'ok' : formatValue(value)
    } catch (error) {
      out.className = 'err'
      out.textContent = error instanceof Error ? error.message : 'Could not run that.'
    }
  }
  log.append(out)
  log.scrollTop = log.scrollHeight
}

function showGuide(): void {
  const box = document.querySelector<HTMLElement>('#guide')
  if (!box) return
  if (localStorage.getItem('spool-guide') === '1') {
    box.hidden = true
    return
  }
  guideStep = 0
  paintGuide()
}

function paintGuide(): void {
  const box = document.querySelector<HTMLElement>('#guide')
  const text = document.querySelector('#guide-text')
  if (!box || !text) return
  text.textContent = GUIDE[guideStep] ?? ''
  box.hidden = false
}

function dismissGuide(): void {
  localStorage.setItem('spool-guide', '1')
  const box = document.querySelector<HTMLElement>('#guide')
  if (box) box.hidden = true
}

function pointOf(text: string): number | null {
  const matched = /^-?\d+(?:\.\d+)?/.exec(text.trim())
  return matched ? Number(matched[0]) : null
}

function centersOf(entities: { fields: { name: string; value: string }[] }[]): { x: number; y: number }[] {
  const found: { x: number; y: number }[] = []
  for (const entity of entities) {
    const pos = entity.fields.find((field) => field.name === 'pos')?.value
    const vec = pos ? /^vec\(([^,]+),\s*([^)]+)\)/.exec(pos) : null
    const x = vec ? pointOf(vec[1] ?? '') : pointOf(entity.fields.find((field) => field.name === 'x')?.value ?? '')
    const y = vec ? pointOf(vec[2] ?? '') : pointOf(entity.fields.find((field) => field.name === 'y')?.value ?? '')
    if (x !== null && y !== null) found.push({ x, y })
  }
  return found
}

function setProblems(error: SourceError | null): void {
  problems = error ? [{ code: error.code, message: error.detail, line: error.line, column: error.column }] : []
  renderProblems()
}

function renderProblems(): void {
  const host = document.querySelector<HTMLElement>('#problems')!
  const count = document.querySelector('#problems-count')!
  const stat = document.querySelector('#stat-problems')!
  count.textContent = String(problems.length)
  stat.textContent = problems.length === 1 ? '1 problem' : `${problems.length} problems`
  host.replaceChildren()
  if (problems.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'pane-note'
    empty.textContent = 'No problems.'
    host.append(empty)
    return
  }
  for (const problem of problems) {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'problem'
    const code = document.createElement('span')
    code.className = 'code'
    code.textContent = problem.code
    const message = document.createElement('span')
    message.textContent = problem.message
    const at = document.createElement('span')
    at.textContent = `${fileName(currentId ?? '')}:${problem.line}:${problem.column}`
    row.append(code, message, at)
    row.addEventListener('click', () => {
      welcome.hidden = true
      editorHost.hidden = false
      editor.jumpTo(problem.line, problem.column)
    })
    host.append(row)
  }
}

function toast(text: string): void {
  const el = document.querySelector<HTMLElement>('#toast')!
  el.textContent = text
  el.hidden = false
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    el.hidden = true
  }, 1600)
}

function toggleMute(): void {
  muted = !muted
  localStorage.setItem('spool-muted', muted ? '1' : '0')
  applyMute()
  if (muted) sounds.silence()
}

function applyMute(): void {
  const button = document.querySelector<HTMLButtonElement>('#mute')!
  button.replaceChildren(iconEl(muted ? 'VolumeX' : 'Volume2'))
  button.title = muted ? 'Sound is off' : 'Sound is on'
  button.setAttribute('aria-pressed', muted ? 'true' : 'false')
}

function onPreviewDown(event: PointerEvent): void {
  canvas.focus()
  const hit = entityAt(event)
  selectedId = hit
  showEntities(live?.glance().entities ?? null)
  dragging = hit !== null && (gamePaused || !clock)
  if (display.used) repaint()
}

function onPreviewMove(event: PointerEvent): void {
  if (!dragging || selectedId === null || !live) return
  if (!(gamePaused || !clock)) return
  const point = worldPoint(event)
  live.placeEntity(selectedId, point.x, point.y)
  live.frame([])
  repaint()
  showEntities(live.glance().entities)
}

function worldPoint(event: PointerEvent): { x: number; y: number } {
  return fieldPoint(canvas, event.clientX, event.clientY, display.cameraX, display.cameraY)
}

function entityAt(event: PointerEvent): number | null {
  if (!live) return null
  const point = worldPoint(event)
  let found: number | null = null
  for (const entity of live.glance().entities) {
    const x = numField(entity, 'x')
    const y = numField(entity, 'y')
    if (x === null || y === null) continue
    const r = numField(entity, 'r') ?? 12
    const w = numField(entity, 'w')
    const h = numField(entity, 'h')
    const inside = w !== null && h !== null
      ? Math.abs(point.x - x) <= w / 2 && Math.abs(point.y - y) <= h / 2
      : (point.x - x) ** 2 + (point.y - y) ** 2 <= r * r
    if (inside) found = entity.id
  }
  return found
}

function numField(entity: { fields: { name: string; value: string }[] }, name: string): number | null {
  const field = entity.fields.find((item) => item.name === name)
  if (!field) return null
  const matched = /^-?\d+(?:\.\d+)?/.exec(field.value)
  return matched ? Number(matched[0]) : null
}

function openPalette(): void {
  const root = document.querySelector<HTMLElement>('#palette')!
  const input = document.querySelector<HTMLInputElement>('#palette-input')!
  root.hidden = false
  input.value = ''
  renderPalette('')
  input.focus()
  input.oninput = () => renderPalette(input.value)
  input.onkeydown = (event) => {
    if (event.key === 'Escape') closePalette()
    if (event.key === 'Enter') {
      const first = document.querySelector<HTMLButtonElement>('#palette-list button')
      first?.click()
    }
  }
}

function closePalette(): void {
  document.querySelector<HTMLElement>('#palette')!.hidden = true
}

function renderPalette(query: string): void {
  const host = document.querySelector<HTMLElement>('#palette-list')!
  host.replaceChildren()
  const items = paletteCommands().filter((command) => fuzzy(query, command.name))
  for (const command of items) {
    const button = document.createElement('button')
    button.type = 'button'
    const label = document.createElement('span')
    label.textContent = command.name
    const key = document.createElement('kbd')
    key.textContent = command.shortcut
    button.append(label, key)
    button.addEventListener('click', () => {
      closePalette()
      command.run()
    })
    host.append(button)
  }
}

function paletteCommands(): { name: string; shortcut: string; run: () => void }[] {
  const commands = [
    { name: 'Run', shortcut: '⌘ Enter', run: () => run() },
    { name: 'Restart', shortcut: '', run: () => run() },
    { name: 'Pause', shortcut: '', run: () => (clock ? toggleGamePause() : pause()) },
    { name: 'Toggle theme', shortcut: '', run: toggleTheme },
    { name: 'Toggle side panel', shortcut: '⌘ B', run: () => setSide(!sideOpen) },
    { name: 'Toggle bottom panel', shortcut: '⌘ J', run: () => setBottom(!bottomOpen) },
    { name: 'Focus mode', shortcut: '⌘ .', run: toggleFocus },
    { name: 'Keyboard shortcuts', shortcut: '', run: () => { document.querySelector<HTMLElement>('#sheet')!.hidden = false } },
    { name: 'Toggle entity bounds', shortcut: '', run: () => flipDebug('dbg-bounds') },
    { name: 'Toggle entity labels', shortcut: '', run: () => flipDebug('dbg-labels') },
    { name: 'Toggle velocity', shortcut: '', run: () => flipDebug('dbg-velocity') },
    { name: 'Toggle grid', shortcut: '', run: () => flipDebug('dbg-grid') },
    { name: 'Save', shortcut: '⌘ S', run: saveCurrent },
    { name: 'Reset file', shortcut: '', run: resetFile },
    { name: 'Export game', shortcut: '', run: () => void exportGame() },
  ]
  for (const file of library) {
    commands.push({ name: `Open ${file.example}`, shortcut: '', run: () => openFile(file.id) })
  }
  return commands
}

function flipDebug(id: string): void {
  const box = document.querySelector<HTMLInputElement>(`#${id}`)
  if (!box) return
  box.checked = !box.checked
  repaint()
}

function fuzzy(query: string, text: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  let index = 0
  for (const ch of text.toLowerCase()) {
    if (ch === needle[index]) index++
  }
  return index === needle.length
}
