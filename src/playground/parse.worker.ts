import lexerSource from '../../selfhost/lexer.spool?raw'
import parserSource from '../../selfhost/parser.spool?raw'
import { runSpoolParser } from '../selfhost/run-parser.ts'
import { parse } from '../parser.ts'
import { normalizeAst } from '../selfhost/parse.ts'
import { ParseError } from '../errors.ts'

export type AstEngine = 'typescript' | 'spool'

export interface ParseWorkerRequest {
  id: number
  source: string
  engine: AstEngine
}

export interface ParseWorkerResponse {
  id: number
  engine: AstEngine
  ms: number
  program?: unknown
  error?: { code: string; detail: string; line: number; column: number; message: string }
}

self.onmessage = (event: MessageEvent<ParseWorkerRequest>) => {
  const { id, source, engine } = event.data
  const started = performance.now()
  try {
    if (engine === 'typescript') {
      const program = normalizeAst(parse(source))
      const ms = performance.now() - started
      self.postMessage({ id, engine, ms, program } satisfies ParseWorkerResponse)
      return
    }
    const result = runSpoolParser(lexerSource, parserSource, source)
    const ms = performance.now() - started
    if (!result.ok) {
      self.postMessage({
        id,
        engine,
        ms,
        error: {
          code: result.code,
          detail: result.detail,
          line: result.line,
          column: result.column,
          message: `${result.code}: ${result.detail} (line ${result.line}, column ${result.column})`,
        },
      } satisfies ParseWorkerResponse)
      return
    }
    self.postMessage({ id, engine, ms, program: result.program } satisfies ParseWorkerResponse)
  } catch (error) {
    const ms = performance.now() - started
    if (error instanceof ParseError) {
      self.postMessage({
        id,
        engine,
        ms,
        error: {
          code: error.code,
          detail: error.detail,
          line: error.line,
          column: error.column,
          message: error.message,
        },
      } satisfies ParseWorkerResponse)
      return
    }
    self.postMessage({
      id,
      engine,
      ms,
      error: {
        code: 'E0100',
        detail: error instanceof Error ? error.message : 'Parse failed',
        line: 1,
        column: 1,
        message: error instanceof Error ? error.message : 'Parse failed',
      },
    } satisfies ParseWorkerResponse)
  }
}
