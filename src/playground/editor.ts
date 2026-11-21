import { forceLinting, lintGutter, linter, type Diagnostic } from '@codemirror/lint'
import { Compartment, EditorState, StateEffect, StateField, type Range } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import type { SourceError } from '../errors.ts'

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
 * A CodeMirror editor. Cmd/Ctrl+Enter runs the program.
 * The underline is the error's line and column, turned into a character offset.
 */
export function createEditor(
  parent: HTMLElement,
  code: string,
  onChange: (code: string) => void,
  onRun: () => void,
  onCursor: (line: number, column: number) => void,
): PlaygroundEditor {
  let marked: SourceError | null = null
  let marks: Marks = { range: null, line: null }
  const theme = new Compartment()

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: code,
      extensions: [
        basicSetup,
        keymap.of([{ key: 'Mod-Enter', run: () => (onRun(), true) }]),
        theme.of(document.documentElement.dataset.theme === 'light' ? [] : oneDark),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
          '.cm-content': { padding: '8px 0' },
          '.cm-debug-line': { backgroundColor: 'rgba(80, 140, 255, 0.18)' },
          '.cm-source-hit': { backgroundColor: 'rgba(240, 180, 40, 0.35)' },
        }),
        markField,
        lintGutter(),
        linter((editor) => (marked ? [mark(editor.state.doc.toString(), marked)] : []), {
          delay: 150,
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString())
          if (update.selectionSet || update.docChanged) {
            const pos = update.state.selection.main.head
            const line = update.state.doc.lineAt(pos)
            onCursor(line.number, pos - line.from + 1)
          }
        }),
      ],
    }),
  })

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
    setTheme(dark) {
      view.dispatch({ effects: theme.reconfigure(dark ? oneDark : []) })
    },
    highlightRange(span) {
      marks = { ...marks, range: span }
      publish()
    },
    highlightLine(line) {
      marks = { ...marks, line }
      publish()
    },
  }
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
  return { from, to, severity: 'error', message: `${error.code}: ${error.detail}` }
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
