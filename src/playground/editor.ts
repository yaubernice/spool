import { forceLinting, lintGutter, linter, type Diagnostic } from '@codemirror/lint'
import { highlightSelectionMatches } from '@codemirror/search'
import { Compartment, EditorState, StateEffect, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, keymap, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import type { SourceError } from '../errors.ts'
import { isQuantity } from '../data.ts'
import { tokenize } from '../lexer.ts'
import { spoolAssist } from './complete.ts'
import { spoolHighlight } from './highlight.ts'

export interface SourceSpan {
  line: number
  column: number
  endLine: number
  endColumn: number
}

export interface PlaygroundEditor {
  getCode: () => string
  setCode: (code: string) => void
  /** Underline one error. Pass null to clear the marks. */
  setError: (error: SourceError | null) => void
  focus: () => void
  setTheme: (dark: boolean) => void
  /** Yellow wash over a source range. Pass null to clear it. */
  highlightRange: (span: SourceSpan | null) => void
  /** Blue bar on the statement the debugger is about to run. */
  highlightLine: (line: number | null) => void
  /** Move the cursor to a 1-based line and column. */
  jumpTo: (line: number, column: number) => void
  /** The minimap is off until a setting turns it on. */
  setMinimap: (on: boolean) => void
}

interface Marks {
  range: SourceSpan | null
  line: number | null
}

const setMarks = StateEffect.define<Marks>()

const markField = StateField.define<Marks>({
  create: () => ({ range: null, line: null }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setMarks)) return effect.value
    }
    return value
  },
  provide: (field) =>
    EditorView.decorations.compute([field], (state) => marksFor(state.doc.toString(), state.field(field))),
})

/**
 * A CodeMirror editor for Spool.
 * Cmd/Ctrl+Enter runs the program. Alt-click or Cmd-click a number to tweak it.
 */
export function createEditor(
  parent: HTMLElement,
  code: string,
  onChange: (code: string) => void,
  onRun: () => void,
  onCursor: (line: number, column: number, selected: number) => void,
): PlaygroundEditor {
  let marked: SourceError | null = null
  let marks: Marks = { range: null, line: null }
  const theme = new Compartment()
  parent.classList.add('editor-shell')
  const host = document.createElement('div')
  host.className = 'editor-main'
  const map = document.createElement('canvas')
  map.className = 'minimap'
  map.width = 72
  map.hidden = true
  map.setAttribute('aria-hidden', 'true')
  parent.append(host, map)

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: code,
      extensions: [
        basicSetup,
        keymap.of([{ key: 'Mod-Enter', run: () => (onRun(), true) }]),
        theme.of(editorTheme()),
        spoolHighlight(),
        spoolAssist(),
        indentGuides(),
        highlightSelectionMatches(),
        markField,
        lintGutter(),
        linter((editor) => (marked ? [mark(editor.state.doc.toString(), marked)] : []), { delay: 150 }),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString())
          if (update.selectionSet || update.docChanged || update.geometryChanged) {
            const pos = update.state.selection.main.head
            const line = update.state.doc.lineAt(pos)
            const selected = Math.abs(update.state.selection.main.to - update.state.selection.main.from)
            onCursor(line.number, pos - line.from + 1, selected)
          }
          if (update.docChanged || update.viewportChanged || update.geometryChanged) drawMap()
        }),
        EditorView.domEventHandlers({
          mousedown(event, editor) {
            if (!event.altKey && !event.metaKey) return false
            const tweak = numberAt(editor, editor.posAtCoords({ x: event.clientX, y: event.clientY }))
            if (!tweak) return false
            event.preventDefault()
            openTweak(editor, tweak, event.clientX, event.clientY)
            return true
          },
        }),
      ],
    }),
  })

  const drawMap = () => paintMinimap(map, view)
  view.scrollDOM.addEventListener('scroll', drawMap, { passive: true })
  requestAnimationFrame(drawMap)

  const publish = () => {
    view.dispatch({ effects: setMarks.of(marks) })
  }

  return {
    getCode: () => view.state.doc.toString(),
    setCode(next) {
      if (next === view.state.doc.toString()) return
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
    },
    setError(error) {
      marked = error
      forceLinting(view)
    },
    focus: () => view.focus(),
    setTheme() {
      view.dispatch({ effects: theme.reconfigure(editorTheme()) })
    },
    highlightRange(span) {
      marks = { ...marks, range: span }
      publish()
    },
    highlightLine(line) {
      marks = { ...marks, line }
      publish()
    },
    jumpTo(line, column) {
      const pos = indexAt(view.state.doc.toString(), line, column)
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
      view.focus()
    },
    setMinimap(on) {
      map.hidden = !on
      parent.classList.toggle('show-map', on)
      if (on) drawMap()
    },
  }
}

