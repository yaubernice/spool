import type {
  BlockStmt,
  CallExpr,
  Expr,
  Parameter,
  Program,
  SourceLocation,
  Stmt,
} from './ast.ts'
import { presentError, RuntimeError, SourceError } from './errors.ts'
import { parse } from './parser.ts'

/**
 * Interpreter: walk the AST and run it.
 *
 * Values live in an environment. Each block and each function call gets
 * its own environment, linked to the one outside it. Looking up a name
 * walks that chain. `let` always binds in the current environment, so a
 * block can shadow an outer name but cannot change it.
 *
 * `return` is not a value. It is a signal that jumps back to the function
 * that is running. A step limit stops a runaway loop, and a call-depth
 * limit stops runaway recursion.
 *
 * Built-ins such as `forward` are passed in. This file never draws.
 */

export const DEFAULT_MAX_STEPS = 100_000
export const DEFAULT_MAX_CALL_DEPTH = 100

/** A function supplied by the host, for example a turtle command. */
export type HostFunction = (args: Value[]) => Value

export type Value = number | string | boolean | null | FunctionValue | BuiltinValue

export interface InterpretOptions {
  builtins?: Record<string, HostFunction>
  maxSteps?: number
  maxCallDepth?: number
}

interface FunctionValue {
  type: 'function'
  name: string
  params: Parameter[]
  body: BlockStmt
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
  try {
    return new Interpreter(options).run(parse(source))
  } catch (error) {
    if (error instanceof SourceError) throw presentError(error, source)
    throw error
  }
}

class Environment {
  private readonly values = new Map<string, Value>()

  constructor(private readonly parent: Environment | null = null) {}

  define(name: string, value: Value, at: SourceLocation): void {
    if (this.values.has(name)) {
      throw new RuntimeError(`'${name}' is already defined in this scope`, at.line, at.column)
    }
    this.values.set(name, value)
  }

