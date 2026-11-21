import type {
  BlockStmt,
  CallExpr,
  Expr,
  Parameter,
  Program,
  SourceLocation,
  Stmt,
} from './ast.ts'
import type { Chunk } from './bytecode.ts'
import {
  applyOp,
  collectionItems,
  formatQuantity,
  getField,
  isEntityType,
  isMap,
  isQuantity,
  isRecord,
  isRecordType,
  isVec,
  makeRecord,
  mapGet,
  quantity,
  mapSet,
  negate,
  sameData,
  setField,
  valueLabel,
  type EntityTypeValue,
  type EntityValue,
  type MapValue,
  type Quantity,
  type ModuleValue,
  type RecordTypeValue,
  type RecordValue,
  type VecValue,
} from './data.ts'
import { matchPattern } from './match.ts'
import { vecBuiltins } from './vec.ts'
import { isArray } from './collections.ts'
import { collectionBuiltins } from './collections.ts'
import { presentError, RuntimeError, SourceError, suggestName } from './errors.ts'
import { mathBuiltins } from './math.ts'
import { TICK_DT, ticksFor, type FrameTape, type KeyEvent } from './clock.ts'
import type { Host } from './host.ts'
import { parse } from './parser.ts'
import { mulberry32 } from './rng.ts'
import { touchingPairs, World } from './world.ts'

/**
 * Interpreter: walk the AST and run it.
 *
 * Values live in an environment. Each block and each function call gets
 * its own environment, linked to the one outside it. Looking up a name
 * walks that chain. `let` binds in the current environment, so a block
 * can shadow an outer name. `n = n + 1` changes the existing binding,
 * even when it lives in an outer environment.
 *
 * `return` is not a value. It is a signal that jumps back to the function
 * that is running. A step limit stops a runaway loop, and a call-depth
 * limit stops runaway recursion.
 *
 * `debug` pauses before each statement and yields a snapshot. `interpret`
 * drains those pauses and returns the same value as before. Built-ins
 * such as `forward` are passed in. This file never draws.
 */

export const DEFAULT_MAX_STEPS = 100_000
export const DEFAULT_MAX_CALL_DEPTH = 100

/**
 * A function supplied by the host, for example a turtle command.
 * `at` is the call in the source, so the host can throw a positioned error.
 */
export type HostFunction = (args: Value[], at: SourceLocation) => Value

export interface ArrayValue {
  type: 'array'
  items: Value[]
}

export type Value =
  | number
  | string
  | boolean
  | null
  | FunctionValue
  | BuiltinValue
  | ArrayValue
  | Quantity
  | VecValue
  | MapValue
  | RecordValue
  | RecordTypeValue
  | EntityValue
  | EntityTypeValue
  | ModuleValue

export interface ExecutionStats {
  steps: number
  maxCallDepth: number
}

export interface InterpretOptions {
  builtins?: Record<string, HostFunction>
  maxSteps?: number
  maxCallDepth?: number
  /** Filled in as the program runs, including when it stops with an error. */
  stats?: ExecutionStats
  /**
   * When set, `random()` draws from a fixed sequence.
   * The same seed and the same program always produce the same results.
   */
  seed?: number
  /** Used by the bytecode VM. The tree-walker ignores it. */
  optimize?: { fold: boolean; dce: boolean }
  /**
   * Modules for `use`. The name after `use` is a key in this map.
   * A missing name is an error. The interpreter does not know what a
   * module does; the host registers the functions.
   */
  modules?: Host['modules']
}

/** One environment on the scope chain, with builtins left out. */
export interface ScopeSnapshot {
  label: string
  bindings: { name: string; value: string }[]
}

/** A function that is currently running. The last frame is the current call. */
export interface StackFrame {
  name: string
  line: number
  column: number
}

/** Where the program is paused, before the statement at `line`:`column` runs. */
export interface DebugPause {
  line: number
  column: number
  scopes: ScopeSnapshot[]
  stack: StackFrame[]
  steps: number
  maxCallDepth: number
  /** Live entities at this pause. */
  entities: { name: string; id: number; fields: { name: string; value: string }[] }[]
  /** Instruction index when a VM is paused. -1 for the tree-walker. */
  ip: number
  /** Function chunk name when a VM is paused. Empty for the tree-walker. */
  chunk: string
}

export interface FunctionValue {
  type: 'function'
  name: string
  params: Parameter[]
  /** Set for a function the tree-walker runs. Null for a VM closure. */
  body: BlockStmt | null
  /** Set for a function the VM runs. Null for a tree-walker closure. */
  chunk: Chunk | null
  /** The environment that was active where the function was defined. */
  closure: Environment
}

interface BuiltinValue {
  type: 'builtin'
  name: string
  call: HostFunction
}

/**
 * Run a program. The result is the value of the last expression statement
 * that actually ran, or null when none did.
 */
export function interpret(source: string, options: InterpretOptions = {}): Value {
  const session = debug(source, options)
  try {
    let step = session.next()
    while (!step.done) step = session.next()
    return step.value
  } catch (error) {
    if (error instanceof SourceError) throw presentError(error, source)
    throw error
  }
}

/**
 * Pause before every statement. The UI calls `next` once per Step,
 * or in a loop that yields to the browser for Continue.
 * The return value matches `interpret`.
 */
export interface Game {
  hasHandlers(): boolean
  get(name: string): Value
  /**
   * One fixed step. `on start` once, then new tasks, then the clock,
   * then tasks whose wait has elapsed, then `on tick`, then `wait until`,
   * then keys, then collisions.
   */
  frame(events: KeyEvent[]): void
  /** Run a snippet in the live game. Recorded so a later rewind replays it. */
  eval(source: string): Value
  /** True once after `rewind`, then false until the next one. */
  rewound(): boolean
}

/** Thrown to leave the current frame after `rewind` has been requested. */
const REWIND: unique symbol = Symbol('rewind')

