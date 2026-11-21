/**
 * Values the language adds on top of numbers, strings, and booleans:
 * quantities with units, vecs, maps, and records.
 *
 * Both the tree-walker and the VM call these helpers, so a unit mismatch
 * or a vec sum is the same error on either backend.
 */

export interface Unit {
  px: number
  s: number
}

export interface Quantity {
  type: 'quantity'
  value: number
  unit: Unit
}

export interface VecValue {
  type: 'vec'
  x: number | Quantity
  y: number | Quantity
}

export interface MapValue {
  type: 'map'
  entries: { key: string; value: unknown }[]
}

export interface RecordTypeValue {
  type: 'recordType'
  name: string
  fields: string[]
}

export interface RecordValue {
  type: 'record'
  name: string
  fields: Record<string, unknown>
}

/** A host module bound by `use`. Fields are the module's callables. */
export interface ModuleValue {
  type: 'module'
  name: string
  fields: Record<string, unknown>
}

export type Fail = { status: 'fail'; code: string; detail: string }

export type ArithResult =
  | { status: 'value'; value: number | boolean | Quantity | VecValue }
  | Fail
  | { status: 'skip' }

export type FieldResult = { status: 'value'; value: unknown } | Fail

export type StoreResult = { status: 'ok' } | Fail

type Scalar = number | Quantity
type ArithOp = '+' | '-' | '*' | '/' | '<' | '>' | '<=' | '>='

export function quantity(value: number, unit: Unit): Quantity {
  return { type: 'quantity', value, unit: { px: unit.px, s: unit.s } }
}

export function unitFromSuffix(suffix: string): Unit {
  if (suffix === 'px') return { px: 1, s: 0 }
  if (suffix === 's') return { px: 0, s: 1 }
  if (suffix === 'px/s') return { px: 1, s: -1 }
  return { px: 0, s: 0 }
}

export function isQuantity(value: unknown): value is Quantity {
  return typeof value === 'object' && value !== null && (value as { type?: string }).type === 'quantity'
}

export function isVec(value: unknown): value is VecValue {
  return typeof value === 'object' && value !== null && (value as { type?: string }).type === 'vec'
}

export function isMap(value: unknown): value is MapValue {
  return typeof value === 'object' && value !== null && (value as { type?: string }).type === 'map'
}

export function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && (value as { type?: string }).type === 'record'
}

export function isModule(value: unknown): value is ModuleValue {
  return typeof value === 'object' && value !== null && (value as { type?: string }).type === 'module'
}

export function isRecordType(value: unknown): value is RecordTypeValue {
  return typeof value === 'object' && value !== null && (value as { type?: string }).type === 'recordType'
}

export function isArrayValue(value: unknown): value is { type: 'array'; items: unknown[] } {
  return typeof value === 'object' && value !== null && (value as { type?: string }).type === 'array'
}

export function sameUnit(left: Unit, right: Unit): boolean {
  return left.px === right.px && left.s === right.s
}

/** A plain number has no unit. A quantity uses its exponents. */
export function unitOf(value: Scalar): Unit {
  return typeof value === 'number' ? { px: 0, s: 0 } : value.unit
}

export function formatUnit(unit: Unit): string {
  const named = [
    { name: 'px', exp: unit.px },
    { name: 's', exp: unit.s },
  ]
  const num: string[] = []
  const den: string[] = []
  for (const part of named) {
    if (part.exp === 0) continue
    const token = Math.abs(part.exp) === 1 ? part.name : `${part.name}^${Math.abs(part.exp)}`
    if (part.exp > 0) num.push(token)
    else den.push(token)
  }
  if (num.length === 0 && den.length === 0) return ''
  const top = num.length === 0 ? '1' : num.join('*')
  return den.length === 0 ? top : `${top}/${den.join('*')}`
}

export function formatQuantity(value: Quantity): string {
  return `${formatNumber(value.value)}${formatUnit(value.unit)}`
}

export function unitLabel(unit: Unit): string {
  const text = formatUnit(unit)
  return text === '' ? 'a number' : text
}

/** A short phrase for error messages. Keeps the wording the older types already used. */
export function valueLabel(value: unknown): string {
  if (value === null) return 'nothing'
  if (typeof value === 'number') return 'a number'
  if (typeof value === 'string') return 'a string'
  if (typeof value === 'boolean') return 'a boolean'
  if (isQuantity(value)) return `a ${unitLabel(value.unit)} quantity`
  if (isVec(value)) return 'a vec'
  if (isMap(value)) return 'a map'
  if (isRecord(value)) return `a ${value.name}`
  if (isRecordType(value)) return `record ${value.name}`
  if (isModule(value)) return `module ${value.name}`
  if (isArrayValue(value)) return 'an array'
  if (typeof value === 'object' && value !== null && 'type' in value) {
    const kind = value as { type?: string; name?: string }
    if (kind.type === 'function') {
      return kind.name && kind.name !== '(anonymous)' ? `the function ${kind.name}` : 'a function'
    }
    if (kind.type === 'builtin') return `the built-in ${kind.name ?? 'function'}`
  }
  return 'a value'
}

