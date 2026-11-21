import type {
  BlockStmt,
  Expr,
  Parameter,
  Program,
  SourceLocation,
  Stmt,
} from './ast.ts'
import { type Chunk, type Constant, createChunk, type Ins, Op } from './bytecode.ts'

/**
 * Compile an AST into bytecode for the stack VM.
 *
 * Names are resolved when the instruction runs, not here, so a closure
 * still sees the environment it was created in. Each statement starts
 * with PAUSE so the debugger can stop on the same lines as the tree-walker.
 */

export function compile(program: Program): Chunk {
  const compiler = new Compiler('<program>', [])
  compiler.statements(program.body)
  return compiler.chunk
}

class Compiler {
  readonly chunk: Chunk

  constructor(name: string, params: string[]) {
    this.chunk = createChunk(name, params)
  }

  statements(statements: Stmt[]): void {
    for (const statement of statements) this.statement(statement)
  }

  private statement(statement: Stmt): void {
    switch (statement.type) {
      case 'LetStmt':
        this.emit(Op.PAUSE, statement)
        this.expression(statement.value)
        this.emit(Op.DEFINE, statement, this.name(statement.name))
        return
      case 'AssignStmt':
        this.emit(Op.PAUSE, statement)
        this.expression(statement.value)
        this.emit(Op.STORE, statement, this.name(statement.name))
        return
      case 'IndexAssignStmt':
        this.emit(Op.PAUSE, statement)
        this.expression(statement.object)
        this.expression(statement.index)
        this.expression(statement.value)
        this.emit(Op.SET_INDEX, statement)
        return
      case 'ExprStmt':
        this.emit(Op.PAUSE, statement)
        this.expression(statement.expression)
        this.emit(Op.SET_RESULT, statement)
        return
      case 'IfStmt': {
        this.emit(Op.PAUSE, statement)
        this.expression(statement.condition)
        const skipThen = this.emit(Op.JUMP_IF_FALSE, statement.condition)
        this.block(statement.thenBranch)
        if (!statement.elseBranch) {
          this.patch(skipThen)
          return
        }
        const skipElse = this.emit(Op.JUMP, statement)
        this.patch(skipThen)
        this.block(statement.elseBranch)
        this.patch(skipElse)
        return
      }
      case 'WhileStmt': {
        const loop = this.chunk.code.length
        this.emit(Op.PAUSE, statement)
        this.expression(statement.condition)
        const done = this.emit(Op.JUMP_IF_FALSE, statement.condition)
        this.block(statement.body)
        this.emit(Op.JUMP, statement, loop)
        this.patch(done)
        return
      }
      case 'RepeatStmt':
        this.repeat(statement)
        return
      case 'ForStmt':
        this.forLoop(statement)
        return
      case 'ForInStmt':
        this.forIn(statement)
        return
      case 'RecordStmt':
        this.emit(Op.PAUSE, statement)
        for (const field of statement.fields) this.emit(Op.CONST, statement, this.constant(field))
        this.emit(Op.CONST, statement, this.constant(statement.fields.length))
        this.emit(Op.RECORD_TYPE, statement, this.name(statement.name))
        this.emit(Op.DEFINE, statement, this.name(statement.name))
        return
      case 'UseStmt':
        this.emit(Op.PAUSE, statement)
        this.emit(Op.USE_MODULE, statement, this.name(statement.name))
        this.emit(Op.DEFINE, statement, this.name(statement.name))
        return
      case 'OnStmt': {
        this.emit(Op.PAUSE, statement)
        const params: Parameter[] = statement.param
          ? [{ name: statement.param, line: statement.line, column: statement.column }]
          : []
        this.closure(statement.event, params, statement.body, statement)
        this.emit(Op.CONST, statement, this.constant(statement.key ?? ''))
        const event = statement.event === 'start' ? 0 : statement.event === 'tick' ? 1 : statement.event === 'key' ? 2 : 3
        this.emit(Op.REGISTER, statement, event)
        return
      }
      case 'EntityStmt':
        this.emit(Op.PAUSE, statement)
        for (const field of statement.fields) this.emit(Op.CONST, statement, this.constant(field))
        this.emit(Op.CONST, statement, this.constant(statement.fields.length))
        this.emit(Op.ENTITY_TYPE, statement, this.name(statement.name))
        this.emit(Op.DEFINE, statement, this.name(statement.name))
        return
      case 'DespawnStmt':
        this.emit(Op.PAUSE, statement)
        this.expression(statement.entity)
        this.emit(Op.DESPAWN, statement)
        return
      case 'EachStmt':
        this.each(statement)
        return
      case 'WhenStmt': {
        this.emit(Op.PAUSE, statement)
        this.emit(Op.CONST, statement, this.constant(statement.leftType))
        this.emit(Op.CONST, statement, this.constant(statement.rightType))
        const params: Parameter[] = [
          { name: statement.left, line: statement.line, column: statement.column },
          { name: statement.right, line: statement.line, column: statement.column },
        ]
        this.closure('touches', params, statement.body, statement)
        this.emit(Op.TOUCH, statement)
        return
      }
      case 'TaskStmt':
        this.emit(Op.PAUSE, statement)
        this.closure(statement.name, [], statement.body, statement)
        this.emit(Op.TASK, statement)
        return
      case 'WaitStmt': {
        this.emit(Op.PAUSE, statement)
        if (statement.condition) {
          const check = this.chunk.code.length
          this.expression(statement.condition)
          const skip = this.emit(Op.JUMP_IF_TRUE, statement.condition)
          this.emit(Op.WAIT_UNTIL, statement)
          this.emit(Op.JUMP, statement, check)
          this.patch(skip)
          return
        }
        this.expression(statement.time as Expr)
        this.emit(Op.WAIT_TIME, statement)
        return
      }
      case 'EveryStmt': {
        this.emit(Op.PAUSE, statement)
        const child = new Compiler('every', [])
        const loop = child.chunk.code.length
        child.expression(statement.interval)
        child.emit(Op.WAIT_TIME, statement.interval)
        child.block(statement.body)
        child.emit(Op.JUMP, statement, loop)
        this.chunk.functions.push(child.chunk)
        this.emit(Op.CLOSURE, statement, this.chunk.functions.length - 1)
        this.emit(Op.TASK, statement)
        return
      }
      case 'AfterStmt': {
        this.emit(Op.PAUSE, statement)
        const child = new Compiler('after', [])
        child.expression(statement.delay)
        child.emit(Op.WAIT_TIME, statement.delay)
        child.block(statement.body)
        this.chunk.functions.push(child.chunk)
        this.emit(Op.CLOSURE, statement, this.chunk.functions.length - 1)
        this.emit(Op.TASK, statement)
        return
      }
      case 'FieldAssignStmt':
        this.emit(Op.PAUSE, statement)
        this.expression(statement.object)
        this.expression(statement.value)
        this.emit(Op.SET_FIELD, { line: statement.nameLine, column: statement.nameColumn }, this.name(statement.name))
        return
      case 'FnStmt':
        this.emit(Op.PAUSE, statement)
        this.closure(statement.name, statement.params, statement.body, statement)
        this.emit(Op.DEFINE, statement, this.name(statement.name))
        return
      case 'ReturnStmt':
        this.emit(Op.PAUSE, statement)
        if (statement.value) this.expression(statement.value)
        else this.emit(Op.CONST, statement, this.constant(null))
        this.emit(Op.RETURN, statement)
        return
    }
  }

