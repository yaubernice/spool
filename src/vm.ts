import type { Chunk, Ins } from './bytecode.ts'
import { Op } from './bytecode.ts'
import { compile } from './compile.ts'
import { isArray } from './collections.ts'
import { presentError, RuntimeError, SourceError } from './errors.ts'
import {
  DEFAULT_MAX_CALL_DEPTH,
  DEFAULT_MAX_STEPS,
  describeValue,
  Environment,
  formatValue,
  type DebugPause,
  type ExecutionStats,
  type FunctionValue,
  type InterpretOptions,
  type ScopeSnapshot,
  type StackFrame,
  type Value,
} from './interpreter.ts'
import { collectionBuiltins } from './collections.ts'
import {
  applyOp,
  collectionItems,
  getField,
  isMap,
  makeRecord,
  mapGet,
  mapSet,
  negate,
  sameData,
  setField,
  type MapValue,
  type RecordTypeValue,
} from './data.ts'
import { matchPattern } from './match.ts'
import { mathBuiltins } from './math.ts'
import { textValue } from './interpreter.ts'
import { vecBuiltins } from './vec.ts'
import { optimize } from './optimize.ts'
import { parse } from './parser.ts'
import { mulberry32 } from './rng.ts'

/**
 * Stack VM.
 *
 * `interpretVm` runs a program to the end and returns the same kind of
 * value as `interpret`. `openVm` pauses on each PAUSE instruction, which
 * the compiler places at the start of every statement.
 * The machine never draws. Turtle commands arrive as ordinary built-ins.
 */

export interface VmSession {
  generator: Generator<DebugPause, Value, void>
  /** Scopes and turtle-independent state after the program finishes. */
  finalPause: () => DebugPause
  /** Bytecode before the optimizer. */
  raw: Chunk
  /** Bytecode that actually runs. */
  chunk: Chunk
}

export function interpretVm(source: string, options: InterpretOptions = {}): Value {
  let program
  try {
    program = parse(source)
  } catch (error) {
    if (error instanceof SourceError) throw presentError(error, source)
    throw error
  }
  const raw = compile(program)
  const chunk = options.optimize ? optimize(raw, options.optimize) : raw
  const machine = new VM(chunk, options)
  try {
    return machine.finish()
  } catch (error) {
    if (error instanceof SourceError) throw presentError(error, source)
    throw error
  }
}

export function openVm(source: string, options: InterpretOptions = {}): VmSession {
  let program
  try {
    program = parse(source)
  } catch (error) {
    if (error instanceof SourceError) throw presentError(error, source)
    throw error
  }
  const raw = compile(program)
  const chunk = options.optimize ? optimize(raw, options.optimize) : raw
  const machine = new VM(chunk, options)
  return {
    generator: machine.run(source),
    finalPause: () => machine.finalPause(),
    raw,
    chunk,
  }
}

interface CallFrame {
  chunk: Chunk
  ip: number
  parentEnv: Environment
  /** False for the top-level chunk. Falling off the end is not a call return. */
  call: boolean
}

class VM {
  private readonly root: Chunk
  private readonly maxSteps: number
  private readonly maxCallDepth: number
  private readonly stats: ExecutionStats | undefined
  private readonly globals: Environment
  private env: Environment
  private readonly stack: Value[] = []
  private readonly frames: CallFrame[] = []
  private readonly calls: StackFrame[] = []
  private steps = 0
  private callDepth = 0
  private peakDepth = 0
  private result: Value = null
  private endPause: DebugPause | null = null

  constructor(chunk: Chunk, options: InterpretOptions) {
    this.root = chunk
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS
    this.maxCallDepth = options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH
    this.stats = options.stats
    this.globals = new Environment(null, 'global')
    const random = options.seed === undefined ? Math.random : mulberry32(options.seed)
    const builtins = { ...mathBuiltins(random), ...collectionBuiltins(), ...vecBuiltins(), ...options.builtins }
    for (const [name, call] of Object.entries(builtins)) {
      this.globals.define(name, { type: 'builtin', name, call }, { line: 1, column: 1 })
    }
    this.env = this.globals
  }

  finalPause(): DebugPause {
    return this.endPause ?? this.capture(0, 0, -1, '')
  }

