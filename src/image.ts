import type { Chunk } from './bytecode.ts'
import {
  isEntity,
  isEntityType,
  isMap,
  isModule,
  isQuantity,
  isRecord,
  isRecordType,
  isVec,
  type EntityValue,
} from './data.ts'
import { bindModule, Environment, type FunctionValue, type Value } from './interpreter.ts'
import type { Host } from './host.ts'

/**
 * A JSON-safe picture of a paused stack VM.
 * Call frames are instruction pointers into the program's chunks.
 * Host functions are stored by name and hooked back up on restore.
 */

export interface VmImage {
  rng: number | null
  steps: number
  callDepth: number
  peakDepth: number
  result: Encoded
  stack: Encoded[]
  env: number
  frames: { path: number[]; ip: number; parent: number; call: boolean; task: boolean }[]
  calls: { name: string; line: number; column: number }[]
  envs: EnvImage[]
  ents: Encoded[]
  /** `on start`, `on tick`, and `on key` handlers. */
  handlers: { event: 'start' | 'tick' | 'key' | 'key_up'; key: string | null; fn: Encoded; line: number; column: number }[]
  rules: { left: string; right: string; fn: Encoded; line: number; column: number }[]
  tasks: { fn: Encoded; started: boolean; line: number; column: number }[]
  sleeping: SleepImage[]
  ticks: number
  /** True after the first game frame has run `on start`. */
  started: boolean
  line: number
  column: number
}

interface SleepImage {
  path: number[]
  ip: number
  parent: number
  call: boolean
  task: boolean
  env: number
  name: string
  line: number
  column: number
  mode: 'time' | 'until'
  wake: number
}

interface EnvImage {
  id: number
  parent: number | null
  label: string
  bindings: { name: string; value: Encoded }[]
}

type Encoded =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'qty'; v: number; px: number; s: number }
  | { t: 'vec'; x: Encoded; y: Encoded }
  | { t: 'arr'; id: number; items: Encoded[] }
  | { t: 'map'; id: number; entries: { k: string; v: Encoded }[] }
  | { t: 'rec'; id: number; name: string; fields: { k: string; v: Encoded }[] }
  | { t: 'rtype'; name: string; fields: string[] }
  | { t: 'mod'; name: string }
  | { t: 'builtin'; name: string }
  | { t: 'fn'; name: string; path: number[]; env: number }
  | { t: 'ref'; id: number }
  | { t: 'ent'; id: number; name: string; alive: boolean; fields: { k: string; v: Encoded }[] }
  | { t: 'eref'; id: number }
  | { t: 'etype'; name: string; fields: string[] }

export interface MachineView {
  root: Chunk
  rng: number | null
  steps: number
  callDepth: number
  peakDepth: number
  result: Value
  stack: Value[]
  env: Environment
  globals: Environment
  frames: { chunk: Chunk; ip: number; parentEnv: Environment; call: boolean; task?: boolean }[]
  calls: { name: string; line: number; column: number }[]
  world: EntityValue[]
  handlers: { event: 'start' | 'tick' | 'key' | 'key_up'; key: string | null; fn: FunctionValue; line: number; column: number }[]
  rules: { left: string; right: string; fn: FunctionValue; line: number; column: number }[]
  tasks: { fn: FunctionValue; started: boolean; line: number; column: number }[]
  sleeping: {
    frame: { chunk: Chunk; ip: number; parentEnv: Environment; call: boolean; task?: boolean }
    env: Environment
    call: { name: string; line: number; column: number }
    mode: 'time' | 'until'
    wake: number
  }[]
  ticks: number
  started: boolean
  line: number
  column: number
}

