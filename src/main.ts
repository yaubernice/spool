import './style.css'
import { SourceError } from './errors.ts'
import { parse } from './parser.ts'
import { playDrawing, type Playback } from './playground/canvas.ts'
import { createEditor } from './playground/editor.ts'
import { examples } from './playground/examples.ts'
import { trace } from './turtle.ts'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app')

app.innerHTML = `
  <div class="studio">
    <header>
      <div>
        <p class="eyebrow">A tiny language</p>
        <h1>Watch the turtle draw your program.</h1>
      </div>
    </header>
    <div class="layout">
      <section class="code-pane">
        <div class="toolbar">
          <button id="run" type="button">Run</button>
          <label class="speed">
            Speed
            <input id="speed" type="range" min="1" max="8" value="6" />
          </label>
          <span id="status" class="status"></span>
        </div>
        <div id="editor" class="editor"></div>
        <div id="examples" class="examples" role="group" aria-label="Examples"></div>
        <pre id="error" class="error" hidden></pre>
        <pre id="output" class="output" hidden></pre>
      </section>
      <section class="stage">
        <canvas id="canvas" aria-label="Turtle drawing"></canvas>
      </section>
    </div>
  </div>
`

const runButton = document.querySelector<HTMLButtonElement>('#run')!
const speedInput = document.querySelector<HTMLInputElement>('#speed')!
const status = document.querySelector<HTMLSpanElement>('#status')!
const errorBox = document.querySelector<HTMLPreElement>('#error')!
const outputBox = document.querySelector<HTMLPreElement>('#output')!
const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!
const exampleRow = document.querySelector<HTMLDivElement>('#examples')!
const editorHost = document.querySelector<HTMLDivElement>('#editor')!

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

const startingCode = codeFromHash() ?? examples[0].code
const editor = createEditor(editorHost, startingCode, onEdit, run)

let playback: Playback | null = null

runButton.addEventListener('click', run)
window.addEventListener('hashchange', () => {
  const shared = codeFromHash()
  if (shared === null || shared === editor.getCode()) return
  editor.setCode(shared)
  run()
})

markExamples(editor.getCode())
writeHash(editor.getCode())
run()

function onEdit(code: string): void {
  writeHash(code)
  markExamples(code)
  const problem = syntaxProblem(code)
  if (problem) showError(problem)
  else hideError()
}

function run(): void {
  const code = editor.getCode()
  const problem = syntaxProblem(code)
  if (problem) {
    showError(problem)
    stopDrawing()
    status.textContent = 'Fix the error, then run again.'
    return
  }

  try {
    const result = trace(code)
    hideError()
    showPrints(result.prints)
    playback?.stop()
    status.textContent = 'Drawing…'
    playback = playDrawing(canvas, result.strokes, unitsPerSecond, result, () => {
      if (status.textContent === 'Drawing…') status.textContent = 'Done'
    })
  } catch (error) {
    showError(error)
    stopDrawing()
    status.textContent = 'The program stopped.'
  }
}

function unitsPerSecond(): number {
  const step = Number(speedInput.value)
  if (step >= 8) return Number.POSITIVE_INFINITY
  return 80 * 2 ** (step - 1)
}

function syntaxProblem(code: string): SourceError | null {
  try {
    parse(code)
    return null
  } catch (error) {
    return error instanceof SourceError ? error : null
  }
}

function showError(error: unknown): void {
  const sourceError = error instanceof SourceError ? error : null
  editor.setError(sourceError)
  errorBox.hidden = false
  errorBox.textContent = error instanceof Error ? error.message : 'Something went wrong.'
  outputBox.hidden = true
}

function hideError(): void {
  editor.setError(null)
  errorBox.hidden = true
  errorBox.textContent = ''
}

function showPrints(lines: string[]): void {
  outputBox.hidden = lines.length === 0
  outputBox.textContent = lines.join('\n')
}

function stopDrawing(): void {
  playback?.stop()
  playback = null
}

function markExamples(code: string): void {
  for (const example of examples) {
    exampleButtons.get(example.name)?.classList.toggle('active', example.code === code)
  }
}

function codeFromHash(): string | null {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : ''
  if (!raw) return null
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

function writeHash(code: string): void {
  const next = `#${encodeURIComponent(code)}`
  if (location.hash === next) return
  history.replaceState(null, '', next)
}
