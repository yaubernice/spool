import { Op, type Chunk, type Constant, type Ins } from '../bytecode.ts'
import { isMap, isQuantity, type MapValue } from '../data.ts'
import type { Value } from '../interpreter.ts'
import { lexerSpoolSource } from './lex.ts'
import { parserSpoolSource, spoolValueToPlain } from './parse.ts'
import { runSpoolCompiler } from './run-compiler.ts'
import { compilerSpoolSource } from './sources.ts'

export { compilerSpoolSource }

export type SpoolCompileResult =
  | { ok: true; chunk: unknown }
  | { ok: false; code: string; detail: string; line: number; column: number }

const OP_NAME: Record<number, string> = {
  [Op.CONST]: 'CONST',
  [Op.LOAD]: 'LOAD',
  [Op.STORE]: 'STORE',
  [Op.DEFINE]: 'DEFINE',
  [Op.ADD]: 'ADD',
  [Op.SUB]: 'SUB',
  [Op.MUL]: 'MUL',
  [Op.DIV]: 'DIV',
  [Op.MOD]: 'MOD',
  [Op.NEG]: 'NEG',
  [Op.NOT]: 'NOT',
  [Op.EQ]: 'EQ',
  [Op.NE]: 'NE',
  [Op.LT]: 'LT',
  [Op.GT]: 'GT',
  [Op.LE]: 'LE',
  [Op.GE]: 'GE',
  [Op.JUMP]: 'JUMP',
  [Op.JUMP_IF_FALSE]: 'JUMP_IF_FALSE',
  [Op.JUMP_IF_TRUE]: 'JUMP_IF_TRUE',
  [Op.CALL]: 'CALL',
  [Op.RETURN]: 'RETURN',
  [Op.CLOSURE]: 'CLOSURE',
  [Op.ARRAY]: 'ARRAY',
  [Op.INDEX]: 'INDEX',
  [Op.SET_INDEX]: 'SET_INDEX',
  [Op.PUSH_SCOPE]: 'PUSH_SCOPE',
  [Op.POP_SCOPE]: 'POP_SCOPE',
  [Op.PAUSE]: 'PAUSE',
  [Op.CHECK_COUNT]: 'CHECK_COUNT',
  [Op.CHECK_INT]: 'CHECK_INT',
  [Op.CHECK_NUM]: 'CHECK_NUM',
  [Op.CHECK_BOOL]: 'CHECK_BOOL',
  [Op.SET_RESULT]: 'SET_RESULT',
  [Op.STR]: 'STR',
  [Op.ITEMS]: 'ITEMS',
  [Op.LEN]: 'LEN',
  [Op.GET_FIELD]: 'GET_FIELD',
  [Op.SET_FIELD]: 'SET_FIELD',
  [Op.MAKE_MAP]: 'MAKE_MAP',
  [Op.RECORD_TYPE]: 'RECORD_TYPE',
  [Op.MAKE_RECORD]: 'MAKE_RECORD',
  [Op.TRY_PATTERN]: 'TRY_PATTERN',
  [Op.MATCH_FAIL]: 'MATCH_FAIL',
  [Op.USE_MODULE]: 'USE_MODULE',
  [Op.REGISTER]: 'REGISTER',
  [Op.ENTITY_TYPE]: 'ENTITY_TYPE',
  [Op.SPAWN]: 'SPAWN',
  [Op.DESPAWN]: 'DESPAWN',
  [Op.ENTITIES]: 'ENTITIES',
  [Op.ALIVE]: 'ALIVE',
  [Op.TOUCH]: 'TOUCH',
  [Op.WAIT_TIME]: 'WAIT_TIME',
  [Op.WAIT_UNTIL]: 'WAIT_UNTIL',
  [Op.TASK]: 'TASK',
  [Op.LOCAL_GET]: 'LOCAL_GET',
  [Op.LOCAL_SET]: 'LOCAL_SET',
  [Op.LOCAL_DEF]: 'LOCAL_DEF',
  [Op.DUP]: 'DUP',
  [Op.DUP2]: 'DUP2',
  [Op.REWIND]: 'REWIND',
}

/**
 * Run the self-hosted compiler on `source`.
 * Concatenates lexer + parser + compiler (lexer/parser provide `tokenize` / `parse`).
 */
export function spoolCompile(
  source: string,
  lexerSource: string = lexerSpoolSource,
  parserSource: string = parserSpoolSource,
  compilerSource: string = compilerSpoolSource,
): SpoolCompileResult {
  return runSpoolCompiler(lexerSource, parserSource, compilerSource, source)
}

/**
 * Normalize a TypeScript `Chunk` into the plain shape the Spool compiler emits:
 * opcode names as strings, quantities as `{ type: "Quantity", ... }`, no undefined fields.
 */
export function normalizeChunk(chunk: Chunk): unknown {
  return normalizeChunkNode(chunk)
}

export function readCompileResult(value: Value): SpoolCompileResult {
  if (!isMap(value)) throw new Error('self-hosted compiler must return a map')
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
  return { ok: true, chunk: spoolValueToPlain(mapGetRequired(value, 'chunk')) }
}

function normalizeChunkNode(chunk: Chunk): Record<string, unknown> {
  return {
    name: chunk.name,
    params: [...chunk.params],
    code: chunk.code.map((ins) => normalizeIns(ins)),
    constants: chunk.constants.map((value) => normalizeConstant(value)),
    names: [...chunk.names],
    functions: chunk.functions.map((fn) => normalizeChunkNode(fn)),
    labels: [...chunk.labels],
    patterns: chunk.patterns.map((pattern) => normalizePlain(pattern)),
  }
}

function normalizeIns(ins: Ins): Record<string, unknown> {
  const out: Record<string, unknown> = {
    op: typeof ins.op === 'string' ? ins.op : (OP_NAME[ins.op as Op] ?? `OP${ins.op}`),
    arg: ins.arg,
    line: ins.line,
    column: ins.column,
  }
  if (ins.extra !== undefined) out.extra = ins.extra
  return out
}

function normalizeConstant(value: Constant): unknown {
  if (isQuantity(value)) {
    return { type: 'Quantity', value: value.value, unit: { px: value.unit.px, s: value.unit.s } }
  }
  return value
}

function normalizePlain(node: unknown): unknown {
  if (node === null || typeof node === 'boolean' || typeof node === 'number' || typeof node === 'string') {
    return node
  }
  if (isQuantity(node)) {
    return { type: 'Quantity', value: node.value, unit: { px: node.unit.px, s: node.unit.s } }
  }
  if (Array.isArray(node)) {
    return node.map(normalizePlain)
  }
  if (typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (value === undefined) continue
      out[key] = normalizePlain(value)
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