export function encodeMachine(view: MachineView): VmImage {
  const ids = new Map<Environment, number>()
  const idOf = (env: Environment): number => {
    const found = ids.get(env)
    if (found !== undefined) return found
    if (env.parent) idOf(env.parent)
    const id = ids.size
    ids.set(env, id)
    return id
  }
  idOf(view.globals)
  idOf(view.env)
  for (const frame of view.frames) idOf(frame.parentEnv)
  for (const handler of view.handlers) idOf(handler.fn.closure)
  for (const rule of view.rules) idOf(rule.fn.closure)
  for (const task of view.tasks) idOf(task.fn.closure)
  for (const sleep of view.sleeping) {
    idOf(sleep.env)
    idOf(sleep.frame.parentEnv)
  }
  const visit = (value: Value): void => {
    if (value === null || typeof value !== 'object') return
    if (value.type === 'function') idOf(value.closure)
    if (value.type === 'array') value.items.forEach(visit)
    else if (isMap(value)) value.entries.forEach((entry) => visit(entry.value as Value))
    else if (isRecord(value)) Object.values(value.fields).forEach((field) => visit(field as Value))
    else if (isVec(value)) {
      visit(value.x)
      visit(value.y)
    } else if (isEntity(value)) Object.values(value.fields).forEach((field) => visit(field as Value))
  }
  const pending = [view.result, ...view.stack, ...view.world]
  for (const frame of view.frames) pending.push(...frame.parentEnv.chain().flatMap((env) => env.entries().map(([, value]) => value)))
  let count = -1
  while (ids.size !== count) {
    count = ids.size
    for (const env of ids.keys()) pending.push(...env.entries().map(([, value]) => value))
    for (const value of pending) visit(value)
  }
  const seen = new Map<object, number>()
  let nextId = 1
  const enc = (value: Value): Encoded => encodeValue(value, view.root, enc, idOf, seen, () => nextId++)
  const ents = view.world.map(enc)
  const stack = view.stack.map(enc)
  const result = enc(view.result)
  const envs: EnvImage[] = [...ids.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([env, id]) => ({
      id,
      parent: env.parent ? (ids.get(env.parent) ?? null) : null,
      label: env.label,
      bindings: env.entries().map(([name, value]) => ({ name, value: enc(value) })),
    }))
  return {
    rng: view.rng,
    steps: view.steps,
    callDepth: view.callDepth,
    peakDepth: view.peakDepth,
    result,
    stack,
    env: idOf(view.env),
    frames: view.frames.map((frame) => ({
      path: chunkPath(view.root, frame.chunk),
      ip: frame.ip,
      parent: idOf(frame.parentEnv),
      call: frame.call,
      task: frame.task === true,
    })),
    calls: view.calls.map((frame) => ({ ...frame })),
    envs,
    ents,
    handlers: view.handlers.map((handler) => ({
      event: handler.event,
      key: handler.key,
      fn: enc(handler.fn),
      line: handler.line,
      column: handler.column,
    })),
    rules: view.rules.map((rule) => ({
      left: rule.left,
      right: rule.right,
      fn: enc(rule.fn),
      line: rule.line,
      column: rule.column,
    })),
    tasks: view.tasks.map((task) => ({
      fn: enc(task.fn),
      started: task.started,
      line: task.line,
      column: task.column,
    })),
    sleeping: view.sleeping.map((sleep) => ({
      path: chunkPath(view.root, sleep.frame.chunk),
      ip: sleep.frame.ip,
      parent: idOf(sleep.frame.parentEnv),
      call: sleep.frame.call,
      task: sleep.frame.task === true,
      env: idOf(sleep.env),
      name: sleep.call.name,
      line: sleep.call.line,
      column: sleep.call.column,
      mode: sleep.mode,
      wake: sleep.wake,
    })),
    ticks: view.ticks,
    started: view.started,
    line: view.line,
    column: view.column,
  }
}