function indentGuides() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = guidesFor(view)
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = guidesFor(update.view)
      }
    },
    { decorations: (plugin) => plugin.decorations },
  )
}

function guidesFor(view: EditorView): DecorationSet {
  const marks: Range<Decoration>[] = []
  const mark = Decoration.mark({ class: 'cm-indent' })
  for (const range of view.visibleRanges) {
    let pos = range.from
    while (pos <= range.to) {
      const line = view.state.doc.lineAt(pos)
      const spaces = /^ */.exec(line.text)?.[0].length ?? 0
      for (let i = 2; i <= spaces; i += 2) marks.push(mark.range(line.from + i - 1, line.from + i))
      pos = line.to + 1
    }
  }
  return Decoration.set(marks, true)
}

function editorTheme() {
  return EditorView.theme({
    '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--text)', fontSize: '13px' },
    '.cm-scroller': {
      fontFamily: 'var(--mono)',
      fontVariantLigatures: 'none',
      lineHeight: '1.5',
      scrollBehavior: 'smooth',
    },
    '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted)', border: 'none' },
    '.cm-activeLineGutter': { color: 'var(--text)', fontWeight: '600', backgroundColor: 'transparent' },
    '.cm-activeLine': { backgroundColor: 'var(--current)' },
    '.cm-content': { padding: '4px 0', caretColor: 'var(--accent)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--selection)', borderRadius: '4px' },
    '.cm-tooltip': { backgroundColor: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--line)' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--hover)', color: 'var(--text)' },
    '.cm-diagnostic-error': { borderLeft: '3px solid var(--danger)' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
    '.cm-debug-line': { backgroundColor: 'var(--debug-line)' },
    '.cm-source-hit': { backgroundColor: 'var(--hit)' },
  })
}

function paintMinimap(canvas: HTMLCanvasElement, view: EditorView): void {
  const height = Math.max(1, view.scrollDOM.clientHeight)
  if (canvas.height !== height) canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const doc = view.state.doc
  const lines = Math.max(1, doc.lines)
  const row = height / lines
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#8a7b70'
  ctx.fillStyle = ink
  for (let n = 1; n <= lines; n++) {
    const text = doc.line(n).text
    if (!text.trim()) continue
    const width = Math.min(canvas.width - 4, 8 + text.length * 0.7)
    ctx.fillRect(2, (n - 1) * row, width, Math.max(1, row - 0.4))
  }
  const scroll = view.scrollDOM
  const scale = height / Math.max(scroll.scrollHeight, 1)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.fillRect(0, scroll.scrollTop * scale, canvas.width, Math.max(8, scroll.clientHeight * scale))
}

interface Tweak {
  from: number
  to: number
  value: number
  suffix: string
}

function numberAt(view: EditorView, pos: number | null): Tweak | null {
  if (pos === null) return null
  const source = view.state.doc.toString()
  let tokens
  try {
    tokens = tokenize(source)
  } catch {
    return null
  }
  for (const token of tokens) {
    if (token.type !== 'NUMBER') continue
    const from = indexAt(source, token.line, token.column)
    const to = from + token.lexeme.length
    if (pos < from || pos > to) continue
    const value = isQuantity(token.literal) ? token.literal.value : typeof token.literal === 'number' ? token.literal : Number(token.lexeme)
    if (!Number.isFinite(value)) return null
    const suffix = isQuantity(token.literal) ? token.lexeme.replace(/^-?(?:\d+\.\d+|\d+)/, '') : ''
    return { from, to, value, suffix }
  }
  return null
}

