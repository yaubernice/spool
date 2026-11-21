import type { Quantity, Unit } from './data.ts'

/**
 * AST: the tree the parser builds and the interpreter walks.
 *
 * The lexer has already thrown away whitespace and comments. What remains
 * is structure: expressions (values) inside statements (actions).
 * Every node records the line and column where it starts (1-based),
 * so a later error can point at that spot in the source.
 */

/**
 * Where a node sits in the source.
 * `line` and `column` are the start (1-based). `endLine` and `endColumn`
 * are the position just after the last character, when the parser recorded it.
 */
export interface SourceLocation {
  line: number
  column: number
  endLine?: number
  endColumn?: number
}

/** Prefix operators. Unary minus is `-`. Logical not is the word `not`. */
export type UnaryOp = '-' | 'not'

/**
 * Infix operators.
 * Arithmetic and comparison symbols keep their source spelling.
 * `and` / `or` are words, matching the lexer keywords.
 */
export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '=='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='
  | 'and'
  | 'or'
  | '|>'

/**
 * A number, quantity, string, or boolean written in the source.
 * `50`, `120px`, `"red"`, and `true` are all literals.
 */
export interface LiteralExpr extends SourceLocation {
  type: 'LiteralExpr'
  value: number | string | boolean | Quantity
}

/** A variable read, e.g. `size`. */
export interface VariableExpr extends SourceLocation {
  type: 'VariableExpr'
  name: string
}

/** A prefix operator applied to one expression, e.g. `-size` or `not done`. */
export interface UnaryExpr extends SourceLocation {
  type: 'UnaryExpr'
  operator: UnaryOp
  operand: Expr
}

/** Two expressions joined by an operator, e.g. `size * 2` or `x < 10`. */
export interface BinaryExpr extends SourceLocation {
  type: 'BinaryExpr'
  operator: BinaryOp
  left: Expr
  right: Expr
}

/**
 * A function or built-in call, e.g. `square(100)`, `f(1)`, or `forward s`.
 * The callee is an expression, so a name, a call, or a function expression
 * can all be called.
 */
export interface CallExpr extends SourceLocation {
  type: 'CallExpr'
  callee: Expr
  args: Expr[]
}

/** `[1, 2, 3]`. */
export interface ArrayExpr extends SourceLocation {
  type: 'ArrayExpr'
  elements: Expr[]
}

/** `items[i]`. */
export interface IndexExpr extends SourceLocation {
  type: 'IndexExpr'
  object: Expr
  index: Expr
}

/**
 * `fn(x) { ... }`. An expression, so it can be stored, passed, or returned.
 * The body closes over the environment where this expression is evaluated.
 */
export interface FnExpr extends SourceLocation {
  type: 'FnExpr'
  params: Parameter[]
  body: BlockStmt
}

/** `object.field`, for a record or a vec. */
export interface FieldExpr extends SourceLocation {
  type: 'FieldExpr'
  object: Expr
  name: string
  nameLine: number
  nameColumn: number
}

/** `{ "score": 1, name: 2 }`. Keys are names or strings, not expressions. */
export interface MapExpr extends SourceLocation {
  type: 'MapExpr'
  entries: MapEntry[]
}

export interface MapEntry extends SourceLocation {
  key: string
  value: Expr
}

/** `Paddle { x: 1, y: 2 }`. `name` is the record type. */
export interface RecordExpr extends SourceLocation {
  type: 'RecordExpr'
  name: string
  fields: FieldInit[]
}

export interface FieldInit extends SourceLocation {
  name: string
  value: Expr
}

/** `"score: {score}"`. Text pieces and the expressions in the braces. */
export interface InterpExpr extends SourceLocation {
  type: 'InterpExpr'
  parts: InterpPart[]
}

export type InterpPart = { type: 'text'; text: string } | { type: 'hole'; expr: Expr }

/** `match n { 0 => "zero" n => "other" }`. An expression. */
export interface MatchExpr extends SourceLocation {
  type: 'MatchExpr'
  scrutinee: Expr
  arms: MatchArm[]
}

