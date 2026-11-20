import { forceLinting, lintGutter, linter, type Diagnostic } from '@codemirror/lint'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import type { SourceError } from '../errors.ts'

export interface PlaygroundEditor {
  getCode: () => string
  setCode: (code: string) => void
  /** Underline one error. Pass null to clear the marks. */
  setError: (error: SourceError | null) => void
  focus: () => void
}

/**
 * A CodeMirror editor. Cmd/Ctrl+Enter runs the program.
 * The underline is the error's line and column, turned into a character offset.
 */
export function createEditor(
  parent: HTMLElement,
  code: string,
  onChange: (code: string) => void,
  onRun: () => void,
): PlaygroundEditor {
  let marked: SourceError | null = null

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: code,
      extensions: [
        basicSetup,
        keymap.of([{ key: 'Mod-Enter', run: () => (onRun(), true) }]),
        EditorView.theme({
          '&': { height: '100%', fontSize: '14px' },
          '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
          '.cm-content': { padding: '8px 0' },
        }),
        lintGutter(),
        linter((editor) => (marked ? [mark(editor.state.doc.toString(), marked)] : []), {
          delay: 150,
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString())
        }),
      ],
    }),
  })

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
  }
}

function mark(source: string, error: SourceError): Diagnostic {
  const { from, to } = span(source, error.line, error.column)
  return { from, to, severity: 'error', message: error.detail }
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