export function formatNumber(value: number): string {
  if (Object.is(value, -0)) return '0'
  return String(value)
}

function magnitude(value: Scalar): number {
  return typeof value === 'number' ? value : value.value
}

function isScalar(value: unknown): value is Scalar {
  return typeof value === 'number' || isQuantity(value)
}

function pack(value: number, unit: Unit): number | Quantity {
  if (unit.px === 0 && unit.s === 0) return value
  return quantity(value, unit)
}

function addExp(left: Unit, right: Unit): Unit {
  return { px: left.px + right.px, s: left.s + right.s }
}

function subExp(left: Unit, right: Unit): Unit {
  return { px: left.px - right.px, s: left.s - right.s }
}

function mismatch(op: string, left: Scalar, right: Scalar): ArithResult {
  return {
    status: 'fail',
    code: 'E0216',
    detail: `Units do not match for '${op}' (${unitLabel(unitOf(left))} and ${unitLabel(unitOf(right))})`,
  }
}

function fail(code: string, detail: string): Fail {
  return { status: 'fail', code, detail }
}

/**
 * `+ - * /` and the ordered comparisons.
 * `skip` means "this pair is not a quantity or a vec"; the caller uses the
 * older number and string rules.
 */
export function applyOp(op: ArithOp, left: unknown, right: unknown): ArithResult {
  if (isVec(left) || isVec(right)) return applyVec(op, left, right)
  if (!isScalar(left) || !isScalar(right)) return { status: 'skip' }
  if (op === '+' || op === '-') {
    if (!sameUnit(unitOf(left), unitOf(right))) return mismatch(op, left, right)
    const value = op === '+' ? magnitude(left) + magnitude(right) : magnitude(left) - magnitude(right)
    return { status: 'value', value: pack(value, unitOf(left)) }
  }
  if (op === '*') {
    return { status: 'value', value: pack(magnitude(left) * magnitude(right), addExp(unitOf(left), unitOf(right))) }
  }
  if (op === '/') {
    if (magnitude(right) === 0) return fail('E0203', 'Division by zero')
    return { status: 'value', value: pack(magnitude(left) / magnitude(right), subExp(unitOf(left), unitOf(right))) }
  }
  if (!sameUnit(unitOf(left), unitOf(right))) return mismatch(op, left, right)
  const a = magnitude(left)
  const b = magnitude(right)
  const value = op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b
  return { status: 'value', value }
}

function applyVec(op: ArithOp, left: unknown, right: unknown): ArithResult {
  if (op === '<' || op === '>' || op === '<=' || op === '>=') return { status: 'skip' }
  if (op === '+' || op === '-') {
    if (!isVec(left) || !isVec(right)) return fail('E0219', `'${op}' expects two vecs`)
    const x = applyOp(op, left.x, right.x)
    if (x.status !== 'value') return x
    const y = applyOp(op, left.y, right.y)
    if (y.status !== 'value') return y
    return { status: 'value', value: { type: 'vec', x: x.value as Scalar, y: y.value as Scalar } }
  }
  const vec = isVec(left) ? left : isVec(right) ? right : null
  const scalar = vec === left ? right : left
  if (!vec || !isScalar(scalar)) return fail('E0218', `'${op}' expects a vec and a scalar`)
  if (op === '*' && !isVec(left) && isVec(right)) {
    return scaleVec(right, scalar, false)
  }
  if (op === '*') return scaleVec(vec, scalar, false)
  if (op === '/' && isVec(left) && isScalar(right)) return scaleVec(left, right, true)
  return fail('E0218', `'${op}' expects a vec and a scalar`)
}

function scaleVec(vec: VecValue, scalar: Scalar, divide: boolean): ArithResult {
  const x = scale(vec.x, scalar, divide)
  if (x.status !== 'value') return x
  const y = scale(vec.y, scalar, divide)
  if (y.status !== 'value') return y
  return { status: 'value', value: { type: 'vec', x: x.value as Scalar, y: y.value as Scalar } }
}

function scale(component: Scalar, scalar: Scalar, divide: boolean): ArithResult {
  if (divide && magnitude(scalar) === 0) return fail('E0203', 'Division by zero')
  const value = divide ? magnitude(component) / magnitude(scalar) : magnitude(component) * magnitude(scalar)
  const unit = divide ? subExp(unitOf(component), unitOf(scalar)) : addExp(unitOf(component), unitOf(scalar))
  return { status: 'value', value: pack(value, unit) }
}

