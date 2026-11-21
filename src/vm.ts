import type { Host } from './host.ts'
import type { Chunk, Ins } from './bytecode.ts'
import { Op, SLOT_SPAN } from './bytecode.ts'
import { compile } from './compile.ts'
import { indexInRange, isArray } from './collections.ts'
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
  bindModule,
  type InterpretOptions,
  type ScopeSnapshot,
  type StackFrame,
  type Game,
  type Value,
} from './interpreter.ts'
import { collectionBuiltins } from './collections.ts'
import {
  applyOp,
  collectionItems,
  getField,
  isEntity,
  isEntityType,
  isMap,
  isQuantity,
  isVec,
  type EntityTypeValue,
  type RecordTypeValue,
  makeRecord,
  mapGet,
  mapSet,
  negate,
  quantity,
  sameData,
  setField,
  type MapValue,
  type VecValue,
} from './data.ts'
import { matchPattern } from './match.ts'
import { mathBuiltins } from './math.ts'
import { textValue } from './interpreter.ts'
import { vecBuiltins } from './vec.ts'
import { optimize } from './optimize.ts'
import { parse } from './parser.ts'
import { TICK_DT, ticksFor, type FrameTape, type KeyEvent } from './clock.ts'
import { decodeMachine, encodeMachine, type VmImage } from './image.ts'
import { touchingPairs, World } from './world.ts'
import { mulberry32, type SeededRandom } from './rng.ts'

function retarget(current: unknown, next: number): Value {
  if (isQuantity(current)) return { type: 'quantity', value: next, unit: { ...current.unit } }
  return next
}

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
  /** Plain data for the paused machine. Safe to `JSON.parse(JSON.stringify(...))`. */
  image: () => VmImage
  /** Put a saved image back. The next `frame` continues from that moment. */
  restore: (image: VmImage) => void
  handlerCount: () => number
  frame: (events: KeyEvent[]) => void
  read: (name: string) => Value
  glance: () => DebugPause
  /** Live entities, so a reload can put them back when the shape is unchanged. */
  captureEntities: () => EntityShot[]
  adoptEntities: (saved: EntityShot[]) => void
  /** Move an entity's center. The page uses this while the preview is paused. */
  placeEntity: (id: number, x: number, y: number) => void
  /** True once after `rewind`, then false until the next one. */
  consumeRewind: () => boolean
  /** Run a snippet in the live game. Recorded so a later rewind replays it. */
  eval: (source: string) => Value
}

export interface EntityShot {
  id: number
  name: string
  fields: Record<string, Value>
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
    image: () => machine.image(),
    restore: (image) => machine.restore(image),
    handlerCount: () => machine.handlerCount(),
    frame: (events) => machine.frame(events),
    read: (name) => machine.read(name),
    consumeRewind: () => machine.consumeRewind(),
    glance: () => machine.glance(),
    captureEntities: () => machine.captureEntities(),
    adoptEntities: (saved) => machine.adoptEntities(saved),
    placeEntity: (id, x, y) => machine.placeEntity(id, x, y),
    eval: (source) => machine.evalSnippet(source),
  }
}

/** Run the top level on the VM, then expose the event handlers to a clock. */
export function loadGame(source: string, options: InterpretOptions = {}): Game {
  const session = openVm(source, options)
  try {
    let step = session.generator.next()
    while (!step.done) step = session.generator.next()
  } catch (error) {
    if (error instanceof SourceError) throw presentError(error, source)
    throw error
  }
  return {
    hasHandlers: () => session.handlerCount() > 0,
    get: (name) => session.read(name),
    frame: (events) => session.frame(events),
    eval: (source) => session.eval(source),
    rewound: () => session.consumeRewind(),
  }
}

/** Continue a saved machine until the program ends. */
export function resumeVm(source: string, image: VmImage, options: InterpretOptions = {}): Value {
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
  machine.restore(image)
  try {
    return machine.finish()
  } catch (error) {
    if (error instanceof SourceError) throw presentError(error, source)
    throw error
  }
}

interface VmHandler {
  event: 'start' | 'tick' | 'key' | 'key_up'
  key: string | null
  fn: FunctionValue
  at: Ins
}