  /** Run to the end without pausing. Benchmarks and `interpretVm` use this. */
  finish(): Value {
    try {
      this.frames.push({ chunk: this.root, ip: 0, parentEnv: this.env, call: false })
      this.drive()
      this.publish()
      return this.result
    } catch (error) {
      this.publish()
      throw error
    }
  }

  *run(source: string): Generator<DebugPause, Value, void> {
    try {
      this.frames.push({ chunk: this.root, ip: 0, parentEnv: this.env, call: false })
      yield* this.loop()
      this.publish()
      this.endPause = this.capture(0, 0, -1, '')
      return this.result
    } catch (error) {
      this.publish()
      if (error instanceof SourceError) throw presentError(error, source)
      throw error
    }
  }

  private *loop(): Generator<DebugPause, void, void> {
    while (this.frames.length > 0) {
      const frame = this.frames[this.frames.length - 1]
      if (frame.ip >= frame.chunk.code.length) {
        this.leave(null)
        continue
      }
      const ins = frame.chunk.code[frame.ip]
      frame.ip++
      if (ins.op === Op.PAUSE) {
        yield this.capture(ins.line, ins.column, frame.ip - 1, frame.chunk.name)
        this.guardStep(ins)
        continue
      }
      this.exec(ins, frame)
    }
  }

  private drive(): void {
    while (this.frames.length > 0) {
      const frame = this.frames[this.frames.length - 1]
      if (frame.ip >= frame.chunk.code.length) {
        this.leave(null)
        continue
      }
      const ins = frame.chunk.code[frame.ip]
      frame.ip++
      if (ins.op === Op.PAUSE) {
        this.guardStep(ins)
        continue
      }
      this.exec(ins, frame)
    }
  }

