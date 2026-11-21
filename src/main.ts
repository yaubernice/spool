import './style.css'
import { disassemble } from './bytecode.ts'
import type { KeyEvent } from './clock.ts'
import { compile } from './compile.ts'
import { SourceError } from './errors.ts'
import type { DebugPause, ExecutionStats, ScopeSnapshot, StackFrame, Value } from './interpreter.ts'
import { optimize } from './optimize.ts'
import { parse } from './parser.ts'
import type { BenchRow } from './playground/bench.worker.ts'
import { playDrawing, type Playback } from './playground/canvas.ts'
import { createEditor } from './playground/editor.ts'
import { examples } from './playground/examples.ts'
import {
  countNodes,
  inspectSource,
  markInstruction,
  markTreeCursor,
  renderBytecode,
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

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app')

const savedTheme = localStorage.getItem('tiny-theme')
document.documentElement.dataset.theme = savedTheme === 'light' ? 'light' : 'dark'

app.innerHTML = `
  <div class="studio">
    <header>
      <div>
        <p class="eyebrow">Spool</p>
        <h1>Watch the program run.</h1>
      </div>
      <button id="theme" type="button">Light</button>
    </header>
    <div class="toolbar">
      <button id="run" type="button">Run</button>
      <button id="step" type="button">Step</button>
      <button id="pause" type="button">Pause</button>
      <button id="continue" type="button">Continue</button>
      <button id="stop" type="button">Stop</button>
      <label class="speed">
        Speed
        <input id="speed" type="range" min="1" max="8" value="6" />
      </label>
      <label class="speed seed">
        Seed
        <input id="seed" type="number" step="1" value="1" />
      </label>
      <span id="run-state" class="run-state"></span>
    </div>
    <div class="workspace">
      <section class="editor-pane" id="editor-pane">
        <div id="editor" class="editor"></div>
        <div id="examples" class="examples" role="group" aria-label="Examples"></div>
      </section>
      <div class="splitter" id="split-x" role="separator" aria-orientation="vertical"></div>
      <section class="side">
        <section class="stage">
          <canvas id="canvas" tabindex="0" aria-label="Turtle drawing"></canvas>
          <div class="timeline">
            <button id="back" type="button" title="Step back (Alt+Left)">Back</button>
            <input id="timeline" type="range" min="0" max="0" value="0" aria-label="Trace timeline" />
            <button id="forward" type="button" title="Step forward (Alt+Right)">Forward</button>
            <span id="trace-note" class="trace-note"></span>
          </div>
        </section>
        <div class="splitter splitter-y" id="split-y" role="separator" aria-orientation="horizontal"></div>
        <section class="inspector" id="inspector">
          <div class="tabs" role="tablist">
            <button type="button" class="tab active" data-tab="output">Output</button>
            <button type="button" class="tab" data-tab="tokens">Tokens</button>
            <button type="button" class="tab" data-tab="ast">AST</button>
            <button type="button" class="tab" data-tab="variables">Variables</button>
            <button type="button" class="tab" data-tab="stack">Call stack</button>
            <button type="button" class="tab" data-tab="bytecode">Bytecode</button>
            <button type="button" class="tab" data-tab="bench">Bench</button>
          </div>
          <pre id="banner" class="banner" hidden></pre>
          <div class="tab-pane" data-pane="output"></div>
          <div class="tab-pane" data-pane="tokens" hidden></div>
          <div class="tab-pane" data-pane="ast" hidden></div>
          <div class="tab-pane" data-pane="variables" hidden></div>
          <div class="tab-pane" data-pane="stack" hidden></div>
          <div class="tab-pane" data-pane="bytecode" hidden>
            <div class="passes">
              <label><input id="pass-fold" type="checkbox" checked /> Constant folding</label>
              <label><input id="pass-dce" type="checkbox" checked /> Dead-code elimination</label>
            </div>
            <div id="bytecode-view"></div>
          </div>
          <div class="tab-pane bench" data-pane="bench" hidden>
            <button id="bench-run" type="button">Run benchmarks</button>
            <p id="bench-status" class="pane-note">Tree-walk, VM, and VM with both passes. Sorting 5000 numbers takes several minutes. The page stays responsive.</p>
            <div id="bench-table"></div>
          </div>
        </section>
      </section>
    </div>
    <pre id="console" class="console" role="log"></pre>
    <footer class="statusbar">
      <span id="stat-pos">1:1</span>
      <span id="stat-tokens">0 tokens</span>
      <span id="stat-nodes">0 nodes</span>
      <span id="stat-ms">— ms</span>
      <span id="stat-steps">0 steps</span>
      <span id="stat-depth">depth 0</span>
    </footer>
  </div>
`

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
const foldBox = document.querySelector<HTMLInputElement>('#pass-fold')!
const dceBox = document.querySelector<HTMLInputElement>('#pass-dce')!
const bytecodeView = document.querySelector<HTMLElement>('#bytecode-view')!
const benchButton = document.querySelector<HTMLButtonElement>('#bench-run')!
const benchStatus = document.querySelector<HTMLElement>('#bench-status')!
const benchTable = document.querySelector<HTMLElement>('#bench-table')!
const runState = document.querySelector<HTMLSpanElement>('#run-state')!
const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!
const exampleRow = document.querySelector<HTMLDivElement>('#examples')!
const editorHost = document.querySelector<HTMLDivElement>('#editor')!
const editorPane = document.querySelector<HTMLElement>('#editor-pane')!
const inspector = document.querySelector<HTMLElement>('#inspector')!
const banner = document.querySelector<HTMLPreElement>('#banner')!
const consoleBox = document.querySelector<HTMLPreElement>('#console')!
const panes = {
  output: document.querySelector<HTMLElement>('[data-pane="output"]')!,
  tokens: document.querySelector<HTMLElement>('[data-pane="tokens"]')!,
  ast: document.querySelector<HTMLElement>('[data-pane="ast"]')!,
  variables: document.querySelector<HTMLElement>('[data-pane="variables"]')!,
  stack: document.querySelector<HTMLElement>('[data-pane="stack"]')!,
  bytecode: document.querySelector<HTMLElement>('[data-pane="bytecode"]')!,
  bench: document.querySelector<HTMLElement>('[data-pane="bench"]')!,
}

const exampleButtons = new Map<string, HTMLButtonElement>()
for (const example of examples) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = example.name
  button.addEventListener('click', () => {
    editor.setCode(example.code)
    editor.focus()
    run()
  })
  exampleButtons.set(example.name, button)
  exampleRow.append(button)
}