interface CallFrame {
  chunk: Chunk
  ip: number
  parentEnv: Environment
  /** False for the top-level chunk. Falling off the end is not a call return. */
  call: boolean
  /** True for a task, every, or after. `wait` is legal only in that frame. */
  task?: boolean
}

interface SleepingTask {
  frame: CallFrame
  env: Environment
  call: StackFrame
  mode: 'time' | 'until'
  wake: number
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
  private readonly modules: Host['modules']
  private readonly rng: SeededRandom | null
  private restored = false
  private started = false
  private readonly handlers: VmHandler[] = []
  private readonly rules: { left: string; right: string; fn: FunctionValue; at: Ins }[] = []
  private readonly world = new World()
  private readonly tasks: { fn: FunctionValue; started: boolean; at: Ins }[] = []
  private readonly sleeping: SleepingTask[] = []
  private ticks = 0
  private halted = false
  private cursorLine = 0
  private cursorColumn = 0
  private origin: VmImage | null = null
  private log: FrameTape[] = []
  private pending: string[] = []
  private carry: string[] | null = null
  private replaying = false
  private requested: number | null = null
  private justRewound = false

  constructor(chunk: Chunk, options: InterpretOptions) {
    this.root = chunk
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS
    this.maxCallDepth = options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH
    this.stats = options.stats
    this.globals = new Environment(null, 'global')
    this.modules = options.modules ?? {}
    this.rng = options.seed === undefined ? null : mulberry32(options.seed)
    const random = this.rng ?? Math.random
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
      if (!this.restored) this.frames.push({ chunk: this.root, ip: 0, parentEnv: this.env, call: false })
      this.drive()
      this.resolveTouches()
      this.launchIdle()
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
      this.resolveTouches()
      this.launchIdle()
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
      this.note(ins)
      if (ins.op === Op.PAUSE) {
        yield this.capture(ins.line, ins.column, frame.ip - 1, frame.chunk.name)
        this.guardStep(ins)
        continue
      }
      this.exec(ins, frame)
    }
  }

  private drive(): void {
    this.halted = false
    while (this.frames.length > 0 && !this.halted) {
      const frame = this.frames[this.frames.length - 1]
      if (frame.ip >= frame.chunk.code.length) {
        this.leave(null)
        continue
      }
      const ins = frame.chunk.code[frame.ip]
      frame.ip++
      this.note(ins)
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
      case Op.LOCAL_GET: {
        const depth = Math.floor(ins.arg / SLOT_SPAN)
        const slot = ins.arg % SLOT_SPAN
        this.stack.push(this.localEnv(depth, ins).readLocal(slot, chunk.names[ins.extra ?? 0] ?? '', ins))
        return
      }
      case Op.LOCAL_SET: {
        const depth = Math.floor(ins.arg / SLOT_SPAN)
        const slot = ins.arg % SLOT_SPAN
        this.localEnv(depth, ins).writeLocal(slot, chunk.names[ins.extra ?? 0] ?? '', this.pop(ins), ins)
        return
      }
      case Op.LOCAL_DEF:
        this.env.define(chunk.names[ins.extra ?? 0] ?? '', this.pop(ins), ins, ins.arg)
        return
      case Op.DUP: {
        const top = this.stack[this.stack.length - 1]
        if (top === undefined) throw new Error(`Bytecode stack underflow at ${ins.line}:${ins.column}`)
        this.stack.push(top)
        return
      }
      case Op.DUP2: {
        const right = this.stack[this.stack.length - 1]
        const left = this.stack[this.stack.length - 2]
        if (right === undefined || left === undefined) {
          throw new Error(`Bytecode stack underflow at ${ins.line}:${ins.column}`)
        }
        this.stack.push(left, right)
        return
      }
      case Op.REWIND:
        this.requested = ticksFor(this.pop(ins), ins, 'rewind')
        this.frames.length = 0
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
        const fieldName = chunk.names[ins.arg] ?? ''
        if (isEntityType(target) && fieldName === 'count') {
          this.stack.push(this.world.ofType(target.name).length)
          return
        }
        const field = getField(target, fieldName)
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
      case Op.USE_MODULE:
        this.stack.push(bindModule(this.modules, chunk.names[ins.arg] ?? '', ins))
        return
      case Op.ENTITY_TYPE: {
        const count = this.number(this.pop(ins), ins)
        const fields: string[] = []
        for (let i = 0; i < count; i++) {
          const field = this.pop(ins)
          if (typeof field !== 'string') throw new RuntimeError('E0222', 'Expected a field name', ins.line, ins.column)
          fields.push(field)
        }
        fields.reverse()
        const type: EntityTypeValue = { type: 'entityType', name: chunk.names[ins.arg] ?? '', fields }
        this.stack.push(type)
        return
      }
      case Op.SPAWN: {
        const pairs: { name: string; value: Value }[] = []
        for (let i = 0; i < ins.arg; i++) {
          const value = this.pop(ins)
          const name = this.pop(ins)
          if (typeof name !== 'string') throw new RuntimeError('E0803', 'Expected a field name', ins.line, ins.column)
          pairs.push({ name, value })
        }
        pairs.reverse()
        const type = this.pop(ins)
        const y = this.pop(ins)
        const x = this.pop(ins)
        if (!isEntityType(type)) {
          throw new RuntimeError('E0805', `Expected an entity type, but got ${describeValue(type)}`, ins.line, ins.column)
        }
        this.stack.push(this.world.spawn(type, x, y, pairs, ins))
        return
      }
      case Op.DESPAWN:
        this.world.despawn(this.pop(ins), ins)
        return
      case Op.ENTITIES: {
        const type = this.pop(ins)
        if (!isEntityType(type)) {
          throw new RuntimeError('E0805', `Expected an entity type, but got ${describeValue(type)}`, ins.line, ins.column)
        }
        this.stack.push({ type: 'array', items: this.world.ofType(type.name) })
        return
      }
      case Op.ALIVE: {
        const value = this.pop(ins)
        this.stack.push(isEntity(value) && value.alive)
        return
      }
      case Op.TOUCH: {
        const fn = this.pop(ins)
        const right = this.pop(ins)
        const left = this.pop(ins)
        if (!isFn(fn) || typeof left !== 'string' || typeof right !== 'string') {
          throw new RuntimeError('E0805', 'Expected an entity type', ins.line, ins.column)
        }
        this.rules.push({ left, right, fn, at: ins })
        return
      }
      case Op.WAIT_TIME: {
        const wake = this.ticks + ticksFor(this.pop(ins), ins)
        this.park(ins, 'time', wake)
        return
      }
      case Op.WAIT_UNTIL:
        this.park(ins, 'until', 0)
        return
      case Op.TASK: {
        const fn = this.pop(ins)
        if (!isFn(fn) || fn.chunk === null) {
          throw new RuntimeError('E0204', 'That value is not a function', ins.line, ins.column)
        }
        this.tasks.push({ fn, started: false, at: ins })
        return
      }
      case Op.REGISTER: {
        const key = this.pop(ins)
        const fn = this.pop(ins)
        if (typeof key !== 'string' || !isFn(fn)) {
          throw new RuntimeError('E0204', 'That value is not a function', ins.line, ins.column)
        }
        const event = (['start', 'tick', 'key', 'key_up'] as const)[ins.arg]
        if (!event) throw new RuntimeError('E0204', 'That value is not a function', ins.line, ins.column)
        this.handlers.push({ event, key: key === '' ? null : key, fn, at: ins })
        return
      }
      case Op.PAUSE:
        return
      default:
        throw new Error(`Unknown opcode ${String(ins.op)}`)
    }
  }

  private call(ins: Ins, task = false): void {
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
    for (let i = 0; i < params.length; i++) env.define(params[i], args[i], ins, i)
    this.callDepth++
    this.peakDepth = Math.max(this.peakDepth, this.callDepth)
    this.calls.push({ name: callee.name, line: ins.line, column: ins.column })
    this.frames.push({ chunk: callee.chunk, ip: 0, parentEnv: this.env, call: true, task })
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
    if (typeof target === 'string') {
      return target[indexInRange(index, target.length, ins, 'string')]
    }
    const array = this.array(target, ins)
    return array.items[indexInRange(index, array.items.length, ins, 'array')]
  }

  private writeIndex(target: Value, index: Value, value: Value, ins: Ins): void {
    if (isMap(target)) {
      if (typeof index !== 'string') {
        throw new RuntimeError('E0220', `Expected a string key, but got ${describeValue(index)}`, ins.line, ins.column)
      }
      mapSet(target, index, value)
      return
    }
    if (typeof target === 'string') {
      throw new RuntimeError('E0217', 'Cannot assign into a string; strings are immutable', ins.line, ins.column)
    }
    const array = this.array(target, ins)
    array.items[indexInRange(index, array.items.length, ins, 'array')] = value
  }

  private array(value: Value, ins: Ins): { type: 'array'; items: Value[] } {
    if (!isArray(value)) {
      throw new RuntimeError('E0213', `Expected an array, but got ${describeValue(value)}`, ins.line, ins.column)
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
      entities: this.world.entities.map((entity) => ({
        name: entity.name,
        id: entity.id,
        fields: Object.entries(entity.fields).map(([name, value]) => ({ name, value: formatValue(value as Value) })),
      })),
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

  handlerCount(): number {
    return this.handlers.length + this.tasks.length
  }

  read(name: string): Value {
    return this.globals.get(name, { line: 1, column: 1 })
  }

  glance(): DebugPause {
    return this.capture(this.cursorLine, this.cursorColumn, -1, '')
  }

  captureEntities(): EntityShot[] {
    return this.world.entities
      .filter((entity) => entity.alive)
      .map((entity) => ({
        id: entity.id,
        name: entity.name,
        fields: Object.fromEntries(
          Object.entries(entity.fields).map(([key, value]) => [
            key,
            isQuantity(value) ? { type: 'quantity' as const, value: value.value, unit: { ...value.unit } } : (value as Value),
          ]),
        ),
      }))
  }

  adoptEntities(saved: EntityShot[]): void {
    for (const shot of saved) {
      const entity = this.world.entities.find((item) => item.id === shot.id && item.name === shot.name && item.alive)
      if (!entity) continue
      for (const [key, value] of Object.entries(shot.fields)) {
        if (Object.prototype.hasOwnProperty.call(entity.fields, key)) entity.fields[key] = value
      }
    }
  }

  placeEntity(id: number, x: number, y: number): void {
    const entity = this.world.entities.find((item) => item.id === id && item.alive)
    if (!entity) return
    entity.fields.x = retarget(entity.fields.x, x)
    entity.fields.y = retarget(entity.fields.y, y)
    const pos = entity.fields.pos
    if (isVec(pos)) {
      pos.x = retarget(pos.x, x) as VecValue['x']
      pos.y = retarget(pos.y, y) as VecValue['y']
    }
  }

  consumeRewind(): boolean {
    const flag = this.justRewound
    this.justRewound = false
    return flag
  }

  private note(ins: Ins): void {
    if (ins.line > 0) {
      this.cursorLine = ins.line
      this.cursorColumn = ins.column
    }
  }

  frame(events: KeyEvent[]): void {
    const repl = this.replaying ? (this.carry ?? []) : this.pending.splice(0)
    this.carry = null
    if (!this.origin) this.origin = this.image()
    if (!this.replaying) this.log.push({ events, repl })
    if (this.replaying) {
      for (const snippet of repl) this.evalSnippet(snippet)
    }
    this.steps = 0
    if (!this.started) {
      this.started = true
      this.dispatch('start', null, null)
    }
    if (this.requested !== null) return this.finishRewind()
    this.launchIdle()
    if (this.requested !== null) return this.finishRewind()
    this.ticks += 1
    this.resumeDue('time')
    if (this.requested !== null) return this.finishRewind()
    this.dispatch('tick', quantity(TICK_DT.value, TICK_DT.unit), null)
    if (this.requested !== null) return this.finishRewind()
    this.resumeDue('until')
    if (this.requested !== null) return this.finishRewind()
    for (const event of events) {
      this.dispatch(event.type, null, event.key)
      if (this.requested !== null) return this.finishRewind()
    }
    this.resolveTouches()
    if (this.requested !== null) this.finishRewind()
  }

  private finishRewind(): void {
    const back = this.requested
    this.requested = null
    if (back === null || this.replaying || !this.origin) return
    const keep = Math.max(0, this.log.length - 1 - back)
    const replay = this.log.slice(0, keep)
    this.restore(this.origin)
    this.pending = []
    this.log = []
    this.replaying = true
    for (const batch of replay) {
      this.carry = batch.repl
      this.frame(batch.events)
    }
    this.replaying = false
    this.log = replay
    this.justRewound = true
  }

  private launchIdle(): void {
    for (const task of this.tasks) {
      if (this.requested !== null) return
      if (task.started) continue
      task.started = true
      this.stack.push(task.fn)
      this.call({ op: Op.CALL, arg: 0, line: task.at.line, column: task.at.column }, true)
      this.drive()
      if (this.requested !== null) return
      if (!this.halted) this.stack.pop()
    }
  }

  private resumeDue(mode: SleepingTask['mode']): void {
    const due: SleepingTask[] = []
    const later: SleepingTask[] = []
    for (const task of this.sleeping) {
      if (task.mode === mode && (mode === 'until' || task.wake <= this.ticks)) due.push(task)
      else later.push(task)
    }
    this.sleeping.length = 0
    this.sleeping.push(...later)
    for (const task of due) {
      if (this.requested !== null) return
      this.frames.push(task.frame)
      this.env = task.env
      this.calls.push(task.call)
      this.callDepth++
      this.peakDepth = Math.max(this.peakDepth, this.callDepth)
      this.drive()
      if (this.requested !== null) return
      if (!this.halted) this.stack.pop()
    }
  }

  /** Pop the task frame and keep it until the game clock wakes it. */
  private park(ins: Ins, mode: SleepingTask['mode'], wake: number): void {
    const frame = this.frames[this.frames.length - 1]
    if (!frame?.task) {
      throw new RuntimeError('E0901', 'wait is only allowed inside a task', ins.line, ins.column)
    }
    this.frames.pop()
    const env = this.env
    this.env = frame.parentEnv
    this.callDepth--
    const call = this.calls.pop()
    if (!call) throw new Error('task is missing a call frame')
    this.sleeping.push({ frame, env, call, mode, wake })
    this.halted = true
  }

  private resolveTouches(): void {
    for (const rule of this.rules) {
      if (this.requested !== null) return
      for (const [left, right] of touchingPairs(this.world, rule.left, rule.right, rule.at)) {
        if (this.requested !== null) return
        if (!left.alive || !right.alive) continue
        this.stack.push(rule.fn)
        this.stack.push(left)
        this.stack.push(right)
        this.call({ op: Op.CALL, arg: 2, line: rule.at.line, column: rule.at.column })
        this.drive()
        if (this.requested !== null) return
        this.stack.pop()
      }
    }
  }

  private dispatch(event: VmHandler['event'], arg: Value | null, key: string | null): void {
    for (const handler of this.handlers) {
      if (this.requested !== null) return
      if (handler.event !== event) continue
      if (handler.key !== null && handler.key !== key) continue
      const count = arg === null ? 0 : 1
      this.stack.push(handler.fn)
      if (arg !== null) this.stack.push(arg)
      this.call({ op: Op.CALL, arg: count, line: handler.at.line, column: handler.at.column })
      this.drive()
      if (this.requested !== null) return
      this.stack.pop()
    }
  }

  image(): VmImage {
    return encodeMachine({
      root: this.root,
      rng: this.rng ? this.rng.state : null,
      steps: this.steps,
      callDepth: this.callDepth,
      peakDepth: this.peakDepth,
      result: this.result,
      stack: this.stack,
      env: this.env,
      globals: this.globals,
      frames: this.frames,
      calls: this.calls,
      world: this.world.entities,
      handlers: this.handlers.map((handler) => ({
        event: handler.event,
        key: handler.key,
        fn: handler.fn,
        line: handler.at.line,
        column: handler.at.column,
      })),
      rules: this.rules.map((rule) => ({
        left: rule.left,
        right: rule.right,
        fn: rule.fn,
        line: rule.at.line,
        column: rule.at.column,
      })),
      tasks: this.tasks.map((task) => ({
        fn: task.fn,
        started: task.started,
        line: task.at.line,
        column: task.at.column,
      })),
      sleeping: this.sleeping.map((sleep) => ({
        frame: sleep.frame,
        env: sleep.env,
        call: sleep.call,
        mode: sleep.mode,
        wake: sleep.wake,
      })),
      ticks: this.ticks,
      started: this.started,
      line: this.cursorLine,
      column: this.cursorColumn,
    })
  }

  restore(image: VmImage): void {
    if (this.rng && image.rng !== null) this.rng.state = image.rng >>> 0
    const builtins = new Map<string, Value>()
    for (const [, value] of this.globals.entries()) {
      if (isBuiltin(value)) builtins.set(value.name, value)
    }
    const decoded = decodeMachine(image, this.root, this.globals, this.modules, (name) => {
      const found = builtins.get(name)
      if (found) return found
      const dot = name.indexOf('.')
      if (dot > 0) {
        const module = bindModule(this.modules, name.slice(0, dot), { line: 1, column: 1 })
        const field = module.fields[name.slice(dot + 1)]
        if (isBuiltin(field as Value)) return field as Value
      }
      throw new Error(`Cannot restore built-in ${name}`)
    })
    this.stack.length = 0
    this.stack.push(...decoded.stack)
    this.env = decoded.env
    this.frames.length = 0
    this.frames.push(...decoded.frames)
    this.calls.length = 0
    this.calls.push(...image.calls)
    this.steps = image.steps
    this.callDepth = image.callDepth
    this.peakDepth = image.peakDepth
    this.result = decoded.result
    this.world.replace(decoded.entities)
    this.handlers.length = 0
    this.handlers.push(
      ...decoded.handlers.map((handler) => ({
        event: handler.event,
        key: handler.key,
        fn: handler.fn,
        at: { op: Op.CALL, arg: 0, line: handler.line, column: handler.column },
      })),
    )
    this.rules.length = 0
    this.rules.push(
      ...decoded.rules.map((rule) => ({
        left: rule.left,
        right: rule.right,
        fn: rule.fn,
        at: { op: Op.CALL, arg: 0, line: rule.line, column: rule.column },
      })),
    )
    this.tasks.length = 0
    this.tasks.push(
      ...decoded.tasks.map((task) => ({
        fn: task.fn,
        started: task.started,
        at: { op: Op.CALL, arg: 0, line: task.line, column: task.column },
      })),
    )
    this.sleeping.length = 0
    this.sleeping.push(...decoded.sleeping)
    this.ticks = decoded.ticks
    this.started = decoded.started
    this.cursorLine = decoded.line
    this.cursorColumn = decoded.column
    this.restored = true
    this.pending = []
  }

  /** Run statements against the live game and remember them for rewind. */
  evalSnippet(source: string): Value {
    let program
    try {
      program = parse(source)
    } catch (error) {
      if (error instanceof SourceError) throw presentError(error, source)
      throw error
    }
    const chunk = compile(program)
    const depth = this.frames.length
    const stacked = this.stack.length
    const steps = this.steps
    this.steps = 0
    this.frames.push({ chunk, ip: 0, parentEnv: this.globals, call: false })
    this.env = this.globals
    try {
      this.drive()
    } catch (error) {
      this.frames.length = depth
      this.stack.length = stacked
      this.steps = steps
      if (error instanceof SourceError) throw presentError(error, source)
      throw error
    }
    this.steps = steps
    if (this.requested !== null) {
      if (!this.replaying) this.finishRewind()
      return this.result
    }
    if (!this.replaying) this.pending.push(source)
    const showed = program.body.some((statement) => statement.type === 'ExprStmt')
    return showed ? this.result : null
  }

  /** Walk `depth` parents. Depth 0 is the environment the instruction is running in. */
  private localEnv(depth: number, at: Ins): Environment {
    let env: Environment | null = this.env
    for (let i = 0; i < depth && env; i++) env = env.parent
    if (!env) throw new RuntimeError('E0202', 'Undefined variable', at.line, at.column)
    return env
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