  /**
   * One pause before the count is read, then one more pause before every
   * later iteration. That matches the tree-walker.
   */
  private repeat(statement: Extract<Stmt, { type: 'RepeatStmt' }>): void {
    this.emit(Op.PAUSE, statement)
    this.expression(statement.count)
    this.emit(Op.CHECK_COUNT, statement.count)
    this.emit(Op.PUSH_SCOPE, statement, this.label('repeat'))
    this.emit(Op.DEFINE, statement, this.name('$n'))
    this.emit(Op.CONST, statement, this.constant(0))
    this.emit(Op.DEFINE, statement, this.name('$i'))
    const check = this.emit(Op.JUMP, statement)
    const body = this.chunk.code.length
    this.block(statement.body)
    this.emit(Op.LOAD, statement, this.name('$i'))
    this.emit(Op.CONST, statement, this.constant(1))
    this.emit(Op.ADD, statement)
    this.emit(Op.STORE, statement, this.name('$i'))
    this.patch(check)
    this.emit(Op.LOAD, statement, this.name('$i'))
    this.emit(Op.LOAD, statement, this.name('$n'))
    this.emit(Op.LT, statement)
    const done = this.emit(Op.JUMP_IF_FALSE, statement)
    this.emit(Op.LOAD, statement, this.name('$i'))
    this.emit(Op.CONST, statement, this.constant(0))
    this.emit(Op.EQ, statement)
    const first = this.emit(Op.JUMP_IF_TRUE, statement)
    this.emit(Op.PAUSE, statement)
    this.patch(first)
    this.emit(Op.JUMP, statement, body)
    this.patch(done)
    this.emit(Op.POP_SCOPE, statement)
  }