/** A task yielded this instead of a pause. The scheduler keeps the generator. */
interface Suspend {
  suspend: 'time' | 'until'
  wake: number
}

type Step = DebugPause | Suspend

function isSuspend(value: Step): value is Suspend {
  return 'suspend' in value
}

interface LiveTask {
  started: boolean
  mode: 'idle' | 'time' | 'until' | 'done'
  wake: number
  savedEnv: Environment | null
  gen: Generator<Step, void, void> | null
  start: () => Generator<Step, void, void>
}

/** Run the top level, then expose the event handlers to a clock. */
export function loadGame(source: string, options: InterpretOptions = {}): Game {
  let program: Program
  try {
    program = parse(source)
  } catch (error) {
    if (error instanceof SourceError) throw presentError(error, source)
    throw error
  }
  const holder: { machine: Interpreter } = { machine: undefined as unknown as Interpreter }
  const boot = (): Interpreter => {
    const machine = new Interpreter(options)
    machine.setRewind((back) => {
      const events = machine.rewindLog(back)
      const next = boot()
      holder.machine = next
      next.beginReplay()
      for (const batch of events) {
        next.queueReplay(batch.repl)
        next.frame(batch.events)
      }
      next.endReplay(events)
      next.markRewound()
    })
    try {
      const running = machine.run(program)
      let step = running.next()
      while (!step.done) step = running.next()
    } catch (error) {
      machine.publish()
      if (error instanceof SourceError) throw presentError(error, source)
      throw error
    }
    return machine
  }
  holder.machine = boot()
  return {
    hasHandlers: () => holder.machine.handlerCount() > 0,
    get: (name) => holder.machine.read(name),
    frame: (events) => holder.machine.frame(events),
    eval: (source) => holder.machine.evalSnippet(source),
    rewound: () => holder.machine.consumeRewound(),
  }
}

export function* debug(source: string, options: InterpretOptions = {}): Generator<DebugPause, Value, void> {
  let program: Program
  try {
    program = parse(source)
  } catch (error) {
    if (error instanceof SourceError) throw presentError(error, source)
    throw error
  }
  const machine = new Interpreter(options)
  try {
    return yield* machine.run(program)
  } catch (error) {
    machine.publish()
    if (error instanceof SourceError) throw presentError(error, source)
    throw error
  }
}

export class Environment {
  private readonly values = new Map<string, Value>()
  /** Slot storage for the VM. The map stays the source of names for the inspector. */
  private readonly locals: Value[] = []
  private readonly localReady: boolean[] = []
  /** Which slot a name was cached in, so a restored binding updates that slot. */
  private readonly slots = new Map<string, number>()

  constructor(
    readonly parent: Environment | null = null,
    readonly label = 'block',
  ) {}

  define(name: string, value: Value, at: SourceLocation, slot?: number): void {
    if (this.values.has(name)) {
      throw new RuntimeError('E0201', `'${name}' is already defined in this scope`, at.line, at.column)
    }
    this.values.set(name, value)
    if (slot !== undefined) this.putLocal(slot, name, value)
    else this.syncSlot(name, value)
  }

  /** Change an existing name, walking outward. Does not create a binding. */
  assign(name: string, value: Value, at: SourceLocation): void {
    if (this.values.has(name)) {
      this.values.set(name, value)
      this.syncSlot(name, value)
      return
    }
    if (this.parent) {
      this.parent.assign(name, value, at)
      return
    }
    throw undefinedName(name, at, this.boundNames())
  }

  /** Read a slot, filling it from the name map after a snapshot restore. */
  readLocal(slot: number, name: string, at: SourceLocation): Value {
    if (this.localReady[slot]) return this.locals[slot] as Value
    if (this.values.has(name)) {
      const value = this.values.get(name) as Value
      this.putLocal(slot, name, value)
      return value
    }
    throw undefinedName(name, at, this.boundNames())
  }

  /** Write a slot the compiler already resolved to this environment. */
  writeLocal(slot: number, name: string, value: Value, at: SourceLocation): void {
    if (!this.localReady[slot] && !this.values.has(name)) {
      throw undefinedName(name, at, this.boundNames())
    }
    this.putLocal(slot, name, value)
    this.values.set(name, value)
  }

  private syncSlot(name: string, value: Value): void {
    const slot = this.slots.get(name)
    if (slot !== undefined) this.putLocal(slot, name, value)
  }

  private putLocal(slot: number, name: string, value: Value): void {
    this.locals[slot] = value
    this.localReady[slot] = true
    this.slots.set(name, slot)
  }

  get(name: string, at: SourceLocation): Value {
    if (this.values.has(name)) return this.values.get(name) as Value
    if (this.parent) return this.parent.get(name, at)
    throw undefinedName(name, at, this.boundNames())
  }

  /** This environment, then its parent, then the one outside that. */
  chain(): Environment[] {
    const found: Environment[] = []
    let current: Environment | null = this
    while (current) {
      found.push(current)
      current = current.parent
    }
    return found
  }

  entries(): [string, Value][] {
    return [...this.values]
  }

  boundNames(): string[] {
    const names: string[] = []
    for (const env of this.chain()) {
      for (const [name, value] of env.entries()) {
        if (!isBuiltin(value) && !name.startsWith('$')) names.push(name)
      }
    }
    return names
  }
}

interface Handler {
  event: 'start' | 'tick' | 'key' | 'key_up'
  key: string | null
  at: SourceLocation
  fn: FunctionValue
}

interface TouchRule {
  left: string
  right: string
  at: SourceLocation
  fn: FunctionValue
}

/** Thrown only to unwind `return`. The interpreter catches it at the function call. */
class ReturnSignal {
  constructor(readonly value: Value) {}
}

