import lexerSource from '../../selfhost/lexer.spool?raw'
import { runSpoolLexer } from '../selfhost/run-lexer.ts'
import { tokenize } from '../lexer.ts'
import { LexError } from '../errors.ts'

export type LexEngine = 'typescript' | 'spool'

export interface LexWorkerRequest {
  id: number
  source: string
  engine: LexEngine
}

export interface LexWorkerResponse {
  id: number
  engine: LexEngine
  ms: number
  tokens?: { type: string; lexeme: string; line: number; column: number }[]
  error?: { code: string; detail: string; line: number; column: number; message: string }
}

self.onmessage = (event: MessageEvent<LexWorkerRequest>) => {
  const { id, source, engine } = event.data
  const started = performance.now()
  try {
    if (engine === 'typescript') {
      const tokens = tokenize(source).map((token) => ({
        type: token.type,
        lexeme: token.lexeme,
        line: token.line,
        column: token.column,
      }))
      const ms = performance.now() - started
      const response: LexWorkerResponse = { id, engine, ms, tokens }
      self.postMessage(response)
      return
    }
    const result = runSpoolLexer(lexerSource, source)
    const ms = performance.now() - started
    if (!result.ok) {
      const response: LexWorkerResponse = {
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
      }
      self.postMessage(response)
      return
    }
    const response: LexWorkerResponse = { id, engine, ms, tokens: result.tokens }
    self.postMessage(response)
  } catch (error) {
    const ms = performance.now() - started
    if (error instanceof LexError) {
      const response: LexWorkerResponse = {
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
      }
      self.postMessage(response)
      return
    }
    const response: LexWorkerResponse = {
      id,
      engine,
      ms,
      error: {
        code: 'E0000',
        detail: error instanceof Error ? error.message : 'Lexer failed',
        line: 1,
        column: 1,
        message: error instanceof Error ? error.message : 'Lexer failed',
      },
    }
    self.postMessage(response)
  }
}