const editor = createEditor(editorHost, '', onEdit, run, onCursor)

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

interface TraceFrame {
  line: number
  column: number
  ip: number
  chunk: string
  scopes: ScopeSnapshot[]
  stack: StackFrame[]
  steps: number
  maxCallDepth: number
  strokeCount: number
  x: number
  y: number
  heading: number
}

runButton.addEventListener('click', run)
stepButton.addEventListener('click', step)
pauseButton.addEventListener('click', pause)
continueButton.addEventListener('click', () => void continueRun())
stopButton.addEventListener('click', () => halt('Stopped'))
backButton.addEventListener('click', stepBack)
forwardButton.addEventListener('click', stepForward)
timeline.addEventListener('input', () => showTrace(Number(timeline.value)))
seedInput.addEventListener('change', () => {
  const next = Number(seedInput.value)
  seed = Number.isFinite(next) ? Math.trunc(next) : 1
  seedInput.value = String(seed)
  writeHash(editor.getCode())
})
foldBox.addEventListener('change', onPasses)
dceBox.addEventListener('change', onPasses)
benchButton.addEventListener('click', runBenchmarks)
themeButton.addEventListener('click', toggleTheme)
window.addEventListener('keydown', (event) => {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  if (event.key === 'ArrowLeft') stepBack()
  else stepForward()
})
for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab ?? 'output'))
}
panes.ast.addEventListener('mouseover', (event) => {
  const node = (event.target as HTMLElement).closest<HTMLElement>('details.node')
  const span = node ? spanFromNode(node) : null
  editor.highlightRange(span)
})
panes.ast.addEventListener('mouseleave', () => editor.highlightRange(null))

dragSize(document.querySelector<HTMLElement>('#split-x')!, editorPane, 'width', 1)
dragSize(document.querySelector<HTMLElement>('#split-y')!, inspector, 'height', -1)

window.addEventListener('hashchange', () => {
  const shared = readHash()
  seed = shared.seed
  seedInput.value = String(seed)
  if (shared.code === null || shared.code === editor.getCode()) return
  editor.setCode(shared.code)
  run()
})

applyThemeLabel()
const starting = readHash()
seed = starting.seed
seedInput.value = String(seed)
const startingCode = starting.code ?? examples[0].code
editor.setCode(startingCode)
refreshInspector(startingCode)
run()

function onEdit(code: string): void {
  writeHash(code)
  markExamples(code)
  halt('Editing')
  const problem = syntaxProblem(code)
  editor.setError(problem)
  window.clearTimeout(inspectTimer)
  inspectTimer = window.setTimeout(() => refreshInspector(code), 180)
}