  /**
   * `for i in start..end`. The end is exclusive.
   * The counter lives in a hidden scope. Each iteration copies it into a
   * fresh binding so a closure keeps that iteration's value.
   */
  private forLoop(statement: Extract<Stmt, { type: 'ForStmt' }>): void {
    this.emit(Op.PUSH_SCOPE, statement, this.label('for'))
    this.emit(Op.CONST, statement, this.constant(0))
    this.emit(Op.DEFINE, statement, this.name('$ready'))
    this.emit(Op.CONST, statement, this.constant(0))
    this.emit(Op.DEFINE, statement, this.name('$i'))
    const loop = this.chunk.code.length
    this.emit(Op.PAUSE, statement)
    this.emit(Op.LOAD, statement, this.name('$ready'))
    this.emit(Op.CONST, statement, this.constant(0))
    this.emit(Op.EQ, statement)
    const check = this.emit(Op.JUMP_IF_FALSE, statement)
    this.emit(Op.CONST, statement, this.constant(1))
    this.emit(Op.STORE, statement, this.name('$ready'))
    this.expression(statement.start)
    this.emit(Op.CHECK_INT, statement.start)
    this.emit(Op.STORE, statement, this.name('$i'))
    this.expression(statement.end)
    this.emit(Op.CHECK_INT, statement.end)
    this.emit(Op.DEFINE, statement, this.name('$end'))
    this.patch(check)
    this.emit(Op.LOAD, statement, this.name('$i'))
    this.emit(Op.LOAD, statement, this.name('$end'))
    this.emit(Op.LT, statement)
    const done = this.emit(Op.JUMP_IF_FALSE, statement)
    this.emit(Op.PUSH_SCOPE, statement, this.label('for'))
    this.emit(Op.LOAD, statement, this.name('$i'))
    this.emit(Op.DEFINE, statement, this.name(statement.name))
    this.block(statement.body)
    this.emit(Op.POP_SCOPE, statement)
    this.emit(Op.LOAD, statement, this.name('$i'))
    this.emit(Op.CONST, statement, this.constant(1))
    this.emit(Op.ADD, statement)
    this.emit(Op.STORE, statement, this.name('$i'))
    this.emit(Op.JUMP, statement, loop)
    this.patch(done)
    this.emit(Op.POP_SCOPE, statement)
  }