  private exec(ins: Ins, frame: CallFrame): void {
    const chunk = frame.chunk
    switch (ins.op) {
      case Op.CONST:
        this.stack.push(chunk.constants[ins.arg])
        return
      case Op.LOAD:
        this.stack.push(this.env.get(chunk.names[ins.arg], ins))
        return
      case Op.STORE:
        this.env.assign(chunk.names[ins.arg], this.pop(ins), ins)
        return
      case Op.DEFINE:
        this.env.define(chunk.names[ins.arg], this.pop(ins), ins)
        return
      case Op.ADD:
        this.arith(ins, '+')
        return
      case Op.SUB:
        this.arith(ins, '-')
        return
      case Op.MUL:
        this.arith(ins, '*')
        return
      case Op.DIV:
        this.arith(ins, '/')
        return
      case Op.MOD:
        this.bin(ins, (left, right) => {
          if (right === 0) throw new RuntimeError('E0203', 'Division by zero', ins.line, ins.column)
          return left % right
        })
        return
      case Op.NEG: {
        const value = this.pop(ins)
        const negated = negate(value)
        if (negated.status === 'fail') throw new RuntimeError(negated.code, negated.detail, ins.line, ins.column)
        this.stack.push(negated.status === 'value' ? negated.value : -this.number(value, ins))
        return
      }
      case Op.NOT:
        this.stack.push(!this.boolean(this.pop(ins), ins))
        return
      case Op.EQ:
        this.compare(true)
        return
      case Op.NE:
        this.compare(false)
        return
      case Op.LT:
        this.arith(ins, '<')
        return
      case Op.GT:
        this.arith(ins, '>')
        return
      case Op.LE:
        this.arith(ins, '<=')
        return
      case Op.GE:
        this.arith(ins, '>=')
        return
      case Op.JUMP:
        frame.ip = ins.arg
        return
      case Op.JUMP_IF_FALSE:
        if (!this.boolean(this.pop(ins), ins)) frame.ip = ins.arg
        return
      case Op.JUMP_IF_TRUE:
        if (this.boolean(this.pop(ins), ins)) frame.ip = ins.arg
        return
      case Op.CALL:
        this.call(ins)
        return
      case Op.RETURN:
        this.leave(this.pop(ins))
        return
      case Op.CLOSURE: {
        const fn = chunk.functions[ins.arg]
        const value: FunctionValue = {
          type: 'function',
          name: fn.name,
          params: fn.params.map((name) => ({ name, line: ins.line, column: ins.column })),
          body: null,
          chunk: fn,
          closure: this.env,
        }
        this.stack.push(value)
        return
      }
      case Op.ARRAY: {
        const items: Value[] = []
        for (let i = 0; i < ins.arg; i++) items.push(this.pop(ins))
        items.reverse()
        this.stack.push({ type: 'array', items })
        return
      }
      case Op.INDEX: {
        const index = this.pop(ins)
        const target = this.pop(ins)
        this.stack.push(this.readIndex(target, index, ins))
        return
      }
      case Op.SET_INDEX: {
        const value = this.pop(ins)
        const index = this.pop(ins)
        const target = this.pop(ins)
        this.writeIndex(target, index, value, ins)
        return
      }
      case Op.PUSH_SCOPE:
        this.env = new Environment(this.env, chunk.labels[ins.arg] ?? 'block')
        return
      case Op.POP_SCOPE:
        if (this.env.parent) this.env = this.env.parent
        return
      case Op.CHECK_COUNT:
        this.stack.push(this.count(this.pop(ins), ins))
        return
      case Op.CHECK_INT:
        this.stack.push(this.whole(this.pop(ins), ins))
        return
      case Op.CHECK_NUM:
        this.stack.push(this.number(this.pop(ins), ins))
        return
      case Op.CHECK_BOOL:
        this.stack.push(this.boolean(this.pop(ins), ins))
        return
      case Op.SET_RESULT:
        this.result = this.pop(ins)
        return
      case Op.STR:
        this.stack.push(textValue(this.pop(ins)))
        return
      case Op.ITEMS: {
        const value = this.pop(ins)
        const listed = collectionItems(value)
        if (!listed) {
          throw new RuntimeError('E0225', `Expected a collection, but got ${describeValue(value)}`, ins.line, ins.column)
        }
        this.stack.push({ type: 'array', items: listed as Value[] })
        return
      }
      case Op.LEN: {
        const value = this.pop(ins)
        if (typeof value === 'string') this.stack.push(value.length)
        else if (isArray(value)) this.stack.push(value.items.length)
        else if (isMap(value)) this.stack.push(value.entries.length)
        else throw new RuntimeError('E0225', `Expected a collection, but got ${describeValue(value)}`, ins.line, ins.column)
        return
      }
      case Op.GET_FIELD: {
        const target = this.pop(ins)
        const field = getField(target, chunk.names[ins.arg] ?? '')
        if (field.status === 'fail') throw new RuntimeError(field.code, field.detail, ins.line, ins.column)
        this.stack.push(field.value as Value)
        return
      }
      case Op.SET_FIELD: {
        const value = this.pop(ins)
        const target = this.pop(ins)
        const stored = setField(target, chunk.names[ins.arg] ?? '', value)
        if (stored.status === 'fail') throw new RuntimeError(stored.code, stored.detail, ins.line, ins.column)
        return
      }
      case Op.MAKE_MAP: {
        const map: MapValue = { type: 'map', entries: [] }
        const pairs: { key: string; value: Value }[] = []
        for (let i = 0; i < ins.arg; i++) {
          const value = this.pop(ins)
          const key = this.pop(ins)
          if (typeof key !== 'string') throw new RuntimeError('E0220', 'Expected a string key', ins.line, ins.column)
          pairs.push({ key, value })
        }
        pairs.reverse()
        for (const pair of pairs) mapSet(map, pair.key, pair.value)
        this.stack.push(map)
        return
      }
      case Op.RECORD_TYPE: {
        const count = this.number(this.pop(ins), ins)
        const fields: string[] = []
        for (let i = 0; i < count; i++) {
          const field = this.pop(ins)
          if (typeof field !== 'string') throw new RuntimeError('E0222', 'Expected a field name', ins.line, ins.column)
          fields.push(field)
        }
        fields.reverse()
        const type: RecordTypeValue = { type: 'recordType', name: chunk.names[ins.arg] ?? '', fields }
        this.stack.push(type)
        return
      }
      case Op.MAKE_RECORD: {
        const pairs: { name: string; value: Value }[] = []
        for (let i = 0; i < ins.arg; i++) {
          const value = this.pop(ins)
          const name = this.pop(ins)
          if (typeof name !== 'string') throw new RuntimeError('E0222', 'Expected a field name', ins.line, ins.column)
          pairs.push({ name, value })
        }
        pairs.reverse()
        const type = this.pop(ins)
        const made = makeRecord(type, pairs)
        if (made.status === 'fail') throw new RuntimeError(made.code, made.detail, ins.line, ins.column)
        this.stack.push(made.value as Value)
        return
      }
      case Op.TRY_PATTERN: {
        const subject = this.pop(ins)
        const bindings = matchPattern(subject, chunk.patterns[ins.arg])
        if (!bindings) {
          this.stack.push(false)
          return
        }
        for (const binding of bindings) this.env.define(binding.name, binding.value as Value, binding)
        this.stack.push(true)
        return
      }
      case Op.MATCH_FAIL:
        throw new RuntimeError('E0224', 'No pattern matched', ins.line, ins.column)
      case Op.PAUSE:
        return
      default:
        throw new Error(`Unknown opcode ${String(ins.op)}`)
    }
  }