export interface MatchArm extends SourceLocation {
  pattern: Pattern
  body: Expr
}

export type Pattern =
  | { type: 'wild'; line: number; column: number }
  | { type: 'bind'; name: string; line: number; column: number }
  | { type: 'literal'; value: number | string | boolean; line: number; column: number }
  | { type: 'quantity'; value: number; unit: Unit; line: number; column: number }
  | { type: 'vec'; x: Pattern; y: Pattern; line: number; column: number }
  | { type: 'record'; name: string; fields: { name: string; pattern: Pattern }[]; line: number; column: number }

export type Expr =
  | LiteralExpr
  | VariableExpr
  | UnaryExpr
  | BinaryExpr
  | CallExpr
  | ArrayExpr
  | IndexExpr
  | FnExpr
  | FieldExpr
  | MapExpr
  | RecordExpr
  | InterpExpr
  | MatchExpr
  | SpawnExpr

/** One parameter of a function, e.g. `s` in `fn square(s)`. */
export interface Parameter extends SourceLocation {
  name: string
}

/** `let size = 50`. Defines a new name. It does not change an existing one. */
export interface LetStmt extends SourceLocation {
  type: 'LetStmt'
  name: string
  value: Expr
}

/**
 * `n = n + 1`. Changes a name that already exists, including one in an outer scope.
 * It does not create a name. Use `let` for that.
 */
/** `+=`, `-=`, or `*=`. Plain `=` stores `op` as null. */
export type UpdateOp = '+' | '-' | '*'

export interface AssignStmt extends SourceLocation {
  type: 'AssignStmt'
  name: string
  value: Expr
  op: UpdateOp | null
}

/**
 * An expression used as a statement.
 * Calls such as `forward s` and `square(100)` are expression statements.
 */
export interface ExprStmt extends SourceLocation {
  type: 'ExprStmt'
  expression: Expr
}

/** A `{ ... }` body. Not itself a statement; `if`, `while`, `repeat`, and `fn` own one. */
export interface BlockStmt extends SourceLocation {
  type: 'BlockStmt'
  statements: Stmt[]
}

/** `if cond { ... }` or `if cond { ... } else { ... }`. */
export interface IfStmt extends SourceLocation {
  type: 'IfStmt'
  condition: Expr
  thenBranch: BlockStmt
  elseBranch: BlockStmt | null
}

/** `while cond { ... }`. */
export interface WhileStmt extends SourceLocation {
  type: 'WhileStmt'
  condition: Expr
  body: BlockStmt
}

/** `repeat n { ... }`. `count` is an expression, so it can be a number or a variable. */
export interface RepeatStmt extends SourceLocation {
  type: 'RepeatStmt'
  count: Expr
  body: BlockStmt
}

/** `return` or `return expr`. `value` is null when nothing is returned. */
export interface ReturnStmt extends SourceLocation {
  type: 'ReturnStmt'
  value: Expr | null
}

/** `fn square(s) { ... }`. Defines a name in the current scope. */
export interface FnStmt extends SourceLocation {
  type: 'FnStmt'
  name: string
  params: Parameter[]
  body: BlockStmt
}

/**
 * `items[i] = 1`. Evaluates the array, the index, then the value.
 * It changes the array in place. It does not replace the binding.
 */
export interface IndexAssignStmt extends SourceLocation {
  type: 'IndexAssignStmt'
  object: Expr
  index: Expr
  value: Expr
  op: UpdateOp | null
}

/**
 * `for i in 0..n { ... }`. `end` is exclusive: `0..n` visits 0, 1, ..., n - 1.
 * Each iteration gets a fresh binding, so a function created in the body
 * keeps that iteration's value.
 */
export interface ForStmt extends SourceLocation {
  type: 'ForStmt'
  name: string
  start: Expr
  end: Expr
  body: BlockStmt
}

/**
 * `for x in collection { ... }`.
 * Arrays yield items, strings yield characters, and maps yield keys in insertion order.
 * The items are fixed when the loop starts. Each pass gets a fresh binding.
 */