class Interpreter {
  private readonly maxSteps: number
  private readonly maxCallDepth: number
  private readonly globals: Environment
  private readonly stats: ExecutionStats | undefined
  private env: Environment
  private steps = 0
  private callDepth = 0
  private peakDepth = 0
  private result: Value = null
  private readonly stack: StackFrame[] = []
  private readonly modules: Host['modules']
  private readonly handlers: Handler[] = []
  private readonly rules: TouchRule[] = []
  private readonly world = new World()
  private started = false
  private readonly tasks: LiveTask[] = []
  private ticks = 0
  private inTask = false
  private taskBaseDepth = 0
  private log: FrameTape[] = []
  private pending: string[] = []
  private carry: string[] | null = null
  private replaying = false
  private requested: number | null = null
  private justRewound = false
  private onRewind: ((back: number) => void) | null = null

  constructor(options: InterpretOptions) {
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS
    this.maxCallDepth = options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH
    this.stats = options.stats
    this.globals = new Environment(null, 'global')
    this.modules = options.modules ?? {}
    const random = options.seed === undefined ? Math.random : mulberry32(options.seed)
    const builtins = { ...mathBuiltins(random), ...collectionBuiltins(), ...vecBuiltins(), ...options.builtins }
    for (const [name, call] of Object.entries(builtins)) {
      this.globals.define(name, { type: 'builtin', name, call }, { line: 1, column: 1 })
    }
    this.env = this.globals
  }

  handlerCount(): number {
    return this.handlers.length + this.tasks.length
  }

  read(name: string): Value {
    return this.globals.get(name, { line: 1, column: 1 })
  }

  private combine(op: '+' | '-' | '*', left: Value, right: Value, at: SourceLocation): Value {
    const applied = applyOp(op, left, right)
    if (applied.status === 'fail') throw new RuntimeError(applied.code, applied.detail, at.line, at.column)
    if (applied.status === 'value') return applied.value as Value
    throw new RuntimeError('E0212', `'${op}=' expects numbers, quantities, or vecs`, at.line, at.column)
  }

  setRewind(fn: (back: number) => void): void {
    this.onRewind = fn
  }

  rewindLog(back: number): FrameTape[] {
    const keep = Math.max(0, this.log.length - 1 - back)
    return this.log.slice(0, keep)
  }

  queueReplay(repl: string[]): void {
    this.carry = repl
  }

  beginReplay(): void {
    this.replaying = true
    this.log = []
  }

  endReplay(events: FrameTape[]): void {
    this.replaying = false
    this.log = events
  }

  markRewound(): void {
    this.justRewound = true
  }

  consumeRewound(): boolean {
    const flag = this.justRewound
    this.justRewound = false
    return flag
  }

  /** Run statements against the live game. A rewind inside the snippet restores the past. */
  evalSnippet(source: string): Value {
    let program: Program
    try {
      program = parse(source)
    } catch (error) {
      if (error instanceof SourceError) throw presentError(error, source)
      throw error
    }
    const running = this.onlyPauses(this.playSnippet(program))
    let step = running.next()
    try {
      while (!step.done) step = running.next()
    } catch (error) {
      if (error === REWIND) {
        const back = this.requested
        this.requested = null
        if (!this.replaying && this.onRewind && back !== null) this.onRewind(back)
        return null
      }
      if (error instanceof SourceError) throw presentError(error, source)
      throw error
    }
    if (this.requested !== null) {
      const back = this.requested
      this.requested = null
      if (!this.replaying && this.onRewind) this.onRewind(back)
      return null
    }
    if (!this.replaying) this.pending.push(source)
    const showed = program.body.some((statement) => statement.type === 'ExprStmt')
    return showed ? step.value : null
  }

  private *playSnippet(program: Program): Generator<Step, Value, void> {
    for (const statement of program.body) yield* this.execute(statement)
    this.publish()
    return this.result
  }

  frame(events: KeyEvent[]): void {
    const repl = this.replaying ? (this.carry ?? []) : this.pending.splice(0)
    this.carry = null
    if (!this.replaying) this.log.push({ events, repl })
    if (this.replaying) {
      for (const snippet of repl) this.evalSnippet(snippet)
    }
    try {
      this.stepFrame(events)
    } catch (error) {
      if (error !== REWIND) throw error
    }
    if (this.requested === null) return
    const back = this.requested
    this.requested = null
    if (this.replaying || !this.onRewind) return
    this.onRewind(back)
  }

  private stepFrame(events: KeyEvent[]): void {
    this.steps = 0
    if (!this.started) {
      this.started = true
      this.dispatch('start', null, null)
    }
    this.drain(this.launchIdle())
    this.ticks += 1
    this.drain(this.resumeTasks((task) => task.mode === 'time' && task.wake <= this.ticks))
    this.dispatch('tick', quantity(TICK_DT.value, TICK_DT.unit), null)
    this.drain(this.resumeTasks((task) => task.mode === 'until'))
    for (const event of events) this.dispatch(event.type, null, event.key)
    this.drain(this.resolveTouches())
  }

  private drain(running: Generator<Step, void, void>): void {
    let step = running.next()
    while (!step.done) {
      if (isSuspend(step.value)) throw new RuntimeError('E0901', 'wait is only allowed inside a task', 1, 1)
      step = running.next()
    }
  }

  private dispatch(event: Handler['event'], arg: Value | null, key: string | null): void {
    for (const handler of this.handlers) {
      if (handler.event !== event) continue
      if (handler.key !== null && handler.key !== key) continue
      const label: Expr = {
        type: 'VariableExpr',
        name: handler.fn.name,
        line: handler.at.line,
        column: handler.at.column,
      }
      const running = this.invoke(handler.fn, arg === null ? [] : [arg], handler.at, label)
      let step = running.next()
      while (!step.done) step = running.next()
    }
  }

  private *resolveTouches(): Generator<Step, void, void> {
    for (const rule of this.rules) {
      for (const [left, right] of touchingPairs(this.world, rule.left, rule.right, rule.at)) {
        if (!left.alive || !right.alive) continue
        const label: Expr = { type: 'VariableExpr', name: 'touches', line: rule.at.line, column: rule.at.column }
        const running = this.invoke(rule.fn, [left, right], rule.at, label)
        let step = running.next()
        while (!step.done) step = running.next()
      }
    }
  }

