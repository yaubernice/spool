import type { Program } from '../ast.ts'
import { isArray } from '../collections.ts'
import { isMap, isQuantity, type MapValue } from '../data.ts'
import type { Value } from '../interpreter.ts'
import { lexerSpoolSource } from './lex.ts'
import { runSpoolParser } from './run-parser.ts'
import { parserSpoolSource } from './sources.ts'

export { parserSpoolSource }

export type SpoolParseResult =
  | { ok: true; program: unknown }
  | { ok: false; code: string; detail: string; line: number; column: number }

/**
 * Run the self-hosted parser on `source`.
 * Concatenates lexer + parser (lexer provides `tokenize`).
 */
export function spoolParse(
  source: string,
  lexerSource: string = lexerSpoolSource,
  parserSource: string = parserSpoolSource,
): SpoolParseResult {
  return runSpoolParser(lexerSource, parserSource, source)
}

/**
 * Convert a TypeScript `Program` into the plain map shape the Spool parser emits
 * (Quantity values use `"type":"Quantity"`; everything else keeps AST type names).
 */
export function normalizeAst(program: Program): unknown {
  return normalizeNode(program)
}

export function readParseResult(value: Value): SpoolParseResult {
  if (!isMap(value)) throw new Error('self-hosted parser must return a map')
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
  return { ok: true, program: spoolValueToPlain(mapGetRequired(value, 'program')) }
}

/** Turn a Spool VM value (maps/arrays/scalars) into plain JSON-like data. */
export function spoolValueToPlain(value: Value): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value
  }
  if (isQuantity(value)) {
    return { type: 'Quantity', value: value.value, unit: { px: value.unit.px, s: value.unit.s } }
  }
  if (isArray(value)) {
    return value.items.map((item) => spoolValueToPlain(item as Value))
  }
  if (isMap(value)) {
    const out: Record<string, unknown> = {}
    for (const entry of value.entries) {
      out[entry.key] = spoolValueToPlain(entry.value as Value)
    }
    return out
  }
  throw new Error(`unexpected value in parser result: ${typeof value}`)
}

function normalizeNode(node: unknown): unknown {
  if (node === null || typeof node === 'boolean' || typeof node === 'number' || typeof node === 'string') {
    return node
  }
  if (isQuantity(node)) {
    return { type: 'Quantity', value: node.value, unit: { px: node.unit.px, s: node.unit.s } }
  }
  if (Array.isArray(node)) {
    return node.map(normalizeNode)
  }
  if (typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (value === undefined) continue
      out[key] = normalizeNode(value)
    }
    return out
  }
  return node
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