  /**
   * `for x in collection`. The items are copied once, then each pass
   * binds one of them. Pauses match the tree-walker: one before the
   * collection is read, then one before every later check.
   */
  private forIn(statement: Extract<Stmt, { type: 'ForInStmt' }>): void {
    this.emit(Op.PUSH_SCOPE, statement, this.label('for'))
    this.emit(Op.CONST, statement, this.constant(0))
    this.emit(Op.DEFINE, statement, this.name('$ready'))
    this.emit(Op.CONST, statement, this.constant(0))
    this.emit(Op.DEFINE, statement, this.name('$i'))
    const loop = this.chunk.code.length
    this.emit(Op.PAUSE, statement)
    this.emit(Op.LOAD, statement, this.name('$ready'))
    this.emit(Op.CONST, statement, this.constant(0))
    this.emit(Op.EQ, statement)
    const check = this.emit(Op.JUMP_IF_FALSE, statement)
    this.emit(Op.CONST, statement, this.constant(1))
    this.emit(Op.STORE, statement, this.name('$ready'))
    this.expression(statement.collection)
    this.emit(Op.ITEMS, statement.collection)
    this.emit(Op.DEFINE, statement, this.name('$items'))
    this.emit(Op.LOAD, statement, this.name('$items'))
    this.emit(Op.LEN, statement)
    this.emit(Op.DEFINE, statement, this.name('$end'))
    this.patch(check)
    this.emit(Op.LOAD, statement, this.name('$i'))
    this.emit(Op.LOAD, statement, this.name('$end'))
    this.emit(Op.LT, statement)
    const done = this.emit(Op.JUMP_IF_FALSE, statement)
    this.emit(Op.PUSH_SCOPE, statement, this.label('for'))
    this.emit(Op.LOAD, statement, this.name('$items'))
    this.emit(Op.LOAD, statement, this.name('$i'))
    this.emit(Op.INDEX, statement)
    this.emit(Op.DEFINE, statement, this.name(statement.name))
    this.block(statement.body)
    this.emit(Op.POP_SCOPE, statement)
    this.emit(Op.LOAD, statement, this.name('$i'))
    this.emit(Op.CONST, statement, this.constant(1))
    this.emit(Op.ADD, statement)
    this.emit(Op.STORE, statement, this.name('$i'))
    this.emit(Op.JUMP, statement, loop)
    this.patch(done)
    this.emit(Op.POP_SCOPE, statement)
  }

  /** `each ball in Ball where cond`. The list is copied once. */
  private each(statement: Extract<Stmt, { type: 'EachStmt' }>): void {
    this.emit(Op.PUSH_SCOPE, statement, this.label('each'))
    this.emit(Op.CONST, statement, this.constant(0))
    this.emit(Op.DEFINE, statement, this.name('$ready'))
    this.emit(Op.CONST, statement, this.constant(0))
    this.emit(Op.DEFINE, statement, this.name('$i'))
    const loop = this.chunk.code.length
    this.emit(Op.PAUSE, statement)
    this.emit(Op.LOAD, statement, this.name('$ready'))
    this.emit(Op.CONST, statement, this.constant(0))
    this.emit(Op.EQ, statement)
    const check = this.emit(Op.JUMP_IF_FALSE, statement)
    this.emit(Op.CONST, statement, this.constant(1))
    this.emit(Op.STORE, statement, this.name('$ready'))
    this.emit(Op.LOAD, statement, this.name(statement.typeName))
    this.emit(Op.ENTITIES, statement)
    this.emit(Op.DEFINE, statement, this.name('$items'))
    this.emit(Op.LOAD, statement, this.name('$items'))
    this.emit(Op.LEN, statement)
    this.emit(Op.DEFINE, statement, this.name('$end'))
    this.patch(check)
    this.emit(Op.LOAD, statement, this.name('$i'))
    this.emit(Op.LOAD, statement, this.name('$end'))
    this.emit(Op.LT, statement)
    const done = this.emit(Op.JUMP_IF_FALSE, statement)
    this.emit(Op.PUSH_SCOPE, statement, this.label('each'))
    this.emit(Op.LOAD, statement, this.name('$items'))
    this.emit(Op.LOAD, statement, this.name('$i'))
    this.emit(Op.INDEX, statement)
    this.emit(Op.DEFINE, statement, this.name(statement.name))
    this.emit(Op.LOAD, statement, this.name(statement.name))
    this.emit(Op.ALIVE, statement)
    const skipDead = this.emit(Op.JUMP_IF_FALSE, statement)
    this.expression(statement.where)
    const skipWhere = this.emit(Op.JUMP_IF_FALSE, statement.where)
    this.block(statement.body)
    this.patch(skipWhere)
    this.patch(skipDead)
    this.emit(Op.POP_SCOPE, statement)
    this.emit(Op.LOAD, statement, this.name('$i'))
    this.emit(Op.CONST, statement, this.constant(1))
    this.emit(Op.ADD, statement)
    this.emit(Op.STORE, statement, this.name('$i'))
    this.emit(Op.JUMP, statement, loop)
    this.patch(done)
    this.emit(Op.POP_SCOPE, statement)
  }