function onCursor(line: number, column: number): void {
  cursorLine = line
  cursorColumn = column
  document.querySelector('#stat-pos')!.textContent = `${line}:${column}`
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
  const turtle = new Turtle()
  const stats: ExecutionStats = { steps: 0, maxCallDepth: 0 }
  const started = performance.now()
  try {
    const commands = turtle.builtins()
    const opened = openVm(code, {
      builtins: commands,
      modules: { turtle: commands },
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
      renderStack(panes.stack, end.stack)
    }
    playback = playDrawing(canvas, strokes, unitsPerSecond, turtle, () => {
      if (runState.textContent === 'Drawing…') runState.textContent = 'Done'
    })
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
  let last = performance.now()
  let acc = 0
  const stepMs = 1000 / 60
  const loop = (now: number) => {
    acc += Math.min(now - last, 100)
    last = now
    let guard = 0
    try {
      while (acc >= stepMs && guard < 5) {
        acc -= stepMs
        const events = keyQueue.splice(0, keyQueue.length)
        inputLog.push(events)
        opened.frame(events)
        guard++
      }
    } catch (error) {
      if (clock) cancelAnimationFrame(clock)
      clock = 0
      fail(error)
      runState.textContent = 'The program stopped.'
      return
    }
    playback?.stop()
    playback = playDrawing(canvas, turtle.strokes, () => Number.POSITIVE_INFINITY, turtle)
    const view = opened.glance()
    renderScopes(panes.variables, view.scopes)
    renderStack(panes.stack, view.stack)
    prints = turtle.prints
    showConsole(null)
    runState.textContent = `Playing · frame ${inputLog.length}`
    clock = requestAnimationFrame(loop)
  }
  inputLog.length = 0
  clock = requestAnimationFrame(loop)
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
  if (!clock || event.repeat) return
  const target = event.target
  if (target instanceof HTMLElement && target.closest('.cm-editor, input, textarea')) return
  event.preventDefault()
  keyQueue.push({ type: 'key', key: keyName(event) })
})

window.addEventListener('keyup', (event) => {
  if (!clock) return
  const target = event.target
  if (target instanceof HTMLElement && target.closest('.cm-editor, input, textarea')) return
  event.preventDefault()
  keyQueue.push({ type: 'key_up', key: keyName(event) })
})

function halt(label: string): void {
  stopContinue = true
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
    renderStack(panes.stack, null)
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
  const commands = turtle.builtins()
  const opened = openVm(editor.getCode(), {
    builtins: commands,
    modules: { turtle: commands },
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
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) {
    tab.classList.toggle('active', tab.dataset.tab === name)
  }
  for (const [key, pane] of Object.entries(panes)) {
    pane.hidden = key !== name
  }
}

function toggleTheme(): void {
  const dark = document.documentElement.dataset.theme !== 'light'
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
  themeButton.textContent = document.documentElement.dataset.theme === 'light' ? 'Dark' : 'Light'
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
  const sourceError = error instanceof SourceError ? error : null
  editor.setError(sourceError)
  editor.highlightLine(null)
  showConsole(error instanceof Error ? error.message : 'Something went wrong.')
  playback?.stop()
}

function showConsole(error: string | null): void {
  const parts = [...prints]
  if (error) parts.push(error)
  consoleBox.textContent = parts.join('\n')
  consoleBox.classList.toggle('has-error', error !== null)
}

function setStats(steps: number, depth: number, ms: number | null): void {
  document.querySelector('#stat-steps')!.textContent = `${steps} steps`
  document.querySelector('#stat-depth')!.textContent = `depth ${depth}`
  if (ms !== null) document.querySelector('#stat-ms')!.textContent = `${ms.toFixed(1)} ms`
}

function markExamples(code: string): void {
  for (const example of examples) {
    exampleButtons.get(example.name)?.classList.toggle('active', example.code === code)
  }
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
  if (!raw) return { code: null, seed: 1 }
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
  playback?.stop()
  traceIndex = Math.max(0, Math.min(frames.length - 1, index))
  const frame = frames[traceIndex]
  timeline.value = String(traceIndex)
  if (frame.line > 0) editor.highlightLine(frame.line)
  else editor.highlightLine(null)
  renderScopes(panes.variables, frame.scopes)
  renderStack(panes.stack, frame.stack)
  markInstruction(bytecodeView, frame.chunk, frame.ip)
  setStats(frame.steps, frame.maxCallDepth, null)
  runState.textContent = `Step ${traceIndex + 1} / ${frames.length}`
  const prefix = strokes.slice(0, frame.strokeCount)
  playback = playDrawing(canvas, prefix, () => Number.POSITIVE_INFINITY, frame)
}

function stepBack(): void {
  showTrace(traceIndex - 1)
}

function stepForward(): void {
  if (traceIndex < frames.length - 1) {
    showTrace(traceIndex + 1)
    return
  }
  if (session || frames.length === 0) step()
}

function runBenchmarks(): void {
  if (benchWorker) benchWorker.terminate()
  benchRows = []
  renderBench()
  benchStatus.textContent = 'Running… the page stays responsive. Sorting 5000 numbers takes several minutes.'
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

function dragSize(handle: HTMLElement, target: HTMLElement, axis: 'width' | 'height', sign: 1 | -1): void {
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    const start = axis === 'width' ? event.clientX : event.clientY
    const initial = axis === 'width' ? target.getBoundingClientRect().width : target.getBoundingClientRect().height
    const move = (ev: PointerEvent) => {
      const delta = (axis === 'width' ? ev.clientX : ev.clientY) - start
      const next = Math.max(160, initial + delta * sign)
      target.style[axis] = `${next}px`
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  })
}