  publish(): void {
    if (!this.stats) return
    this.stats.steps = this.steps
    this.stats.maxCallDepth = this.peakDepth
  }

  *run(program: Program): Generator<DebugPause, Value, void> {
    return yield* this.onlyPauses(this.play(program))
  }

  private *play(program: Program): Generator<Step, Value, void> {
    for (const statement of program.body) yield* this.execute(statement)
    yield* this.resolveTouches()
    yield* this.launchIdle()
    this.publish()
    return this.result
  }

  private *onlyPauses(running: Generator<Step, Value, void>): Generator<DebugPause, Value, void> {
    let step = running.next()
    while (!step.done) {
      if (isSuspend(step.value)) throw new RuntimeError('E0901', 'wait is only allowed inside a task', 1, 1)
      yield step.value
      step = running.next()
    }
    return step.value
  }

  private *launchIdle(): Generator<Step, void, void> {
    for (const task of this.tasks) {
      if (task.started) continue
      task.started = true
      yield* this.pump(task)
    }
  }

  private *resumeTasks(ready: (task: LiveTask) => boolean): Generator<Step, void, void> {
    for (const task of this.tasks) {
      if (!ready(task)) continue
      yield* this.pump(task)
    }
  }

  /** Run a task until it waits or finishes. The generator stays alive across frames. */
  private *pump(task: LiveTask): Generator<Step, void, void> {
    if (task.mode === 'done') return
    const outer = this.env
    if (!task.gen) task.gen = task.start()
    else if (task.savedEnv) this.env = task.savedEnv
    const was = this.inTask
    this.inTask = true
    this.taskBaseDepth = this.callDepth
    try {
      let step = task.gen.next()
      while (!step.done) {
        if (isSuspend(step.value)) {
          task.mode = step.value.suspend
          task.wake = step.value.wake
          task.savedEnv = this.env
          this.env = outer
          return
        }
        yield step.value
        step = task.gen.next()
      }
      task.mode = 'done'
      task.gen = null
    } finally {
      this.inTask = was
    }
  }

  private *taskScript(name: string, closure: Environment, statements: Stmt[]): Generator<Step, void, void> {
    const outer = this.env
    this.env = new Environment(closure, name)
    try {
      for (const statement of statements) yield* this.execute(statement)
    } finally {
      this.env = outer
    }
  }

  private *everyScript(closure: Environment, interval: Expr, body: BlockStmt): Generator<Step, void, void> {
    const outer = this.env
    this.env = new Environment(closure, 'every')
    try {
      for (;;) {
        const wake = this.ticks + ticksFor(yield* this.evaluate(interval), interval)
        yield { suspend: 'time', wake }
        yield* this.executeBlock(body)
      }
    } finally {
      this.env = outer
    }
  }

  private *afterScript(closure: Environment, delay: Expr, body: BlockStmt): Generator<Step, void, void> {
    const outer = this.env
    this.env = new Environment(closure, 'after')
    try {
      const wake = this.ticks + ticksFor(yield* this.evaluate(delay), delay)
      yield { suspend: 'time', wake }
      yield* this.executeBlock(body)
    } finally {
      this.env = outer
    }
  }

