# Tiny Language

A tiny programming language you can run in the browser — write a few lines, hit Run, and watch a turtle draw on a canvas.

This is a portfolio / learning project: a hand-written **lexer**, **recursive descent parser**, and **tree-walking interpreter** in TypeScript. No parsing libraries. The goal is to see how interpreters work end-to-end, then make it feel alive with an interactive playground.

## Language spec

Keep it small on purpose.

### Values and variables

- Numbers and strings
- Variables: `let size = 50`
- Comments start with `#`

### Expressions

- Arithmetic with correct precedence: `+` `-` `*` `/` `%`, parentheses, unary minus
- Comparisons: `==` `!=` `<` `>` `<=` `>=`
- Booleans: `and` `or` `not`

### Control flow

- `if` / `else`
- `while`
- `repeat N { ... }`

### Functions

- Definitions with parameters, `return`, and recursion: `fn square(s) { ... }`
- Calls: `square(100)`

### Turtle built-ins

| Command   | Meaning                          |
|-----------|----------------------------------|
| `forward` | Move forward by a distance       |
| `back`    | Move backward                    |
| `turn`    | Rotate by degrees                |
| `penup`   | Stop drawing                     |
| `pendown` | Start drawing                    |
| `color`   | Set pen color                    |
| `width`   | Set pen width                    |
| `goto`    | Jump to a position               |
| `print`   | Print a value (console / output) |

### Example

```
fn square(s) {
  repeat 4 { forward s  turn 90 }
}
repeat 36 {
  square(100)
  turn 10
}
```

## Architecture

```
source text
    ↓  lexer.ts          tokens (with line & column)
    ↓  parser.ts         AST
    ↓  interpreter.ts    evaluate with scoped environments
    ↓  turtle.ts         draw instructions (injected as built-ins)
    ↓  playground/       editor + canvas (later phases)
```

| File | Role |
|------|------|
| `src/lexer.ts` | Text → tokens |
| `src/ast.ts` | Node type definitions |
| `src/parser.ts` | Tokens → AST (recursive descent + precedence climbing) |
| `src/interpreter.ts` | Evaluate AST; turtle injected as built-ins (no canvas knowledge) |
| `src/errors.ts` | Errors with line/column and friendly messages |
| `src/turtle.ts` | Turtle state and drawing commands |
| `src/playground/` | CodeMirror editor, canvas, UI |

Runtime guards: step limit and call-depth limit so infinite loops / runaway recursion fail safely.

## Build phases

1. Project setup (you are here)
2. Lexer
3. AST types
4. Parser: expressions
5. Parser: statements
6. Parser: functions and calls
7. Interpreter: expressions, variables, scopes
8. Interpreter: control flow
9. Interpreter: functions, return, recursion, limits
10. Friendly errors with line and column
11. Turtle module and canvas renderer
12. Playground: editor, Run, canvas, speed slider
13. Playground: example gallery, error underlines, shareable URL
14. Polish: docs, demo GIF, deployment

## Getting started

```bash
npm install
npm test        # unit tests (Vitest)
npm run dev     # local Vite server
npm run build   # production static build
```

The live playground (CodeMirror, canvas, examples, shareable links) lands in phases 11–13. Until then, the interpreter is built and tested in the terminal first.

## Stack

- TypeScript + Vite (static site — GitHub Pages or Vercel ready later)
- Vitest for tests
- CodeMirror 6 for the editor (playground phase only)
- Hand-written lexer, parser, and interpreter — no parsing libraries