export interface ForInStmt extends SourceLocation {
  type: 'ForInStmt'
  name: string
  collection: Expr
  body: BlockStmt
}

/** `spawn Ball at (0px, 0px) { r: 2px }`. `x` and `y` come from `at`. */
export interface SpawnExpr extends SourceLocation {
  type: 'SpawnExpr'
  name: string
  x: Expr
  y: Expr
  fields: FieldInit[]
}

/** `entity Ball { r }`. */
export interface EntityStmt extends SourceLocation {
  type: 'EntityStmt'
  name: string
  fields: string[]
}

/** `despawn ball`. */
export interface DespawnStmt extends SourceLocation {
  type: 'DespawnStmt'
  entity: Expr
}

/** `each ball in Ball { }` or `each ball in Ball where ball.x > 0 { }`. */
export interface EachStmt extends SourceLocation {
  type: 'EachStmt'
  name: string
  typeName: string
  /** Null means every living entity of that type. */
  where: Expr | null
  body: BlockStmt
}

/** `when ball in Ball touches wall in Wall { }`. */
export interface WhenStmt extends SourceLocation {
  type: 'WhenStmt'
  left: string
  leftType: string
  right: string
  rightType: string
  body: BlockStmt
}

/** `task intro { }`. Runs on the game clock and can `wait`. */
export interface TaskStmt extends SourceLocation {
  type: 'TaskStmt'
  name: string
  body: BlockStmt
}

/** `wait 1.5s` or `wait until ready`. */
export interface WaitStmt extends SourceLocation {
  type: 'WaitStmt'
  /** Set for `wait until`. Null for a timed wait. */
  condition: Expr | null
  /** Set for `wait 1.5s`. Null for `wait until`. */
  time: Expr | null
}

/** `every 2s { }`. The body runs after each interval of game time. */
export interface EveryStmt extends SourceLocation {
  type: 'EveryStmt'
  interval: Expr
  body: BlockStmt
}

/** `after 3s { }`. The body runs once, when the delay has passed. */
export interface AfterStmt extends SourceLocation {
  type: 'AfterStmt'
  delay: Expr
  body: BlockStmt
}

/** `on start`, `on tick(dt)`, `on key "space"`, or `on key_up "space"`. */
export interface OnStmt extends SourceLocation {
  type: 'OnStmt'
  event: 'start' | 'tick' | 'key' | 'key_up'
  /** The `dt` name for `on tick`. Null for the other events. */
  param: string | null
  /** The key name for `on key` and `on key_up`. Null otherwise. */
  key: string | null
  body: BlockStmt
}

/** `use turtle`. Binds a module the host provided. */
export interface UseStmt extends SourceLocation {
  type: 'UseStmt'
  name: string
}

/** `record Paddle { x, y }`. Defines a record type under that name. */
export interface RecordStmt extends SourceLocation {
  type: 'RecordStmt'
  name: string
  fields: string[]
}

/** `paddle.x = 1`. Changes a field of a record, or `x` / `y` of a vec. */
export interface FieldAssignStmt extends SourceLocation {
  type: 'FieldAssignStmt'
  object: Expr
  name: string
  value: Expr
  op: UpdateOp | null
  nameLine: number
  nameColumn: number
}

/** `rewind 2s`. Restores the game to the state from that long ago. */
export interface RewindStmt extends SourceLocation {
  type: 'RewindStmt'
  time: Expr
}

export type Stmt =
  | LetStmt
  | AssignStmt
  | IndexAssignStmt
  | FieldAssignStmt
  | ExprStmt
  | IfStmt
  | WhileStmt
  | RepeatStmt
  | ForStmt
  | ForInStmt
  | RecordStmt
  | UseStmt
  | OnStmt
  | EntityStmt
  | DespawnStmt
  | EachStmt
  | WhenStmt
  | TaskStmt
  | WaitStmt
  | EveryStmt
  | AfterStmt
  | RewindStmt
  | ReturnStmt
  | FnStmt

/** The whole program: a list of statements, top to bottom. */
export interface Program extends SourceLocation {
  type: 'Program'
  body: Stmt[]
}