  /** Run one statement. Each visit counts as a step, including each loop iteration. */
  private *execute(statement: Stmt): Generator<Step, void, void> {
    switch (statement.type) {
      case 'LetStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        this.env.define(statement.name, yield* this.evaluate(statement.value), statement)
        return
      }
      case 'AssignStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        const value = statement.op
          ? this.combine(statement.op, this.env.get(statement.name, statement), yield* this.evaluate(statement.value), statement)
          : yield* this.evaluate(statement.value)
        this.env.assign(statement.name, value, statement)
        return
      }
      case 'ExprStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        this.result = yield* this.evaluate(statement.expression)
        return
      }
      case 'IfStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        const condition = this.expectBoolean(yield* this.evaluate(statement.condition), statement.condition)
        if (condition) yield* this.executeBlock(statement.thenBranch)
        else if (statement.elseBranch) yield* this.executeBlock(statement.elseBranch)
        return
      }
      case 'WhileStmt': {
        for (;;) {
          yield this.pauseAt(statement)
          this.guardStep(statement)
          const condition = this.expectBoolean(yield* this.evaluate(statement.condition), statement.condition)
          if (!condition) return
          yield* this.executeBlock(statement.body)
        }
      }
      case 'IndexAssignStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        const target = yield* this.evaluate(statement.object)
        const index = yield* this.evaluate(statement.index)
        const value = statement.op
          ? this.combine(statement.op, this.readIndex(target, index, statement), yield* this.evaluate(statement.value), statement)
          : yield* this.evaluate(statement.value)
        this.writeIndex(target, index, value, statement)
        return
      }
      case 'RecordStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        const type: RecordTypeValue = { type: 'recordType', name: statement.name, fields: [...statement.fields] }
        this.env.define(statement.name, type, statement)
        return
      }
      case 'UseStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        this.env.define(statement.name, bindModule(this.modules, statement.name, statement), statement)
        return
      }
      case 'EntityStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        const type: EntityTypeValue = { type: 'entityType', name: statement.name, fields: [...statement.fields] }
        this.env.define(statement.name, type, statement)
        return
      }
      case 'DespawnStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        this.world.despawn(yield* this.evaluate(statement.entity), statement)
        return
      }
      case 'EachStmt': {
        yield this.pauseAt(statement)
        const type = this.env.get(statement.typeName, statement)
        if (!isEntityType(type)) {
          throw new RuntimeError('E0805', `Expected an entity type, but got ${describeValue(type)}`, statement.line, statement.column)
        }
        const items = this.world.ofType(type.name)
        for (const entity of items) {
          this.guardStep(statement)
          if (!entity.alive) continue
          const iteration = new Environment(this.env, 'each')
          iteration.define(statement.name, entity, statement)
          const previous = this.env
          this.env = iteration
          try {
            const condition = statement.where
              ? this.expectBoolean(yield* this.evaluate(statement.where), statement.where)
              : true
            if (condition) yield* this.executeBlock(statement.body)
          } finally {
            this.env = previous
          }
        }
        return
      }
      case 'WhenStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        const left = this.env.get(statement.leftType, statement)
        const right = this.env.get(statement.rightType, statement)
        if (!isEntityType(left) || !isEntityType(right)) {
          const bad = isEntityType(left) ? right : left
          throw new RuntimeError('E0805', `Expected an entity type, but got ${describeValue(bad)}`, statement.line, statement.column)
        }
        this.rules.push({
          left: left.name,
          right: right.name,
          at: statement,
          fn: {
            type: 'function',
            name: 'touches',
            params: [
              { name: statement.left, line: statement.line, column: statement.column },
              { name: statement.right, line: statement.line, column: statement.column },
            ],
            body: statement.body,
            chunk: null,
            closure: this.env,
          },
        })
        return
      }
      case 'OnStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        const params = statement.param
          ? [{ name: statement.param, line: statement.line, column: statement.column }]
          : []
        this.handlers.push({
          event: statement.event,
          key: statement.key,
          at: statement,
          fn: {
            type: 'function',
            name: statement.event,
            params,
            body: statement.body,
            chunk: null,
            closure: this.env,
          },
        })
        return
      }
      case 'TaskStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        const closure = this.env
        const { name, body } = statement
        this.tasks.push({
          started: false,
          mode: 'idle',
          wake: 0,
          savedEnv: null,
          gen: null,
          start: () => this.taskScript(name, closure, body.statements),
        })
        return
      }
      case 'EveryStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        const closure = this.env
        const { interval, body } = statement
        this.tasks.push({
          started: false,
          mode: 'idle',
          wake: 0,
          savedEnv: null,
          gen: null,
          start: () => this.everyScript(closure, interval, body),
        })
        return
      }
      case 'AfterStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        const closure = this.env
        const { delay, body } = statement
        this.tasks.push({
          started: false,
          mode: 'idle',
          wake: 0,
          savedEnv: null,
          gen: null,
          start: () => this.afterScript(closure, delay, body),
        })
        return
      }
      case 'WaitStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        if (!this.inTask || this.callDepth !== this.taskBaseDepth) {
          throw new RuntimeError('E0901', 'wait is only allowed inside a task', statement.line, statement.column)
        }
        if (statement.condition) {
          for (;;) {
            const ready = this.expectBoolean(yield* this.evaluate(statement.condition), statement.condition)
            if (ready) return
            yield { suspend: 'until', wake: 0 }
          }
        }
        const wake = this.ticks + ticksFor(yield* this.evaluate(statement.time as Expr), statement.time as Expr)
        yield { suspend: 'time', wake }
        return
      }
      case 'FieldAssignStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        const target = yield* this.evaluate(statement.object)
        let current: Value | null = null
        if (statement.op) {
          const field = getField(target, statement.name)
          if (field.status === 'fail') {
            throw new RuntimeError(field.code, field.detail, statement.nameLine, statement.nameColumn)
          }
          current = field.value as Value
        }
        const next = yield* this.evaluate(statement.value)
        const value = statement.op ? this.combine(statement.op, current as Value, next, statement) : next
        const stored = setField(target, statement.name, value)
        if (stored.status === 'fail') {
          throw new RuntimeError(stored.code, stored.detail, statement.nameLine, statement.nameColumn)
        }
        return
      }
      case 'RewindStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        if (!this.onRewind) {
          throw new RuntimeError('E0904', 'rewind is only available while a game is running', statement.line, statement.column)
        }
        this.requested = ticksFor(yield* this.evaluate(statement.time), statement, 'rewind')
        throw REWIND
      }
      case 'ForInStmt': {
        const control = new Environment(this.env, 'for')
        const previous = this.env
        this.env = control
        let ready = false
        let items: Value[] = []
        let index = 0
        try {
          for (;;) {
            yield this.pauseAt(statement)
            this.guardStep(statement)
            if (!ready) {
              const collection = yield* this.evaluate(statement.collection)
              const listed = collectionItems(collection)
              if (!listed) {
                throw new RuntimeError(
                  'E0225',
                  `Expected a collection, but got ${describeValue(collection)}`,
                  statement.collection.line,
                  statement.collection.column,
                )
              }
              items = listed as Value[]
              ready = true
            }
            if (index >= items.length) return
            const iteration = new Environment(control, 'for')
            iteration.define(statement.name, items[index], statement)
            this.env = iteration
            try {
              yield* this.executeBlock(statement.body)
            } finally {
              this.env = control
            }
            index++
          }
        } finally {
          this.env = previous
        }
        return
      }
      case 'ForStmt': {
        const control = new Environment(this.env, 'for')
        const previous = this.env
        this.env = control
        let ready = false
        let cursor = 0
        let end = 0
        try {
          for (;;) {
            yield this.pauseAt(statement)
            this.guardStep(statement)
            if (!ready) {
              cursor = this.expectWholeNumber(yield* this.evaluate(statement.start), statement.start)
              end = this.expectWholeNumber(yield* this.evaluate(statement.end), statement.end)
              ready = true
            }
            if (cursor >= end) return
            const iteration = new Environment(control, 'for')
            iteration.define(statement.name, cursor, statement)
            this.env = iteration
            try {
              yield* this.executeBlock(statement.body)
            } finally {
              this.env = control
            }
            cursor++
          }
        } finally {
          this.env = previous
        }
        return
      }
      case 'RepeatStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        const count = this.expectWholeNumber(yield* this.evaluate(statement.count), statement.count)
        if (count < 0) {
          throw new RuntimeError(
            'E0211',
            'repeat count cannot be negative',
            statement.count.line,
            statement.count.column,
          )
        }
        for (let i = 0; i < count; i++) {
          if (i > 0) {
            yield this.pauseAt(statement)
            this.guardStep(statement)
          }
          yield* this.executeBlock(statement.body)
        }
        return
      }
      case 'FnStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        // The closure is this environment. The name is stored in it before
        // the function ever runs, so the body can call itself.
        const value: FunctionValue = {
          type: 'function',
          name: statement.name,
          params: statement.params,
          body: statement.body,
          chunk: null,
          closure: this.env,
        }
        this.env.define(statement.name, value, statement)
        return
      }
      case 'ReturnStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        const value = statement.value ? yield* this.evaluate(statement.value) : null
        throw new ReturnSignal(value)
      }
    }
  }

  /** A fresh child environment, so `let` inside a block does not leak out. */
  private *executeBlock(block: BlockStmt, label = 'block'): Generator<Step, void, void> {
    const previous = this.env
    this.env = new Environment(previous, label)
    try {
      for (const statement of block.statements) yield* this.execute(statement)
    } finally {
      this.env = previous
    }
  }

  private *evaluate(expr: Expr): Generator<Step, Value, void> {
    switch (expr.type) {
      case 'LiteralExpr':
        return expr.value
      case 'VariableExpr':
        return this.env.get(expr.name, expr)
      case 'ArrayExpr': {
        const items: Value[] = []
        for (const element of expr.elements) items.push(yield* this.evaluate(element))
        return { type: 'array', items }
      }
      case 'IndexExpr': {
        const target = yield* this.evaluate(expr.object)
        const index = yield* this.evaluate(expr.index)
        return this.readIndex(target, index, expr)
      }
      case 'FnExpr':
        return {
          type: 'function',
          name: '(anonymous)',
          params: expr.params,
          body: expr.body,
          chunk: null,
          closure: this.env,
        }
      case 'FieldExpr': {
        const target = yield* this.evaluate(expr.object)
        if (isEntityType(target) && expr.name === 'count') return this.world.ofType(target.name).length
        const field = getField(target, expr.name)
        if (field.status === 'fail') throw new RuntimeError(field.code, field.detail, expr.nameLine, expr.nameColumn)
        return field.value as Value
      }
      case 'MapExpr': {
        const map: MapValue = { type: 'map', entries: [] }
        for (const entry of expr.entries) mapSet(map, entry.key, yield* this.evaluate(entry.value))
        return map
      }
      case 'SpawnExpr': {
        const type = this.env.get(expr.name, expr)
        if (!isEntityType(type)) {
          throw new RuntimeError('E0805', `Expected an entity type, but got ${describeValue(type)}`, expr.line, expr.column)
        }
        const x = yield* this.evaluate(expr.x)
        const y = yield* this.evaluate(expr.y)
        const pairs: { name: string; value: Value }[] = []
        for (const field of expr.fields) pairs.push({ name: field.name, value: yield* this.evaluate(field.value) })
        return this.world.spawn(type, x, y, pairs, expr)
      }
      case 'RecordExpr': {
        const type = this.env.get(expr.name, expr)
        const pairs: { name: string; value: unknown }[] = []
        for (const field of expr.fields) pairs.push({ name: field.name, value: yield* this.evaluate(field.value) })
        const made = makeRecord(type, pairs)
        if (made.status === 'fail') throw new RuntimeError(made.code, made.detail, expr.line, expr.column)
        return made.value as Value
      }
      case 'InterpExpr': {
        let text = ''
        for (const part of expr.parts) {
          text += part.type === 'text' ? part.text : textValue(yield* this.evaluate(part.expr))
        }
        return text
      }
      case 'MatchExpr':
        return yield* this.evaluateMatch(expr)
      case 'UnaryExpr': {
        const value = yield* this.evaluate(expr.operand)
        if (expr.operator === '-') {
          const negated = negate(value)
          if (negated.status === 'value') return negated.value
          return -this.expectNumber(value, expr.operand)
        }
        return !this.expectBoolean(value, expr.operand)
      }
      case 'BinaryExpr':
        return yield* this.evaluateBinary(expr)
      case 'CallExpr':
        return yield* this.call(expr)
    }
  }

  private *evaluateMatch(expr: Extract<Expr, { type: 'MatchExpr' }>): Generator<Step, Value, void> {
    const subject = yield* this.evaluate(expr.scrutinee)
    for (const arm of expr.arms) {
      const bindings = matchPattern(subject, arm.pattern)
      if (!bindings) continue
      const previous = this.env
      this.env = new Environment(previous, 'match')
      try {
        for (const binding of bindings) {
          this.env.define(binding.name, binding.value as Value, binding)
        }
        return yield* this.evaluate(arm.body)
      } finally {
        this.env = previous
      }
    }
    throw new RuntimeError('E0224', 'No pattern matched', expr.line, expr.column)
  }

  /**
   * `and` and `or` stop early. The right-hand side is not evaluated unless
   * it is needed, so `1 == 0 and (1 / 0)` does not divide by zero.
   */
  private *evaluateBinary(expr: Extract<Expr, { type: 'BinaryExpr' }>): Generator<Step, Value, void> {
    if (expr.operator === 'and' || expr.operator === 'or') {
      const left = this.expectBoolean(yield* this.evaluate(expr.left), expr.left)
      if (expr.operator === 'and') {
        if (!left) return false
        return this.expectBoolean(yield* this.evaluate(expr.right), expr.right)
      }
      if (left) return true
      return this.expectBoolean(yield* this.evaluate(expr.right), expr.right)
    }

    if (expr.operator === '|>') return yield* this.pipe(expr)

    const left = yield* this.evaluate(expr.left)
    const right = yield* this.evaluate(expr.right)

    if (expr.operator === '==') return valuesEqual(left, right)
    if (expr.operator === '!=') return !valuesEqual(left, right)
    if (expr.operator === '+') return this.add(left, right, expr)

    if (expr.operator !== '%') {
      const applied = applyOp(expr.operator, left, right)
      if (applied.status === 'fail') throw new RuntimeError(applied.code, applied.detail, expr.line, expr.column)
      if (applied.status === 'value') return applied.value
    }

    const leftNumber = this.expectNumber(left, expr.left)
    const rightNumber = this.expectNumber(right, expr.right)
    switch (expr.operator) {
      case '-':
        return leftNumber - rightNumber
      case '*':
        return leftNumber * rightNumber
      case '/':
        if (rightNumber === 0) throw new RuntimeError('E0203', 'Division by zero', expr.line, expr.column)
        return leftNumber / rightNumber
      case '%':
        if (rightNumber === 0) throw new RuntimeError('E0203', 'Division by zero', expr.line, expr.column)
        return leftNumber % rightNumber
      case '<':
        return leftNumber < rightNumber
      case '>':
        return leftNumber > rightNumber
      case '<=':
        return leftNumber <= rightNumber
      case '>=':
        return leftNumber >= rightNumber
      default:
        return leftNumber
    }
  }

  /** `value |> f` calls `f(value)`. `value |> f(a)` calls `f(value, a)`. */
  private *pipe(expr: Extract<Expr, { type: 'BinaryExpr' }>): Generator<Step, Value, void> {
    const left = yield* this.evaluate(expr.left)
    if (expr.right.type === 'CallExpr') {
      const callee = yield* this.evaluate(expr.right.callee)
      const args = [left]
      for (const arg of expr.right.args) args.push(yield* this.evaluate(arg))
      return yield* this.invoke(callee, args, expr, expr.right.callee)
    }
    const callee = yield* this.evaluate(expr.right)
    return yield* this.invoke(callee, [left], expr, expr.right)
  }

  private *call(expr: CallExpr): Generator<Step, Value, void> {
    const callee = yield* this.evaluate(expr.callee)
    const args: Value[] = []
    for (const arg of expr.args) args.push(yield* this.evaluate(arg))
    return yield* this.invoke(callee, args, expr, expr.callee)
  }

  private *invoke(
    callee: Value,
    args: Value[],
    at: SourceLocation,
    labelExpr: Expr,
  ): Generator<Step, Value, void> {
    if (isBuiltin(callee)) return callee.call(args, at)
    if (!isFunction(callee) || callee.body === null) {
      const label = labelExpr.type === 'VariableExpr' ? `'${labelExpr.name}'` : 'That value'
      throw new RuntimeError('E0204', `${label} is not a function`, at.line, at.column)
    }
    if (args.length !== callee.params.length) {
      const expected = callee.params.length
      throw new RuntimeError(
        'E0205',
        `'${callee.name}' expects ${expected} argument${expected === 1 ? '' : 's'}, got ${args.length}`,
        at.line,
        at.column,
      )
    }
    if (this.callDepth >= this.maxCallDepth) {
      throw new RuntimeError(
        'E0206',
        `Call depth limit of ${this.maxCallDepth} exceeded (possible infinite recursion)`,
        at.line,
        at.column,
      )
    }

    const previous = this.env
    this.env = new Environment(callee.closure, callee.name)
    for (let i = 0; i < callee.params.length; i++) {
      this.env.define(callee.params[i].name, args[i], callee.params[i])
    }
    this.callDepth++
    this.peakDepth = Math.max(this.peakDepth, this.callDepth)
    this.stack.push({ name: callee.name, line: at.line, column: at.column })
    try {
      for (const statement of callee.body.statements) yield* this.execute(statement)
      return null
    } catch (error) {
      if (error instanceof ReturnSignal) return error.value
      throw error
    } finally {
      this.stack.pop()
      this.env = previous
      this.callDepth--
    }
  }

  private pauseAt(at: SourceLocation): DebugPause {
    this.publish()
    return {
      line: at.line,
      column: at.column,
      scopes: this.env.chain().map((env) => ({
        label: env.label,
        bindings: env
          .entries()
          .filter(([name, value]) => !isBuiltin(value) && !name.startsWith('$'))
          .map(([name, value]) => ({ name, value: formatValue(value) })),
      }))
      .filter((scope) => scope.bindings.length > 0 || scope.label === 'global' || scope.label === 'function' || !['for', 'repeat', 'block', 'match'].includes(scope.label)),
      entities: this.world.entities.map((entity) => ({
        name: entity.name,
        id: entity.id,
        fields: Object.entries(entity.fields).map(([name, value]) => ({ name, value: formatValue(value as Value) })),
      })),
      stack: this.stack.map((frame) => ({ ...frame })),
      steps: this.steps,
      maxCallDepth: this.peakDepth,
      ip: -1,
      chunk: '',
    }
  }

  private readIndex(target: Value, index: Value, at: SourceLocation): Value {
    if (isMap(target)) {
      if (typeof index !== 'string') {
        throw new RuntimeError('E0220', `Expected a string key, but got ${describeValue(index)}`, at.line, at.column)
      }
      const found = mapGet(target, index)
      if (found === undefined && !target.entries.some((entry) => entry.key === index)) {
        throw new RuntimeError('E0221', `Map has no key '${index}'`, at.line, at.column)
      }
      return found as Value
    }
    const array = this.expectArray(target, at)
    const atIndex = this.expectIndex(index, array.items.length, at)
    return array.items[atIndex]
  }

  private writeIndex(target: Value, index: Value, value: Value, at: SourceLocation): void {
    if (isMap(target)) {
      if (typeof index !== 'string') {
        throw new RuntimeError('E0220', `Expected a string key, but got ${describeValue(index)}`, at.line, at.column)
      }
      mapSet(target, index, value)
      return
    }
    const array = this.expectArray(target, at)
    const atIndex = this.expectIndex(index, array.items.length, at)
    array.items[atIndex] = value
  }

  private expectArray(value: Value, at: SourceLocation): ArrayValue {
    if (!isArray(value)) {
      throw new RuntimeError('E0213', `Expected an array, but got ${describeValue(value)}`, at.line, at.column)
    }
    return value
  }

  private expectIndex(value: Value, length: number, at: SourceLocation): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new RuntimeError('E0214', `Expected a whole number index, but got ${describeValue(value)}`, at.line, at.column)
    }
    if (value < 0 || value >= length) {
      throw new RuntimeError('E0215', `Index ${value} is out of range for an array of length ${length}`, at.line, at.column)
    }
    return value
  }

  private add(left: Value, right: Value, expr: Extract<Expr, { type: 'BinaryExpr' }>): Value {
    if (typeof left === 'string' || typeof right === 'string') {
      if (typeof left !== 'string' || typeof right !== 'string') {
        throw new RuntimeError('E0212', "'+' expects two numbers or two strings", expr.line, expr.column)
      }
      return left + right
    }
    const applied = applyOp('+', left, right)
    if (applied.status === 'fail') throw new RuntimeError(applied.code, applied.detail, expr.line, expr.column)
    if (applied.status === 'value') return applied.value
    return this.expectNumber(left, expr.left) + this.expectNumber(right, expr.right)
  }

  private guardStep(at: SourceLocation): void {
    this.steps++
    this.publish()
    if (this.steps > this.maxSteps) {
      throw new RuntimeError(
        'E0207',
        `Step limit of ${this.maxSteps} exceeded (possible infinite loop)`,
        at.line,
        at.column,
      )
    }
  }

  private expectBoolean(value: Value, at: SourceLocation): boolean {
    if (typeof value !== 'boolean') {
      throw new RuntimeError('E0208', `Expected a boolean, but got ${describeValue(value)}`, at.line, at.column)
    }
    return value
  }

  private expectNumber(value: Value, at: SourceLocation): number {
    if (typeof value !== 'number') {
      throw new RuntimeError('E0209', `Expected a number, but got ${describeValue(value)}`, at.line, at.column)
    }
    return value
  }

  private expectWholeNumber(value: Value, at: SourceLocation): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new RuntimeError(
        'E0210',
        `Expected a whole number, but got ${describeValue(value)}`,
        at.line,
        at.column,
      )
    }
    return value
  }
}

