import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { type Extension } from '@codemirror/state'
import { hoverTooltip } from '@codemirror/view'
import type { Program, Stmt } from '../ast.ts'
import { parse } from '../parser.ts'

const DOCS: Record<string, string> = {
  let: 'let name = value — define a name in this scope.',
  if: 'if condition { } else { } — the condition must be a boolean.',
  else: 'else { } — the other branch. else if needs its own block.',
  while: 'while condition { } — repeat while the condition is true.',
  repeat: 'repeat count { } — count is a non-negative integer.',
  for: 'for name in 0..end { } or for name in collection { }.',
  fn: 'fn name(params) { } — a function. The name is visible inside the body.',
  return: 'return value — leave the current function.',
  match: 'match value { pattern => result } — the first match wins.',
  use: 'use draw — bind a host module. The language never touches the canvas itself.',
  on: 'on start { }  on tick(dt) { }  on key "space" { }.',
  entity: 'entity Ball { r } — a type. x and y come from spawn.',
  spawn: 'spawn Ball at (x, y) { r: 4px } — create an entity.',
  despawn: 'despawn ball — remove an entity from the world.',
  each: 'each ball in Ball { } — where is optional.',
  rewind: 'rewind 2s — restore the game to that moment. Energy limits are ordinary code.',
  clamp: 'clamp(value, low, high) — numbers or quantities that share a unit.',
  lerp: 'lerp(a, b, t) — t is a number from 0 to 1.',
  bounce: 'bounce(v) — negate a number, quantity, or vec.',
  when: 'when ball in Ball touches pad in Paddle { } — every overlapping frame.',
  task: 'task name { wait 1s } — work on the game clock.',
  wait: 'wait 1.5s or wait until condition. Only inside a task.',
  every: 'every 2s { } — a task that repeats after the interval.',
  after: 'after 3s { } — a task that runs once.',
  vec: 'vec(x, y) — a pair. Both components share a unit.',
  len: 'len(array) or len(string).',
  push: 'push(array, value) — append and return the same array.',
  random: 'random() — a number from 0 up to but not including 1. Seeded in the studio.',
  print: 'print value — write a line to Output.',
  sin: 'sin(radians).',
  cos: 'cos(radians).',
  sqrt: 'sqrt(number) — the number must not be negative.',
  abs: 'abs(number).',
  min: 'min(a, b, ...) — at least two arguments.',
  max: 'max(a, b, ...) — at least two arguments.',
  hsl: 'hsl(h, s, l) — a color string.',
  'draw.background': 'draw.background(color) — fill the frame. Stays until changed.',
  'draw.camera': 'draw.camera(x, y) — shift the view.',
  'draw.rect': 'draw.rect(x, y, w, h, color) — x and y are the top-left.',
  'draw.circle': 'draw.circle(x, y, r, color).',
  'draw.line': 'draw.line(x1, y1, x2, y2, color).',
  'draw.text': 'draw.text(x, y, text, color).',
  'draw.sprite': 'draw.sprite(x, y, art) — a string of pixel art, or one emoji.',
  'input.key': 'input.key("space") — true while the key is held.',
  'input.mouse': 'input.mouse() — a px vector. Origin is the top-left.',
  'input.click': 'input.click() — true for the frame the button went down.',
  'audio.beep': 'audio.beep(freq, duration) — a square tone. Duration is seconds, like 0.1s.',
  'audio.tone': 'audio.tone(wave, freq, duration) — sine, square, triangle, or saw.',
  'audio.play': 'audio.play("hit" | "score" | "boom").',
}

const MEMBERS: Record<string, string[]> = {
  draw: ['background', 'camera', 'rect', 'circle', 'line', 'text', 'sprite'],
  input: ['key', 'mouse', 'click'],
  audio: ['beep', 'tone', 'play'],
  turtle: ['forward', 'back', 'turn', 'penup', 'pendown', 'color', 'width', 'goto'],
}

const WORDS = [
  'print', 'len', 'push', 'clamp', 'lerp', 'bounce', 'vec', 'sin', 'cos', 'sqrt', 'abs', 'min', 'max', 'random', 'hsl', 'count',
]

/** Words the REPL can offer. The editor's completion uses the same names. */
export function spoolWords(prefix: string): string[] {
  const lower = prefix.toLowerCase()
  const pool = new Set<string>([...KEYWORDS, ...WORDS, ...Object.keys(MEMBERS)])
  return [...pool].filter((word) => word.startsWith(lower)).sort().slice(0, 8)
}

