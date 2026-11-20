/**
 * AST: the tree the parser builds and the interpreter walks.
 *
 * The lexer has already thrown away whitespace and comments. What remains
 * is structure: expressions (values) inside statements (actions).
 * Every node records the line and column where it starts (1-based),
 * so a later error can point at that spot in the source.
 */

/** Where a node starts in the source. */
export interface SourceLocation {
  line: number
  column: number
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

/** A number or a string written in the source, e.g. `50` or `"red"`. */
export interface LiteralExpr extends SourceLocation {
  type: 'LiteralExpr'
  value: number | string
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
 * A function or built-in call, e.g. `square(100)` or `forward s`.
 * The callee is always a name. Parentheses are a parsing detail;
 * the tree just stores the name and the argument expressions.
 */
export interface CallExpr extends SourceLocation {
  type: 'CallExpr'
  callee: string
  args: Expr[]
}

export type Expr = LiteralExpr | VariableExpr | UnaryExpr | BinaryExpr | CallExpr

/** One parameter of a function, e.g. `s` in `fn square(s)`. */
export interface Parameter extends SourceLocation {
  name: string
}

/** `let size = 50`. The value is required. */
export interface LetStmt extends SourceLocation {
  type: 'LetStmt'
  name: string
  value: Expr
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

/** `fn square(s) { ... }`. */
export interface FnStmt extends SourceLocation {
  type: 'FnStmt'
  name: string
  params: Parameter[]
  body: BlockStmt
}

export type Stmt =
  | LetStmt
  | ExprStmt
  | IfStmt
  | WhileStmt
  | RepeatStmt
  | ReturnStmt
  | FnStmt

/** The whole program: a list of statements, top to bottom. */
export interface Program extends SourceLocation {
  type: 'Program'
  body: Stmt[]
}