/**
 * Turn a host module table entry into a value the program can call.
 * `use draw` and `use turtle` take the same path. The name is just a key.
 */
export function bindModule(
  modules: Host['modules'] | undefined,
  name: string,
  at: SourceLocation,
): ModuleValue {
  const table = modules?.[name]
  if (!table) {
    throw new RuntimeError('E0601', `Unknown module '${name}'`, at.line, at.column)
  }
  const fields: Record<string, Value> = {}
  for (const [field, call] of Object.entries(table)) {
    fields[field] = { type: 'builtin', name: `${name}.${field}`, call }
  }
  return { type: 'module', name, fields }
}

function undefinedName(name: string, at: SourceLocation, names: string[]): RuntimeError {
  const hint = suggestName(name, names)
  const detail = hint
    ? `Undefined variable '${name}'. Did you mean '${hint}'?`
    : `Undefined variable '${name}'`
  return new RuntimeError('E0202', detail, at.line, at.column)
}

function valuesEqual(left: Value, right: Value): boolean {
  const data = sameData(left, right)
  if (data !== null) return data
  if (left === null || right === null) return left === right
  if (typeof left !== typeof right) return false
  if (typeof left === 'number' || typeof left === 'string' || typeof left === 'boolean') {
    return left === right
  }
  return left === right
}

