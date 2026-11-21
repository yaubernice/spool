import type { Chunk } from './bytecode.ts'
import {
  isMap,
  isModule,
  isQuantity,
  isRecord,
  isRecordType,
  isVec,
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
  frames: { path: number[]; ip: number; parent: number; call: boolean }[]
  calls: { name: string; line: number; column: number }[]
  envs: EnvImage[]
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
  frames: { chunk: Chunk; ip: number; parentEnv: Environment; call: boolean }[]
  calls: { name: string; line: number; column: number }[]
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
  const visit = (value: Value): void => {
    if (value === null || typeof value !== 'object') return
    if (value.type === 'function') idOf(value.closure)
    if (value.type === 'array') value.items.forEach(visit)
    else if (isMap(value)) value.entries.forEach((entry) => visit(entry.value as Value))
    else if (isRecord(value)) Object.values(value.fields).forEach((field) => visit(field as Value))
    else if (isVec(value)) {
      visit(value.x)
      visit(value.y)
    }
  }
  const pending = [view.result, ...view.stack]
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
    })),
    calls: view.calls.map((frame) => ({ ...frame })),
    envs,
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
  frames: { chunk: Chunk; ip: number; parentEnv: Environment; call: boolean }[]
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
  const dec = (encoded: Encoded): Value =>
    decodeValue(encoded, dec, (id) => {
      const env = shells.get(id)
      if (!env) throw new Error(`Missing environment ${id}`)
      return env
    }, root, modules, resolveBuiltin, objects)
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
    })),
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
    case 'mod':
      return bindModule(modules, encoded.name, { line: 1, column: 1 })
    case 'builtin':
      return resolveBuiltin(encoded.name)
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
