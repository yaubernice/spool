import type { Pattern } from './ast.ts'
import { formatQuantity, isQuantity, type Quantity } from './data.ts'

/**
 * Bytecode: the flat form of a program.
 *
 * The compiler lowers the AST into chunks of instructions.
 * A chunk is one function. Nested functions live in `functions`
 * and are referred to by the CLOSURE instruction.
 *
 * Jumps store an absolute instruction index. Constants, names,
 * and scope labels are pools on the chunk so the instruction itself
 * stays small.
 */

export const enum Op {
  CONST = 1,
  LOAD,
  STORE,
  DEFINE,
  ADD,
  SUB,
  MUL,
  DIV,
  MOD,
  NEG,
  NOT,
  EQ,
  NE,
  LT,
  GT,
  LE,
  GE,
  JUMP,
  JUMP_IF_FALSE,
  JUMP_IF_TRUE,
  CALL,
  RETURN,
  CLOSURE,
  ARRAY,
  INDEX,
  SET_INDEX,
  PUSH_SCOPE,
  POP_SCOPE,
  PAUSE,
  CHECK_COUNT,
  CHECK_INT,
  CHECK_NUM,
  CHECK_BOOL,
  SET_RESULT,
  STR,
  ITEMS,
  LEN,
  GET_FIELD,
  SET_FIELD,
  MAKE_MAP,
  RECORD_TYPE,
  MAKE_RECORD,
  TRY_PATTERN,
  MATCH_FAIL,
  USE_MODULE,
}

export interface Ins {
  op: Op
  /** Constant index, name index, jump target, argument count, or function index. */
  arg: number
  line: number
  column: number
}

export type Constant = number | string | boolean | null | Quantity

export interface Chunk {
  name: string
  params: string[]
  code: Ins[]
  constants: Constant[]
  names: string[]
  /** Nested function chunks. CLOSURE's arg indexes this list. */
  functions: Chunk[]
  labels: string[]
  /** Patterns for TRY_PATTERN. */
  patterns: Pattern[]
}

export function createChunk(name: string, params: string[] = []): Chunk {
  return { name, params, code: [], constants: [], names: [], functions: [], labels: [], patterns: [] }
}

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
}

export function isJump(op: Op): boolean {
  return op === Op.JUMP || op === Op.JUMP_IF_FALSE || op === Op.JUMP_IF_TRUE
}

export interface DisasmLine {
  chunk: string
  /** -1 for a function header, which is not an instruction. */
  ip: number
  line: number
  text: string
}

/** One row per instruction, with nested functions after the chunk that contains them. */
export function disassemble(chunk: Chunk): DisasmLine[] {
  const rows: DisasmLine[] = []
  walk(chunk, rows)
  return rows
}

export function countInstructions(chunk: Chunk): number {
  return chunk.code.length + chunk.functions.reduce((sum, fn) => sum + countInstructions(fn), 0)
}

function walk(chunk: Chunk, rows: DisasmLine[]): void {
  const title = chunk.params.length > 0 || chunk.name !== '<program>' ? `fn ${chunk.name}(${chunk.params.join(', ')})` : 'program'
  rows.push({ chunk: chunk.name, ip: -1, line: 0, text: title })
  chunk.code.forEach((ins, ip) => {
    rows.push({ chunk: chunk.name, ip, line: ins.line, text: formatIns(ins, chunk, ip) })
  })
  for (const fn of chunk.functions) walk(fn, rows)
}

function formatIns(ins: Ins, chunk: Chunk, ip: number): string {
  const name = OP_NAME[ins.op] ?? `OP${ins.op}`
  const addr = String(ip).padStart(4, ' ')
  const line = ins.line > 0 ? `L${ins.line}` : ''
  let detail = ''
  switch (ins.op) {
    case Op.CONST: {
      const value = chunk.constants[ins.arg]
      if (typeof value === 'string') detail = JSON.stringify(value)
      else if (isQuantity(value)) detail = formatQuantity(value)
      else detail = String(value)
      break
    }
    case Op.LOAD:
    case Op.STORE:
    case Op.DEFINE:
    case Op.GET_FIELD:
    case Op.SET_FIELD:
    case Op.RECORD_TYPE:
    case Op.USE_MODULE:
      detail = chunk.names[ins.arg] ?? ''
      break
    case Op.PUSH_SCOPE:
      detail = chunk.labels[ins.arg] ?? ''
      break
    case Op.CALL:
    case Op.ARRAY:
      detail = String(ins.arg)
      break
    case Op.CLOSURE: {
      const fn = chunk.functions[ins.arg]
      detail = fn ? fn.name : String(ins.arg)
      break
    }
    case Op.JUMP:
    case Op.JUMP_IF_FALSE:
    case Op.JUMP_IF_TRUE:
      detail = String(ins.arg)
      break
    default:
      break
  }
  return `${addr}  ${line.padEnd(4, ' ')} ${name}${detail ? ` ${detail}` : ''}`
}