function isFunction(value: Value): value is FunctionValue {
  return typeof value === 'object' && value !== null && value.type === 'function'
}

function isBuiltin(value: Value): value is BuiltinValue {
  return typeof value === 'object' && value !== null && value.type === 'builtin'
}

export function describeValue(value: Value): string {
  return valueLabel(value)
}

/** A short label for the variables panel. Strings keep their quotes. */
export function formatValue(value: Value, seen: Set<object> = new Set()): string {
  if (typeof value === 'string') return JSON.stringify(value)
  return textValue(value, seen)
}

/** How interpolation and `print` show a value. Strings are not quoted. */
export function textValue(value: Value, seen: Set<object> = new Set()): string {
  if (value === null) return 'nothing'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (isQuantity(value)) return formatQuantity(value)
  if (isVec(value)) return `vec(${textValue(value.x, seen)}, ${textValue(value.y, seen)})`
  if (isMap(value)) {
    if (seen.has(value)) return '{...}'
    seen.add(value)
    return `{${value.entries.map((entry) => `${entry.key}: ${textValue(entry.value as Value, seen)}`).join(', ')}}`
  }
  if (isRecord(value)) {
    if (seen.has(value)) return `${value.name} {...}`
    seen.add(value)
    const fields = Object.entries(value.fields)
      .map(([name, field]) => `${name}: ${textValue(field as Value, seen)}`)
      .join(', ')
    return `${value.name} { ${fields} }`
  }
  if (isRecordType(value)) return `record ${value.name}`
  if (isEntityType(value)) return `entity ${value.name}`
  if (value.type === 'entity') {
    const fields = Object.entries(value.fields)
      .map(([name, field]) => `${name}: ${textValue(field as Value, seen)}`)
      .join(', ')
    return `${value.name}#${value.id} { ${fields} }`
  }
  if (value.type === 'module') return `module ${value.name}`
  if (value.type === 'array') {
    if (seen.has(value)) return '[...]'
    seen.add(value)
    return `[${value.items.map((item) => textValue(item, seen)).join(', ')}]`
  }
  if (value.type === 'function') return value.name === '(anonymous)' ? 'function' : `function ${value.name}`
  return `built-in ${value.name}`
}