  get(name: string, at: SourceLocation): Value {
    if (this.values.has(name)) return this.values.get(name) as Value
    if (this.parent) return this.parent.get(name, at)
    throw new RuntimeError(`Undefined variable '${name}'`, at.line, at.column)
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
  private env: Environment
  private steps = 0
  private callDepth = 0
  private result: Value = null

  constructor(options: InterpretOptions) {
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS
    this.maxCallDepth = options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH
    this.globals = new Environment()
    for (const [name, call] of Object.entries(options.builtins ?? {})) {
      this.globals.define(name, { type: 'builtin', name, call }, { line: 1, column: 1 })
    }
    this.env = this.globals
  }

  run(program: Program): Value {
    for (const statement of program.body) this.execute(statement)
    return this.result
  }

  /** Run one statement. Each visit counts as a step, including each loop iteration. */
  private execute(statement: Stmt): void {
    switch (statement.type) {
      case 'LetStmt': {
        this.guardStep(statement)
        this.env.define(statement.name, this.evaluate(statement.value), statement)
        return
      }
      case 'ExprStmt': {
        this.guardStep(statement)
        this.result = this.evaluate(statement.expression)
        return
      }
      case 'IfStmt': {
        this.guardStep(statement)
        const condition = this.expectBoolean(this.evaluate(statement.condition), statement.condition)
        if (condition) this.executeBlock(statement.thenBranch)
        else if (statement.elseBranch) this.executeBlock(statement.elseBranch)
        return
      }
      case 'WhileStmt': {
        for (;;) {
          this.guardStep(statement)
          const condition = this.expectBoolean(this.evaluate(statement.condition), statement.condition)
          if (!condition) return
          this.executeBlock(statement.body)
        }
      }
      case 'RepeatStmt': {
        this.guardStep(statement)
        const count = this.expectWholeNumber(this.evaluate(statement.count), statement.count)
        if (count < 0) {
          throw new RuntimeError(
            'repeat count cannot be negative',
            statement.count.line,
            statement.count.column,
          )
        }
        for (let i = 0; i < count; i++) {
          if (i > 0) this.guardStep(statement)
          this.executeBlock(statement.body)
        }
        return
      }
      case 'FnStmt': {
        this.guardStep(statement)
        // The closure is this environment. The name is stored in it before
        // the function ever runs, so the body can call itself.
        const value: FunctionValue = {
          type: 'function',
          name: statement.name,
          params: statement.params,
          body: statement.body,
          closure: this.env,
        }
        this.env.define(statement.name, value, statement)
        return
      }
      case 'ReturnStmt': {
        this.guardStep(statement)
        const value = statement.value ? this.evaluate(statement.value) : null
        throw new ReturnSignal(value)
      }
    }
  }

  /** A fresh child environment, so `let` inside a block does not leak out. */
  private executeBlock(block: BlockStmt): void {
    const previous = this.env
    this.env = new Environment(previous)
    try {
      for (const statement of block.statements) this.execute(statement)
    } finally {
      this.env = previous
    }
  }

  private evaluate(expr: Expr): Value {
    switch (expr.type) {
      case 'LiteralExpr':
        return expr.value
      case 'VariableExpr':
        return this.env.get(expr.name, expr)
      case 'UnaryExpr': {
        const value = this.evaluate(expr.operand)
        if (expr.operator === '-') return -this.expectNumber(value, expr.operand)
        return !this.expectBoolean(value, expr.operand)
      }
      case 'BinaryExpr':
        return this.evaluateBinary(expr)
      case 'CallExpr':
        return this.call(expr)
    }
  }

  /**
   * `and` and `or` stop early. The right-hand side is not evaluated unless
   * it is needed, so `1 == 0 and (1 / 0)` does not divide by zero.
   */
  private evaluateBinary(expr: Extract<Expr, { type: 'BinaryExpr' }>): Value {
    if (expr.operator === 'and' || expr.operator === 'or') {
      const left = this.expectBoolean(this.evaluate(expr.left), expr.left)
      if (expr.operator === 'and') {
        if (!left) return false
        return this.expectBoolean(this.evaluate(expr.right), expr.right)
      }
      if (left) return true
      return this.expectBoolean(this.evaluate(expr.right), expr.right)
    }

    const left = this.evaluate(expr.left)
    const right = this.evaluate(expr.right)

    if (expr.operator === '==') return valuesEqual(left, right)
    if (expr.operator === '!=') return !valuesEqual(left, right)

    const leftNumber = this.expectNumber(left, expr.left)
    const rightNumber = this.expectNumber(right, expr.right)
    switch (expr.operator) {
      case '+':
        return leftNumber + rightNumber
      case '-':
        return leftNumber - rightNumber
      case '*':
        return leftNumber * rightNumber
      case '/':
        if (rightNumber === 0) throw new RuntimeError('Division by zero', expr.line, expr.column)
        return leftNumber / rightNumber
      case '%':
        if (rightNumber === 0) throw new RuntimeError('Division by zero', expr.line, expr.column)
        return leftNumber % rightNumber
      case '<':
        return leftNumber < rightNumber
      case '>':
        return leftNumber > rightNumber
      case '<=':
        return leftNumber <= rightNumber
      case '>=':
        return leftNumber >= rightNumber
    }
  }

  private call(expr: CallExpr): Value {
    const callee = this.env.get(expr.callee, expr)
    const args = expr.args.map((arg) => this.evaluate(arg))

    if (isBuiltin(callee)) return callee.call(args)
    if (!isFunction(callee)) {
      throw new RuntimeError(`'${expr.callee}' is not a function`, expr.line, expr.column)
    }
    if (args.length !== callee.params.length) {
      const expected = callee.params.length
      throw new RuntimeError(
        `'${callee.name}' expects ${expected} argument${expected === 1 ? '' : 's'}, got ${args.length}`,
        expr.line,
        expr.column,
      )
    }
    if (this.callDepth >= this.maxCallDepth) {
      throw new RuntimeError(
        `Call depth limit of ${this.maxCallDepth} exceeded (possible infinite recursion)`,
        expr.line,
        expr.column,
      )
    }

    const previous = this.env
    this.env = new Environment(callee.closure)
    for (let i = 0; i < callee.params.length; i++) {
      this.env.define(callee.params[i].name, args[i], callee.params[i])
    }
    this.callDepth++
    try {
      for (const statement of callee.body.statements) this.execute(statement)
      return null
    } catch (error) {
      if (error instanceof ReturnSignal) return error.value
      throw error
    } finally {
      this.env = previous
      this.callDepth--
    }
  }

  private guardStep(at: SourceLocation): void {
    this.steps++
    if (this.steps > this.maxSteps) {
      throw new RuntimeError(
        `Step limit of ${this.maxSteps} exceeded (possible infinite loop)`,
        at.line,
        at.column,
      )
    }
  }

  private expectBoolean(value: Value, at: SourceLocation): boolean {
    if (typeof value !== 'boolean') {
      throw new RuntimeError(
        `Expected a boolean, but got ${describeValue(value)}`,
        at.line,
        at.column,
      )
    }
    return value
  }

  private expectNumber(value: Value, at: SourceLocation): number {
    if (typeof value !== 'number') {
      throw new RuntimeError(
        `Expected a number, but got ${describeValue(value)}`,
        at.line,
        at.column,
      )
    }
    return value
  }

  private expectWholeNumber(value: Value, at: SourceLocation): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new RuntimeError(
        `Expected a whole number, but got ${describeValue(value)}`,
        at.line,
        at.column,
      )
    }
    return value
  }
}

function valuesEqual(left: Value, right: Value): boolean {
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

function describeValue(value: Value): string {
  if (value === null) return 'nothing'
  if (typeof value === 'number') return 'a number'
  if (typeof value === 'string') return 'a string'
  if (typeof value === 'boolean') return 'a boolean'
  if (value.type === 'function') return `the function ${value.name}`
  return `the built-in ${value.name}`
}