  private call(ins: Ins): void {
    const args: Value[] = []
    for (let i = 0; i < ins.arg; i++) args.push(this.pop(ins))
    args.reverse()
    const callee = this.pop(ins)
    if (isBuiltin(callee)) {
      this.stack.push(callee.call(args, ins))
      return
    }
    if (!isFn(callee) || callee.chunk === null) {
      throw new RuntimeError('E0204', 'That value is not a function', ins.line, ins.column)
    }
    const params = callee.chunk.params
    if (args.length !== params.length) {
      const expected = params.length
      throw new RuntimeError(
        'E0205',
        `'${callee.name}' expects ${expected} argument${expected === 1 ? '' : 's'}, got ${args.length}`,
        ins.line,
        ins.column,
      )
    }
    if (this.callDepth >= this.maxCallDepth) {
      throw new RuntimeError(
        'E0206',
        `Call depth limit of ${this.maxCallDepth} exceeded (possible infinite recursion)`,
        ins.line,
        ins.column,
      )
    }
    const env = new Environment(callee.closure, callee.name)
    for (let i = 0; i < params.length; i++) env.define(params[i], args[i], ins)
    this.callDepth++
    this.peakDepth = Math.max(this.peakDepth, this.callDepth)
    this.calls.push({ name: callee.name, line: ins.line, column: ins.column })
    this.frames.push({ chunk: callee.chunk, ip: 0, parentEnv: this.env, call: true })
    this.env = env
  }

  private leave(value: Value): void {
    const frame = this.frames.pop()
    if (!frame) return
    this.env = frame.parentEnv
    if (!frame.call) return
    this.callDepth--
    this.calls.pop()
    this.stack.push(value)
  }

  private arith(ins: Ins, op: '+' | '-' | '*' | '/' | '<' | '>' | '<=' | '>='): void {
    const right = this.pop(ins)
    const left = this.pop(ins)
    if (op === '+') {
      if (typeof left === 'string' || typeof right === 'string') {
        if (typeof left !== 'string' || typeof right !== 'string') {
          throw new RuntimeError('E0212', "'+' expects two numbers or two strings", ins.line, ins.column)
        }
        this.stack.push(left + right)
        return
      }
    }
    const applied = applyOp(op, left, right)
    if (applied.status === 'fail') throw new RuntimeError(applied.code, applied.detail, ins.line, ins.column)
    if (applied.status === 'value') {
      this.stack.push(applied.value)
      return
    }
    const combine = (a: number, b: number): Value => {
      if (op === '+') return a + b
      if (op === '-') return a - b
      if (op === '*') return a * b
      if (op === '/') {
        if (b === 0) throw new RuntimeError('E0203', 'Division by zero', ins.line, ins.column)
        return a / b
      }
      if (op === '<') return a < b
      if (op === '>') return a > b
      if (op === '<=') return a <= b
      return a >= b
    }
    this.stack.push(combine(this.number(left, ins), this.number(right, ins)))
  }

  private bin(ins: Ins, combine: (left: number, right: number) => Value): void {
    const right = this.pop(ins)
    const left = this.pop(ins)
    this.stack.push(combine(this.number(left, ins), this.number(right, ins)))
  }

  private compare(equal: boolean): void {
    const right = this.pop()
    const left = this.pop()
    const same = sameValue(left, right)
    this.stack.push(equal ? same : !same)
  }

  private readIndex(target: Value, index: Value, ins: Ins): Value {
    if (isMap(target)) {
      if (typeof index !== 'string') {
        throw new RuntimeError('E0220', `Expected a string key, but got ${describeValue(index)}`, ins.line, ins.column)
      }
      const found = mapGet(target, index)
      if (found === undefined && !target.entries.some((entry) => entry.key === index)) {
        throw new RuntimeError('E0221', `Map has no key '${index}'`, ins.line, ins.column)
      }
      return found as Value
    }
    const array = this.array(target, ins)
    return array.items[this.index(index, array.items.length, ins)]
  }