export function negate(value: unknown): ArithResult {
  if (typeof value === 'number') return { status: 'value', value: -value }
  if (isQuantity(value)) return { status: 'value', value: quantity(-value.value, value.unit) }
  if (isVec(value)) {
    const x = negate(value.x)
    const y = negate(value.y)
    if (x.status !== 'value' || y.status !== 'value') return { status: 'skip' }
    return { status: 'value', value: { type: 'vec', x: x.value as Scalar, y: y.value as Scalar } }
  }
  return { status: 'skip' }
}

/** Quantities and vecs compare by value. Anything else returns null so the caller can use identity. */
export function sameData(left: unknown, right: unknown): boolean | null {
  if (typeof left === 'number' && typeof right === 'number') return left === right
  if (isQuantity(left) || isQuantity(right)) {
    if (!isQuantity(left) || !isQuantity(right)) return false
    return left.value === right.value && sameUnit(left.unit, right.unit)
  }
  if (isVec(left) || isVec(right)) {
    if (!isVec(left) || !isVec(right)) return false
    const x = sameData(left.x, right.x)
    const y = sameData(left.y, right.y)
    if (x === null || y === null) return false
    return x && y
  }
  return null
}

export function componentUnit(value: unknown): Unit | null {
  if (typeof value === 'number') return { px: 0, s: 0 }
  if (isQuantity(value)) return value.unit
  return null
}

/**
 * The items a `for x in collection` loop visits, in order.
 * Arrays yield their items, strings yield characters, maps yield keys.
 */
export function collectionItems(value: unknown): unknown[] | null {
  if (isArrayValue(value)) return [...value.items]
  if (typeof value === 'string') return [...value]
  if (isMap(value)) return value.entries.map((entry) => entry.key)
  return null
}

export function mapGet(map: MapValue, key: string): unknown | undefined {
  const found = map.entries.find((entry) => entry.key === key)
  return found ? found.value : undefined
}

export function mapSet(map: MapValue, key: string, value: unknown): void {
  const found = map.entries.find((entry) => entry.key === key)
  if (found) found.value = value
  else map.entries.push({ key, value })
}

export function getField(target: unknown, name: string): FieldResult {
  if (isVec(target)) {
    if (name !== 'x' && name !== 'y') return fail('E0222', `vec has no field '${name}'`)
    return { status: 'value', value: name === 'x' ? target.x : target.y }
  }
  if (isRecord(target)) {
    if (!Object.prototype.hasOwnProperty.call(target.fields, name)) {
      return fail('E0222', `Record ${target.name} has no field '${name}'`)
    }
    return { status: 'value', value: target.fields[name] }
  }
  if (isModule(target)) {
    if (!Object.prototype.hasOwnProperty.call(target.fields, name)) {
      return fail('E0602', `Module '${target.name}' has no '${name}'`)
    }
    return { status: 'value', value: target.fields[name] }
  }
  return fail('E0223', `Expected a record or a vec, but got ${valueLabel(target)}`)
}

export function setField(target: unknown, name: string, value: unknown): StoreResult {
  if (isVec(target)) {
    if (name !== 'x' && name !== 'y') return fail('E0222', `vec has no field '${name}'`)
    const unit = componentUnit(value)
    if (!unit) return fail('E0217', `vec components must be numbers or quantities, but got ${valueLabel(value)}`)
    const other = name === 'x' ? target.y : target.x
    if (!sameUnit(unit, unitOf(other))) {
      return fail('E0217', `vec components must share a unit (${unitLabel(unit)} and ${unitLabel(unitOf(other))})`)
    }
    if (name === 'x') target.x = value as Scalar
    else target.y = value as Scalar
    return { status: 'ok' }
  }
  if (isRecord(target)) {
    if (!Object.prototype.hasOwnProperty.call(target.fields, name)) {
      return fail('E0222', `Record ${target.name} has no field '${name}'`)
    }
    target.fields[name] = value
    return { status: 'ok' }
  }
  if (isModule(target)) return fail('E0603', `Cannot assign to module '${target.name}'`)
  return fail('E0223', `Expected a record or a vec, but got ${valueLabel(target)}`)
}

export function makeRecord(type: unknown, pairs: { name: string; value: unknown }[]): FieldResult {
  if (!isRecordType(type)) return fail('E0227', `Expected a record type, but got ${valueLabel(type)}`)
  const given = new Map(pairs.map((pair) => [pair.name, pair.value]))
  if (given.size !== pairs.length) {
    const seen = new Set<string>()
    for (const pair of pairs) {
      if (seen.has(pair.name)) return fail('E0222', `Field '${pair.name}' is repeated`)
      seen.add(pair.name)
    }
  }
  for (const name of given.keys()) {
    if (!type.fields.includes(name)) return fail('E0222', `Record ${type.name} has no field '${name}'`)
  }
  const fields: Record<string, unknown> = {}
  for (const name of type.fields) {
    if (!given.has(name)) return fail('E0222', `Record ${type.name} is missing field '${name}'`)
    fields[name] = given.get(name)
  }
  return { status: 'value', value: { type: 'record', name: type.name, fields } }
}
