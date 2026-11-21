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
  isMap,
  isQuantity,
  isRecord,
  isRecordType,
  isVec,
  makeRecord,
  mapGet,
  mapSet,
  negate,
  sameData,
  setField,
  valueLabel,
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
import type { Host } from './host.ts'
import { parse } from './parser.ts'
import { mulberry32 } from './rng.ts'

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

  constructor(
    readonly parent: Environment | null = null,
    readonly label = 'block',
  ) {}

  define(name: string, value: Value, at: SourceLocation): void {
    if (this.values.has(name)) {
      throw new RuntimeError('E0201', `'${name}' is already defined in this scope`, at.line, at.column)
    }
    this.values.set(name, value)
  }

  /** Change an existing name, walking outward. Does not create a binding. */
  assign(name: string, value: Value, at: SourceLocation): void {
    if (this.values.has(name)) {
      this.values.set(name, value)
      return
    }
    if (this.parent) {
      this.parent.assign(name, value, at)
      return
    }
    throw undefinedName(name, at, this.boundNames())
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

  publish(): void {
    if (!this.stats) return
    this.stats.steps = this.steps
    this.stats.maxCallDepth = this.peakDepth
  }

  *run(program: Program): Generator<DebugPause, Value, void> {
    for (const statement of program.body) yield* this.execute(statement)
    this.publish()
    return this.result
  }

  /** Run one statement. Each visit counts as a step, including each loop iteration. */
  private *execute(statement: Stmt): Generator<DebugPause, void, void> {
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
        this.env.assign(statement.name, yield* this.evaluate(statement.value), statement)
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
        const value = yield* this.evaluate(statement.value)
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
      case 'FieldAssignStmt': {
        yield this.pauseAt(statement)
        this.guardStep(statement)
        const target = yield* this.evaluate(statement.object)
        const value = yield* this.evaluate(statement.value)
        const stored = setField(target, statement.name, value)
        if (stored.status === 'fail') {
          throw new RuntimeError(stored.code, stored.detail, statement.nameLine, statement.nameColumn)
        }
        return
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
  private *executeBlock(block: BlockStmt, label = 'block'): Generator<DebugPause, void, void> {
    const previous = this.env
    this.env = new Environment(previous, label)
    try {
      for (const statement of block.statements) yield* this.execute(statement)
    } finally {
      this.env = previous
    }
  }

  private *evaluate(expr: Expr): Generator<DebugPause, Value, void> {
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
        const field = getField(target, expr.name)
        if (field.status === 'fail') throw new RuntimeError(field.code, field.detail, expr.nameLine, expr.nameColumn)
        return field.value as Value
      }
      case 'MapExpr': {
        const map: MapValue = { type: 'map', entries: [] }
        for (const entry of expr.entries) mapSet(map, entry.key, yield* this.evaluate(entry.value))
        return map
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

  private *evaluateMatch(expr: Extract<Expr, { type: 'MatchExpr' }>): Generator<DebugPause, Value, void> {
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
  private *evaluateBinary(expr: Extract<Expr, { type: 'BinaryExpr' }>): Generator<DebugPause, Value, void> {
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
  private *pipe(expr: Extract<Expr, { type: 'BinaryExpr' }>): Generator<DebugPause, Value, void> {
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

  private *call(expr: CallExpr): Generator<DebugPause, Value, void> {
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
  ): Generator<DebugPause, Value, void> {
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
  if (value.type === 'module') return `module ${value.name}`
  if (value.type === 'array') {
    if (seen.has(value)) return '[...]'
    seen.add(value)
    return `[${value.items.map((item) => textValue(item, seen)).join(', ')}]`
  }
  if (value.type === 'function') return value.name === '(anonymous)' ? 'function' : `function ${value.name}`
  return `built-in ${value.name}`
}