  private writeIndex(target: Value, index: Value, value: Value, ins: Ins): void {
    if (isMap(target)) {
      if (typeof index !== 'string') {
        throw new RuntimeError('E0220', `Expected a string key, but got ${describeValue(index)}`, ins.line, ins.column)
      }
      mapSet(target, index, value)
      return
    }
    const array = this.array(target, ins)
    array.items[this.index(index, array.items.length, ins)] = value
  }

  private array(value: Value, ins: Ins): { type: 'array'; items: Value[] } {
    if (!isArray(value)) {
      throw new RuntimeError('E0213', `Expected an array, but got ${describeValue(value)}`, ins.line, ins.column)
    }
    return value
  }

  private index(value: Value, length: number, ins: Ins): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new RuntimeError(
        'E0214',
        `Expected a whole number index, but got ${describeValue(value)}`,
        ins.line,
        ins.column,
      )
    }
    if (value < 0 || value >= length) {
      throw new RuntimeError(
        'E0215',
        `Index ${value} is out of range for an array of length ${length}`,
        ins.line,
        ins.column,
      )
    }
    return value
  }

  private count(value: Value, ins: Ins): number {
    const count = this.whole(value, ins)
    if (count < 0) throw new RuntimeError('E0211', 'repeat count cannot be negative', ins.line, ins.column)
    return count
  }

  private whole(value: Value, ins: Ins): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new RuntimeError('E0210', `Expected a whole number, but got ${describeValue(value)}`, ins.line, ins.column)
    }
    return value
  }

  private number(value: Value, ins: Ins): number {
    if (typeof value !== 'number') {
      throw new RuntimeError('E0209', `Expected a number, but got ${describeValue(value)}`, ins.line, ins.column)
    }
    return value
  }

  private boolean(value: Value, ins: Ins): boolean {
    if (typeof value !== 'boolean') {
      throw new RuntimeError('E0208', `Expected a boolean, but got ${describeValue(value)}`, ins.line, ins.column)
    }
    return value
  }

  private capture(line: number, column: number, ip: number, chunk: string): DebugPause {
    this.publish()
    const scopes: ScopeSnapshot[] = this.env
      .chain()
      .map((env) => ({
        label: env.label,
        bindings: env
          .entries()
          .filter(([name, value]) => !isBuiltin(value) && !name.startsWith('$'))
          .map(([name, value]) => ({ name, value: formatValue(value) })),
      }))
      .filter((scope) => scope.bindings.length > 0 || scope.label === 'global' || !['for', 'repeat', 'block', 'match'].includes(scope.label))
    return {
      line,
      column,
      scopes,
      stack: this.calls.map((frame) => ({ ...frame })),
      steps: this.steps,
      maxCallDepth: this.peakDepth,
      ip,
      chunk,
    }
  }

  private guardStep(ins: Ins): void {
    this.steps++
    this.publish()
    if (this.steps > this.maxSteps) {
      throw new RuntimeError(
        'E0207',
        `Step limit of ${this.maxSteps} exceeded (possible infinite loop)`,
        ins.line,
        ins.column,
      )
    }
  }

  private publish(): void {
    if (!this.stats) return
    this.stats.steps = this.steps
    this.stats.maxCallDepth = this.peakDepth
  }

  private pop(ins?: Ins): Value {
    const value = this.stack.pop()
    if (value === undefined) {
      const where = ins ? ` at ${ins.line}:${ins.column}` : ''
      throw new Error(`Bytecode stack underflow${where}`)
    }
    return value
  }
}

function isBuiltin(value: Value): value is Extract<Value, { type: 'builtin' }> {
  return typeof value === 'object' && value !== null && value.type === 'builtin'
}

function isFn(value: Value): value is FunctionValue {
  return typeof value === 'object' && value !== null && value.type === 'function'
}

function sameValue(left: Value, right: Value): boolean {
  const data = sameData(left, right)
  if (data !== null) return data
  if (left === null || right === null) return left === right
  if (typeof left !== typeof right) return false
  if (typeof left === 'number' || typeof left === 'string' || typeof left === 'boolean') return left === right
  return left === right
}
