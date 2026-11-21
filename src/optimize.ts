import { type Chunk, type Constant, type Ins, isJump, Op } from './bytecode.ts'

/**
 * Optional passes over bytecode.
 * Constant folding replaces an operation on known values with the value.
 * Dead-code elimination drops instructions no jump can reach,
 * and a jump that lands on the next instruction.
 * Division by zero is left for the VM, so the error still points at the operator.
 */

export interface Passes {
  fold: boolean
  dce: boolean
}

export function optimize(chunk: Chunk, passes: Passes): Chunk {
  return apply(cloneChunk(chunk), passes)
}

function apply(chunk: Chunk, passes: Passes): Chunk {
  let constants = chunk.constants
  let code = chunk.code
  if (passes.fold) {
    const folded = fold(code, constants)
    code = folded.code
    constants = folded.constants
  }
  if (passes.dce) code = eliminate(code)
  return {
    ...chunk,
    code,
    constants,
    functions: chunk.functions.map((fn) => apply(fn, passes)),
  }
}

function fold(code: Ins[], constants: Constant[]): { code: Ins[]; constants: Constant[] } {
  let current = code
  const pool = constants.slice()
  for (;;) {
    const targets = new Set<number>()
    for (const ins of current) if (isJump(ins.op)) targets.add(ins.arg)
    const next: Ins[] = []
    const map = new Array<number>(current.length)
    let changed = false
    let i = 0
    while (i < current.length) {
      const folded = tryFold(current, i, targets, pool)
      if (!folded) {
        map[i] = next.length
        next.push({ ...current[i] })
        i++
        continue
      }
      changed = true
      const at = next.length
      for (let k = 0; k < folded.consume; k++) map[i + k] = at
      if (folded.ins) next.push(folded.ins)
      i += folded.consume
    }
    for (const ins of next) {
      if (isJump(ins.op)) ins.arg = map[ins.arg] ?? next.length
    }
    current = next
    if (!changed) break
  }
  return { code: current, constants: pool }
}

interface Fold {
  consume: number
  ins: Ins | null
}

function tryFold(code: Ins[], index: number, targets: Set<number>, pool: Constant[]): Fold | null {
  const first = code[index]
  const second = code[index + 1]
  const third = code[index + 2]
  if (!second || targets.has(index + 1)) return null

  if (first.op === Op.CONST && second.op === Op.CHECK_NUM && typeof pool[first.arg] === 'number') {
    return { consume: 2, ins: { ...first } }
  }
  if (first.op === Op.CONST && second.op === Op.CHECK_BOOL && typeof pool[first.arg] === 'boolean') {
    return { consume: 2, ins: { ...first } }
  }
  if (first.op === Op.CONST && second.op === Op.CHECK_INT && Number.isInteger(pool[first.arg])) {
    return { consume: 2, ins: { ...first } }
  }
  if (
    first.op === Op.CONST &&
    second.op === Op.CHECK_COUNT &&
    typeof pool[first.arg] === 'number' &&
    Number.isInteger(pool[first.arg]) &&
    (pool[first.arg] as number) >= 0
  ) {
    return { consume: 2, ins: { ...first } }
  }
  if (first.op === Op.CONST && second.op === Op.NEG && typeof pool[first.arg] === 'number') {
    return { consume: 2, ins: constIns(pool, -(pool[first.arg] as number), second) }
  }
  if (first.op === Op.CONST && second.op === Op.NOT && typeof pool[first.arg] === 'boolean') {
    return { consume: 2, ins: constIns(pool, !(pool[first.arg] as boolean), second) }
  }
  if (first.op === Op.CONST && (second.op === Op.JUMP_IF_FALSE || second.op === Op.JUMP_IF_TRUE)) {
    if (typeof pool[first.arg] !== 'boolean') return null
    const flag = pool[first.arg] as boolean
    const jump = second.op === Op.JUMP_IF_FALSE ? !flag : flag
    if (!jump) return { consume: 2, ins: null }
    return { consume: 2, ins: { op: Op.JUMP, arg: second.arg, line: second.line, column: second.column } }
  }

  if (!third || targets.has(index + 2)) return null
  if (first.op !== Op.CONST || second.op !== Op.CONST) return null
  const value = foldBinary(third.op, pool[first.arg], pool[second.arg])
  if (value === undefined) return null
  return { consume: 3, ins: constIns(pool, value, third) }
}

/** `undefined` means "do not fold". */
function foldBinary(op: Op, left: Constant, right: Constant): Constant | undefined {
  if (op === Op.ADD && typeof left === 'string' && typeof right === 'string') return left + right
  if (op === Op.EQ || op === Op.NE) {
    if (typeof left === 'object' || typeof right === 'object') return undefined
    return op === Op.EQ ? left === right : left !== right
  }
  if (typeof left !== 'number' || typeof right !== 'number') return undefined
  switch (op) {
    case Op.ADD:
      return left + right
    case Op.SUB:
      return left - right
    case Op.MUL:
      return left * right
    case Op.DIV:
      return right === 0 ? undefined : left / right
    case Op.MOD:
      return right === 0 ? undefined : left % right
    case Op.LT:
      return left < right
    case Op.GT:
      return left > right
    case Op.LE:
      return left <= right
    case Op.GE:
      return left >= right
    default:
      return undefined
  }
}

function constIns(pool: Constant[], value: Constant, at: Ins): Ins {
  return { op: Op.CONST, arg: constant(pool, value), line: at.line, column: at.column }
}

function constant(pool: Constant[], value: Constant): number {
  const found = pool.findIndex((item) => item === value)
  if (found >= 0) return found
  pool.push(value)
  return pool.length - 1
}

function eliminate(code: Ins[]): Ins[] {
  let current = code.map((ins) => ({ ...ins }))
  for (;;) {
    const reachable = new Set<number>()
    const work = [0]
    while (work.length > 0) {
      const ip = work.pop()
      if (ip === undefined || ip < 0 || ip >= current.length || reachable.has(ip)) continue
      reachable.add(ip)
      const ins = current[ip]
      if (ins.op === Op.RETURN) continue
      if (ins.op === Op.JUMP) {
        work.push(ins.arg)
        continue
      }
      if (ins.op === Op.JUMP_IF_FALSE || ins.op === Op.JUMP_IF_TRUE) work.push(ins.arg)
      work.push(ip + 1)
    }
    const keep = current.map((ins, index) => reachable.has(index) && !(ins.op === Op.JUMP && ins.arg === index + 1))
    if (keep.every(Boolean)) return current
    current = remap(current, keep)
  }
}

function remap(code: Ins[], keep: boolean[]): Ins[] {
  const map = new Array<number>(code.length + 1)
  let count = 0
  for (let i = 0; i < code.length; i++) {
    map[i] = count
    if (keep[i]) count++
  }
  map[code.length] = count
  const out: Ins[] = []
  for (let i = 0; i < code.length; i++) {
    if (!keep[i]) continue
    const ins = { ...code[i] }
    if (isJump(ins.op)) ins.arg = map[Math.min(Math.max(ins.arg, 0), code.length)]
    out.push(ins)
  }
  return out
}

function cloneChunk(chunk: Chunk): Chunk {
  return {
    name: chunk.name,
    params: [...chunk.params],
    code: chunk.code.map((ins) => ({ ...ins })),
    constants: [...chunk.constants],
    names: [...chunk.names],
    labels: [...chunk.labels],
    patterns: chunk.patterns.map((pattern) => pattern),
    functions: chunk.functions.map(cloneChunk),
  }
}