  private block(block: BlockStmt): void {
    this.emit(Op.PUSH_SCOPE, block, this.label('block'))
    this.statements(block.statements)
    this.emit(Op.POP_SCOPE, block)
  }

  private closure(name: string, params: Parameter[], body: BlockStmt, at: SourceLocation): void {
    const child = new Compiler(name, params.map((param) => param.name))
    child.statements(body.statements)
    const index = this.chunk.functions.length
    this.chunk.functions.push(child.chunk)
    this.emit(Op.CLOSURE, at, index)
  }

  private expression(expr: Expr): void {
    switch (expr.type) {
      case 'LiteralExpr':
        this.emit(Op.CONST, expr, this.constant(expr.value))
        return
      case 'VariableExpr':
        this.emit(Op.LOAD, expr, this.name(expr.name))
        return
      case 'SpawnExpr':
        this.expression(expr.x)
        this.expression(expr.y)
        this.emit(Op.LOAD, expr, this.name(expr.name))
        for (const field of expr.fields) {
          this.emit(Op.CONST, field, this.constant(field.name))
          this.expression(field.value)
        }
        this.emit(Op.SPAWN, expr, expr.fields.length)
        return
      case 'ArrayExpr':
        for (const element of expr.elements) this.expression(element)
        this.emit(Op.ARRAY, expr, expr.elements.length)
        return
      case 'IndexExpr':
        this.expression(expr.object)
        this.expression(expr.index)
        this.emit(Op.INDEX, expr)
        return
      case 'FnExpr':
        this.closure('(anonymous)', expr.params, expr.body, expr)
        return
      case 'FieldExpr':
        this.expression(expr.object)
        this.emit(Op.GET_FIELD, { line: expr.nameLine, column: expr.nameColumn }, this.name(expr.name))
        return
      case 'MapExpr':
        for (const entry of expr.entries) {
          this.emit(Op.CONST, entry, this.constant(entry.key))
          this.expression(entry.value)
        }
        this.emit(Op.MAKE_MAP, expr, expr.entries.length)
        return
      case 'RecordExpr':
        this.emit(Op.LOAD, expr, this.name(expr.name))
        for (const field of expr.fields) {
          this.emit(Op.CONST, field, this.constant(field.name))
          this.expression(field.value)
        }
        this.emit(Op.MAKE_RECORD, expr, expr.fields.length)
        return
      case 'InterpExpr': {
        let emitted = 0
        for (const part of expr.parts) {
          if (part.type === 'text') this.emit(Op.CONST, expr, this.constant(part.text))
          else {
            this.expression(part.expr)
            this.emit(Op.STR, part.expr)
          }
          if (emitted > 0) this.emit(Op.ADD, expr)
          emitted++
        }
        if (emitted === 0) this.emit(Op.CONST, expr, this.constant(''))
        return
      }
      case 'MatchExpr':
        this.match(expr)
        return
      case 'UnaryExpr':
        this.expression(expr.operand)
        this.emit(expr.operator === '-' ? Op.NEG : Op.NOT, expr.operand)
        return
      case 'CallExpr':
        this.expression(expr.callee)
        for (const arg of expr.args) this.expression(arg)
        this.emit(Op.CALL, expr, expr.args.length)
        return
      case 'BinaryExpr':
        this.binary(expr)
        return
    }
  }

