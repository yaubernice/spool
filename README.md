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
| `turn`    | Rotate clockwise by degrees. Heading 0 points up |
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
    ↓  playground/       editor, animation, examples
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

## Playground

`npm run dev` opens the studio.

- **Run**, or Cmd/Ctrl-Enter, draws the program. The turtle walks each line. Drag **Speed** while it is drawing; the right end of the slider finishes the picture at once.
- **Spiral**, **Snowflake**, **Tree**, and **Flower** load an example.
- A mistake is underlined in the editor and shown with the source line and a caret. The page stays up.
- `print` writes under the editor.
- The program is stored in the URL hash, so the address is a shareable link.

## Build phases

Phases 1–13 are done.

1. Project setup
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
14. Polish: demo GIF and deployment

## Getting started

```bash
npm install
npm test        # unit tests (Vitest)
npm run dev     # playground at http://127.0.0.1:5173/
npm run build   # production static build
```

## Stack

- TypeScript + Vite (static site — GitHub Pages or Vercel still to come)
- Vitest for tests
- CodeMirror 6 for the editor
- Hand-written lexer, parser, and interpreter — no parsing libraries