const KEYWORDS = [
  'let', 'if', 'else', 'while', 'repeat', 'for', 'in', 'fn', 'return', 'and', 'or', 'not',
  'true', 'false', 'record', 'match', 'use', 'on', 'entity', 'spawn', 'at', 'despawn',
  'each', 'where', 'when', 'touches', 'task', 'wait', 'until', 'every', 'after', 'rewind',
]

/** Completions and hover tips from the same names the language knows. */
export function spoolAssist(): Extension {
  return [
    autocompletion({ override: [complete] }),
    hoverTooltip((view, pos) => {
      const doc = view.state.doc.toString()
      const word = wordAt(doc, pos)
      if (!word) return null
      const text = tip(doc, word.text)
      if (!text) return null
      return {
        pos: word.from,
        end: word.to,
        above: true,
        create() {
          const dom = document.createElement('div')
          dom.className = 'hover-card'
          dom.textContent = text
          return { dom }
        },
      }
    }),
  ]
}

function complete(context: CompletionContext): CompletionResult | null {
  const member = context.matchBefore(/[A-Za-z_]\w*\.[A-Za-z_]\w*/)
  if (member) {
    const [object, partial] = member.text.split('.')
    const names = MEMBERS[object ?? '']
    if (!names) return null
    const from = member.from + (object?.length ?? 0) + 1
    return {
      from,
      options: names
        .filter((name) => name.startsWith(partial ?? ''))
        .map((name) => item(name, 'property', DOCS[`${object}.${name}`] ?? '')),
    }
  }
  const word = context.matchBefore(/[A-Za-z_]\w*/)
  if (!word || (word.from === word.to && !context.explicit)) return null
  const options: Completion[] = []
  for (const name of KEYWORDS) options.push(item(name, 'keyword', DOCS[name] ?? ''))
  for (const name of Object.keys(MEMBERS)) options.push(item(name, 'namespace', `use ${name}`))
  for (const name of ['vec', 'len', 'push', 'random', 'print', 'sin', 'cos', 'sqrt', 'abs', 'min', 'max', 'hsl']) {
    options.push(item(name, 'function', DOCS[name] ?? ''))
  }
  for (const name of namesIn(context.state.doc.toString())) options.push(item(name.label, name.kind, name.detail))
  return { from: word.from, options }
}

function item(label: string, type: string, detail: string): Completion {
  return { label, type, detail }
}

function namesIn(source: string): { label: string; kind: string; detail: string }[] {
  let program: Program
  try {
    program = parse(source)
  } catch {
    return []
  }
  const found: { label: string; kind: string; detail: string }[] = []
  const walk = (statements: Stmt[]) => {
    for (const statement of statements) {
      if (statement.type === 'LetStmt') found.push({ label: statement.name, kind: 'variable', detail: 'Local' })
      if (statement.type === 'FnStmt') {
        found.push({ label: statement.name, kind: 'function', detail: `fn ${statement.name}()` })
        walk(statement.body.statements)
      }
      if (statement.type === 'EntityStmt') {
        found.push({ label: statement.name, kind: 'type', detail: `entity ${statement.name}` })
        for (const field of statement.fields) found.push({ label: field, kind: 'property', detail: `${statement.name}.${field}` })
      }
      if (statement.type === 'RecordStmt') found.push({ label: statement.name, kind: 'type', detail: `record ${statement.name}` })
      if (statement.type === 'IfStmt') {
        walk(statement.thenBranch.statements)
        if (statement.elseBranch) walk(statement.elseBranch.statements)
      }
      if (statement.type === 'WhileStmt' || statement.type === 'RepeatStmt' || statement.type === 'ForStmt' || statement.type === 'ForInStmt') {
        walk(statement.body.statements)
      }
      if (statement.type === 'OnStmt' || statement.type === 'TaskStmt' || statement.type === 'EveryStmt' || statement.type === 'AfterStmt' || statement.type === 'WhenStmt' || statement.type === 'EachStmt') {
        walk(statement.body.statements)
      }
    }
  }
  walk(program.body)
  return found
}

function tip(source: string, word: string): string | null {
  if (DOCS[word]) return DOCS[word]
  for (const [object, names] of Object.entries(MEMBERS)) {
    if (names.includes(word) && source.includes(`${object}.`)) return DOCS[`${object}.${word}`] ?? null
  }
  return null
}

function wordAt(source: string, pos: number): { from: number; to: number; text: string } | null {
  let from = pos
  let to = pos
  while (from > 0 && /[A-Za-z0-9_]/.test(source[from - 1] ?? '')) from--
  while (to < source.length && /[A-Za-z0-9_]/.test(source[to] ?? '')) to++
  if (to === from) return null
  return { from, to, text: source.slice(from, to) }
}