export function decodeMachine(
  image: VmImage,
  root: Chunk,
  globals: Environment,
  modules: Host['modules'],
  resolveBuiltin: (name: string) => Value,
): {
  env: Environment
  stack: Value[]
  result: Value
  frames: { chunk: Chunk; ip: number; parentEnv: Environment; call: boolean; task: boolean }[]
  entities: EntityValue[]
  handlers: { event: 'start' | 'tick' | 'key' | 'key_up'; key: string | null; fn: FunctionValue; line: number; column: number }[]
  rules: { left: string; right: string; fn: FunctionValue; line: number; column: number }[]
  tasks: { fn: FunctionValue; started: boolean; line: number; column: number }[]
  sleeping: {
    frame: { chunk: Chunk; ip: number; parentEnv: Environment; call: boolean; task: boolean }
    env: Environment
    call: { name: string; line: number; column: number }
    mode: 'time' | 'until'
    wake: number
  }[]
  ticks: number
  started: boolean
  line: number
  column: number
} {
  const shells = new Map<number, Environment>()
  for (const env of image.envs) {
    if (env.parent === null) {
      shells.set(env.id, globals)
      continue
    }
    const parent = shells.get(env.parent)
    if (!parent) throw new Error(`Environment ${env.id} has no parent`)
    shells.set(env.id, new Environment(parent, env.label))
  }
  const objects = new Map<number, object>()
  const byId = new Map<number, EntityValue>()
  const dec = (encoded: Encoded): Value =>
    decodeValue(encoded, dec, (id) => {
      const env = shells.get(id)
      if (!env) throw new Error(`Missing environment ${id}`)
      return env
    }, root, modules, resolveBuiltin, objects, byId)
  for (const encoded of image.ents) {
    if (encoded.t !== 'ent') continue
    byId.set(encoded.id, { type: 'entity', id: encoded.id, name: encoded.name, alive: encoded.alive, fields: {} })
  }
  for (const encoded of image.ents) {
    if (encoded.t !== 'ent') continue
    const entity = byId.get(encoded.id)
    if (!entity) continue
    for (const field of encoded.fields) entity.fields[field.k] = dec(field.v)
  }
  for (const env of image.envs) {
    const shell = shells.get(env.id)
    if (!shell) throw new Error(`Missing environment ${env.id}`)
    const existing = new Set(shell.entries().map(([name]) => name))
    for (const binding of env.bindings) {
      const value = dec(binding.value)
      if (existing.has(binding.name)) shell.assign(binding.name, value, { line: 1, column: 1 })
      else shell.define(binding.name, value, { line: 1, column: 1 })
    }
  }
  const env = shells.get(image.env)
  if (!env) throw new Error('Missing current environment')
  return {
    env,
    stack: image.stack.map(dec),
    result: dec(image.result),
    frames: image.frames.map((frame) => ({
      chunk: chunkAt(root, frame.path),
      ip: frame.ip,
      parentEnv: shells.get(frame.parent) ?? globals,
      call: frame.call,
      task: frame.task === true,
    })),
    handlers: image.handlers.flatMap((handler) => {
      const fn = dec(handler.fn)
      if (!isFunctionValue(fn)) return []
      return [{ event: handler.event, key: handler.key, fn, line: handler.line, column: handler.column }]
    }),
    rules: image.rules.flatMap((rule) => {
      const fn = dec(rule.fn)
      if (!isFunctionValue(fn)) return []
      return [{ left: rule.left, right: rule.right, fn, line: rule.line, column: rule.column }]
    }),
    tasks: image.tasks.flatMap((task) => {
      const fn = dec(task.fn)
      if (!isFunctionValue(fn)) return []
      return [{ fn, started: task.started, line: task.line, column: task.column }]
    }),
    sleeping: image.sleeping.map((sleep) => ({
      frame: {
        chunk: chunkAt(root, sleep.path),
        ip: sleep.ip,
        parentEnv: shells.get(sleep.parent) ?? globals,
        call: sleep.call,
        task: sleep.task,
      },
      env: shells.get(sleep.env) ?? globals,
      call: { name: sleep.name, line: sleep.line, column: sleep.column },
      mode: sleep.mode,
      wake: sleep.wake,
    })),
    ticks: image.ticks,
    started: image.started,
    line: image.line,
    column: image.column,
    entities: image.ents.flatMap((encoded) => {
      if (encoded.t !== 'ent') return []
      const entity = byId.get(encoded.id)
      return entity && entity.alive ? [entity] : []
    }),
  }
}

function encodeValue(
  value: Value,
  root: Chunk,
  enc: (value: Value) => Encoded,
  idOf: (env: Environment) => number,
  seen: Map<object, number>,
  fresh: () => number,
): Encoded {
  if (typeof value === 'number') return { t: 'num', v: value }
  if (typeof value === 'string') return { t: 'str', v: value }
  if (typeof value === 'boolean') return { t: 'bool', v: value }
  if (value === null) return { t: 'null' }
  if (isQuantity(value)) return { t: 'qty', v: value.value, px: value.unit.px, s: value.unit.s }
  if (isVec(value)) return { t: 'vec', x: enc(value.x), y: enc(value.y) }
  if (isEntity(value)) {
    if (seen.has(value)) return { t: 'eref', id: value.id }
    seen.set(value, value.id)
    return {
      t: 'ent',
      id: value.id,
      name: value.name,
      alive: value.alive,
      fields: Object.entries(value.fields).map(([key, field]) => ({ k: key, v: enc(field as Value) })),
    }
  }
  const shared = seen.get(value)
  if (shared !== undefined) return { t: 'ref', id: shared }
  if (value.type === 'array') {
    const id = fresh()
    seen.set(value, id)
    return { t: 'arr', id, items: value.items.map(enc) }
  }
  if (isMap(value)) {
    const id = fresh()
    seen.set(value, id)
    return { t: 'map', id, entries: value.entries.map((entry) => ({ k: entry.key, v: enc(entry.value as Value) })) }
  }
  if (isRecord(value)) {
    const id = fresh()
    seen.set(value, id)
    return {
      t: 'rec',
      id,
      name: value.name,
      fields: Object.entries(value.fields).map(([key, field]) => ({ k: key, v: enc(field as Value) })),
    }
  }
  if (isRecordType(value)) return { t: 'rtype', name: value.name, fields: [...value.fields] }
  if (isEntityType(value)) return { t: 'etype', name: value.name, fields: [...value.fields] }
  if (isModule(value)) return { t: 'mod', name: value.name }
  if (value.type === 'builtin') return { t: 'builtin', name: value.name }
  if (value.type === 'function') {
    if (!value.chunk) throw new Error(`Cannot snapshot tree-walker function ${value.name}`)
    return { t: 'fn', name: value.name, path: chunkPath(root, value.chunk), env: idOf(value.closure) }
  }
  return { t: 'null' }
}