  private binary(expr: Extract<Expr, { type: 'BinaryExpr' }>): void {
    if (expr.operator === 'and') {
      this.expression(expr.left)
      const skip = this.emit(Op.JUMP_IF_FALSE, expr.left)
      this.expression(expr.right)
      this.emit(Op.CHECK_BOOL, expr.right)
      const end = this.emit(Op.JUMP, expr)
      this.patch(skip)
      this.emit(Op.CONST, expr, this.constant(false))
      this.patch(end)
      return
    }
    if (expr.operator === 'or') {
      this.expression(expr.left)
      const skip = this.emit(Op.JUMP_IF_TRUE, expr.left)
      this.expression(expr.right)
      this.emit(Op.CHECK_BOOL, expr.right)
      const end = this.emit(Op.JUMP, expr)
      this.patch(skip)
      this.emit(Op.CONST, expr, this.constant(true))
      this.patch(end)
      return
    }

    if (expr.operator === '|>') {
      if (expr.right.type === 'CallExpr') {
        this.expression(expr.right.callee)
        this.expression(expr.left)
        for (const arg of expr.right.args) this.expression(arg)
        this.emit(Op.CALL, expr, expr.right.args.length + 1)
        return
      }
      this.expression(expr.right)
      this.expression(expr.left)
      this.emit(Op.CALL, expr, 1)
      return
    }

    this.expression(expr.left)
    this.expression(expr.right)
    this.emit(BINARY[expr.operator], expr)
  }

  /** Each arm tests `$subject`. The first match's value is the result. */
  private match(expr: Extract<Expr, { type: 'MatchExpr' }>): void {
    this.emit(Op.PUSH_SCOPE, expr, this.label('match'))
    this.expression(expr.scrutinee)
    this.emit(Op.DEFINE, expr, this.name('$subject'))
    const ends: number[] = []
    for (const arm of expr.arms) {
      this.emit(Op.LOAD, arm.pattern, this.name('$subject'))
      const index = this.chunk.patterns.length
      this.chunk.patterns.push(arm.pattern)
      this.emit(Op.TRY_PATTERN, arm.pattern, index)
      const skip = this.emit(Op.JUMP_IF_FALSE, arm.pattern)
      this.expression(arm.body)
      ends.push(this.emit(Op.JUMP, arm.body))
      this.patch(skip)
    }
    this.emit(Op.MATCH_FAIL, expr)
    for (const end of ends) this.patch(end)
    this.emit(Op.POP_SCOPE, expr)
  }

  private emit(op: Op, at: SourceLocation, arg = 0): number {
    const ip = this.chunk.code.length
    const ins: Ins = { op, arg, line: at.line, column: at.column }
    this.chunk.code.push(ins)
    return ip
  }

  private patch(ip: number): void {
    this.chunk.code[ip].arg = this.chunk.code.length
  }

  private name(name: string): number {
    let index = this.chunk.names.indexOf(name)
    if (index < 0) {
      index = this.chunk.names.length
      this.chunk.names.push(name)
    }
    return index
  }

  private constant(value: Constant): number {
    const index = this.chunk.constants.findIndex((item) => item === value)
    if (index >= 0) return index
    this.chunk.constants.push(value)
    return this.chunk.constants.length - 1
  }

  private label(label: string): number {
    const index = this.chunk.labels.length
    this.chunk.labels.push(label)
    return index
  }
}

const BINARY: Record<string, Op> = {
  '+': Op.ADD,
  '-': Op.SUB,
  '*': Op.MUL,
  '/': Op.DIV,
  '%': Op.MOD,
  '==': Op.EQ,
  '!=': Op.NE,
  '<': Op.LT,
  '>': Op.GT,
  '<=': Op.LE,
  '>=': Op.GE,
}
