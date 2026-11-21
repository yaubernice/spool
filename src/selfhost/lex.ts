import { isArray } from '../collections.ts'
import { isMap, type MapValue } from '../data.ts'
import type { Value } from '../interpreter.ts'
import { runSpoolLexer } from './run-lexer.ts'
import { lexerSpoolSource } from './sources.ts'

export { lexerSpoolSource }

export interface SpoolToken {
  type: string
  lexeme: string
  line: number
  column: number
}

export type SpoolLexResult =
  | { ok: true; tokens: SpoolToken[] }
  | { ok: false; code: string; detail: string; line: number; column: number }

/**
 * Run the self-hosted lexer on `source`.
 * The text is injected through a builtin so Spool string escapes are not needed.
 */
export function spoolTokenize(source: string, lexerSource: string = lexerSpoolSource): SpoolLexResult {
  return runSpoolLexer(lexerSource, source)
}

export function readLexResult(value: Value): SpoolLexResult {
  if (!isMap(value)) throw new Error('self-hosted lexer must return a map')
  const ok = mapBool(value, 'ok')
  if (!ok) {
    return {
      ok: false,
      code: mapString(value, 'code'),
      detail: mapString(value, 'detail'),
      line: mapNumber(value, 'line'),
      column: mapNumber(value, 'column'),
    }
  }
  const tokensValue = mapGetRequired(value, 'tokens')
  if (!isArray(tokensValue)) throw new Error('self-hosted lexer tokens must be an array')
  const tokens: SpoolToken[] = tokensValue.items.map((item) => {
    if (!isMap(item)) throw new Error('token must be a map')
    return {
      type: mapString(item, 'type'),
      lexeme: mapString(item, 'lexeme'),
      line: mapNumber(item, 'line'),
      column: mapNumber(item, 'column'),
    }
  })
  return { ok: true, tokens }
}

function mapGetRequired(map: MapValue, key: string): Value {
  const found = map.entries.find((entry) => entry.key === key)
  if (!found) throw new Error(`missing key ${key}`)
  return found.value as Value
}

function mapBool(map: MapValue, key: string): boolean {
  const value = mapGetRequired(map, key)
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`)
  return value
}

function mapString(map: MapValue, key: string): string {
  const value = mapGetRequired(map, key)
  if (typeof value !== 'string') throw new Error(`${key} must be a string`)
  return value
}

function mapNumber(map: MapValue, key: string): number {
  const value = mapGetRequired(map, key)
  if (typeof value !== 'number') throw new Error(`${key} must be a number`)
  return value
}