function decodeValue(
  encoded: Encoded,
  dec: (encoded: Encoded) => Value,
  envAt: (id: number) => Environment,
  root: Chunk,
  modules: Host['modules'],
  resolveBuiltin: (name: string) => Value,
  objects: Map<number, object>,
  byId: Map<number, EntityValue>,
): Value {
  switch (encoded.t) {
    case 'num':
      return encoded.v
    case 'str':
      return encoded.v
    case 'bool':
      return encoded.v
    case 'null':
      return null
    case 'qty':
      return { type: 'quantity', value: encoded.v, unit: { px: encoded.px, s: encoded.s } }
    case 'vec':
      return { type: 'vec', x: dec(encoded.x) as number | { type: 'quantity'; value: number; unit: { px: number; s: number } }, y: dec(encoded.y) as number | { type: 'quantity'; value: number; unit: { px: number; s: number } } }
    case 'ref': {
      const found = objects.get(encoded.id)
      if (!found) throw new Error(`Missing value ${encoded.id}`)
      return found as Value
    }
    case 'arr': {
      const items: Value[] = []
      const array = { type: 'array' as const, items }
      objects.set(encoded.id, array)
      items.push(...encoded.items.map(dec))
      return array
    }
    case 'map': {
      const map = { type: 'map' as const, entries: [] as { key: string; value: unknown }[] }
      objects.set(encoded.id, map)
      map.entries.push(...encoded.entries.map((entry) => ({ key: entry.k, value: dec(entry.v) })))
      return map
    }
    case 'rec': {
      const record = { type: 'record' as const, name: encoded.name, fields: {} as Record<string, unknown> }
      objects.set(encoded.id, record)
      for (const field of encoded.fields) record.fields[field.k] = dec(field.v)
      return record
    }
    case 'rtype':
      return { type: 'recordType', name: encoded.name, fields: encoded.fields }
    case 'etype':
      return { type: 'entityType', name: encoded.name, fields: encoded.fields }
    case 'mod':
      return bindModule(modules, encoded.name, { line: 1, column: 1 })
    case 'builtin':
      return resolveBuiltin(encoded.name)
    case 'eref': {
      const found = byId.get(encoded.id)
      if (!found) throw new Error(`Missing entity ${encoded.id}`)
      return found
    }
    case 'ent': {
      let entity = byId.get(encoded.id)
      if (!entity) {
        entity = { type: 'entity', id: encoded.id, name: encoded.name, alive: encoded.alive, fields: {} }
        byId.set(encoded.id, entity)
      }
      for (const field of encoded.fields) entity.fields[field.k] = dec(field.v)
      return entity
    }
    case 'fn': {
      const chunk = chunkAt(root, encoded.path)
      const fn: FunctionValue = {
        type: 'function',
        name: encoded.name,
        params: chunk.params.map((name) => ({ name, line: 1, column: 1 })),
        body: null,
        chunk,
        closure: envAt(encoded.env),
      }
      return fn
    }
  }
}

function isFunctionValue(value: Value): value is FunctionValue {
  return typeof value === 'object' && value !== null && value.type === 'function'
}

function chunkPath(root: Chunk, target: Chunk): number[] {
  const path = findPath(root, target)
  if (!path) throw new Error(`Chunk ${target.name} is not in this program`)
  return path
}

function findPath(chunk: Chunk, target: Chunk): number[] | null {
  if (chunk === target) return []
  for (let i = 0; i < chunk.functions.length; i++) {
    const nested = findPath(chunk.functions[i], target)
    if (nested) return [i, ...nested]
  }
  return null
}

function chunkAt(root: Chunk, path: number[]): Chunk {
  let chunk = root
  for (const index of path) {
    const next = chunk.functions[index]
    if (!next) throw new Error(`Missing chunk at ${path.join('.')}`)
    chunk = next
  }
  return chunk
}