function openTweak(view: EditorView, tweak: Tweak, x: number, y: number): void {
  document.querySelector('.tweak')?.remove()
  const pop = document.createElement('div')
  pop.className = 'tweak'
  pop.style.left = `${Math.min(x, window.innerWidth - 220)}px`
  pop.style.top = `${Math.min(y + 8, window.innerHeight - 64)}px`
  const slider = document.createElement('input')
  slider.type = 'range'
  const span = Math.max(Math.abs(tweak.value) * 2, 10)
  slider.min = String(tweak.value - span)
  slider.max = String(tweak.value + span)
  slider.step = Number.isInteger(tweak.value) ? '1' : '0.1'
  slider.value = String(tweak.value)
  const label = document.createElement('span')
  label.textContent = formatTweak(tweak.value, tweak.suffix)
  let lastTweak = 0
  let lastTweakValue = tweak.value
  slider.addEventListener('input', () => {
    const next = Number(slider.value)
    const now = performance.now()
    window.dispatchEvent(new CustomEvent('spool-tweak', { detail: now - lastTweak < 90 && Math.abs(next - lastTweakValue) > 0.5 }))
    lastTweak = now
    lastTweakValue = next
    label.textContent = formatTweak(next, tweak.suffix)
    const text = formatTweak(next, tweak.suffix)
    view.dispatch({ changes: { from: tweak.from, to: tweak.to, insert: text } })
    tweak.to = tweak.from + text.length
  })
  pop.append(label, slider)
  document.body.append(pop)
  const close = (event: PointerEvent) => {
    if (pop.contains(event.target as Node)) return
    pop.remove()
    window.removeEventListener('pointerdown', close)
  }
  window.setTimeout(() => window.addEventListener('pointerdown', close), 0)
}

function formatTweak(value: number, suffix: string): string {
  const rounded = Number.isInteger(Number(value)) ? String(Math.round(value)) : String(Math.round(value * 100) / 100)
  return `${rounded}${suffix}`
}

function marksFor(source: string, marks: Marks): DecorationSet {
  const placed: Range<Decoration>[] = []
  if (marks.line !== null && marks.line >= 1) {
    const line = lineRange(source, marks.line)
    placed.push(Decoration.line({ class: 'cm-debug-line' }).range(line.from))
  }
  if (marks.range) {
    const from = indexAt(source, marks.range.line, marks.range.column)
    const to = indexAt(source, marks.range.endLine, marks.range.endColumn)
    if (to > from) placed.push(Decoration.mark({ class: 'cm-source-hit' }).range(from, to))
  }
  placed.sort((a, b) => a.from - b.from)
  return Decoration.set(placed, true)
}

function lineRange(source: string, line: number): { from: number } {
  let current = 1
  let index = 0
  while (index < source.length && current < line) {
    if (source[index] === '\n') current++
    index++
  }
  return { from: index }
}

function mark(source: string, error: SourceError): Diagnostic {
  const { from, to } = span(source, error.line, error.column)
  const hint = error.detail
  return { from, to, severity: 'error', message: `${error.code}: ${hint}` }
}

/** 1-based line and column → offset. Stays on that line. */
function indexAt(source: string, line: number, column: number): number {
  let current = 1
  let index = 0
  while (index < source.length && current < line) {
    if (source[index] === '\n') current++
    index++
  }
  const wanted = Math.max(1, column) - 1
  let walked = 0
  while (index < source.length && source[index] !== '\n' && walked < wanted) {
    index++
    walked++
  }
  return index
}

function span(source: string, line: number, column: number): { from: number; to: number } {
  const from = indexAt(source, line, column)
  let to = from
  while (to < source.length && /[A-Za-z0-9_]/.test(source[to] ?? '')) to++
  if (to > from) return { from, to }
  if (from < source.length && source[from] !== '\n') return { from, to: from + 1 }
  if (from > 0) return { from: from - 1, to: from }
  return { from: 0, to: 0 }
}
