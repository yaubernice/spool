import type { SourceLocation } from './ast.ts'
import {
  isEntity,
  isQuantity,
  isVec,
  sameUnit,
  unitLabel,
  type EntityTypeValue,
  type EntityValue,
  type Unit,
  type VecValue,
} from './data.ts'
import { RuntimeError } from './errors.ts'

/**
 * Entities belong to the running program.
 * A circle is an entity with `r`. A rectangle has `w` and `h`.
 * `x` and `y` are the center. The same unit is required on every component.
 */

export class World {
  private nextId = 1
  readonly entities: EntityValue[] = []

  spawn(
    type: EntityTypeValue,
    x: unknown,
    y: unknown,
    pairs: { name: string; value: unknown }[],
    at: SourceLocation,
  ): EntityValue {
    const placed = new Set(type.fields.includes('pos') ? ['x', 'y', 'pos'] : ['x', 'y'])
    const required = type.fields.filter((name) => !placed.has(name))
    const given = new Map(pairs.map((pair) => [pair.name, pair.value]))
    if (given.size !== pairs.length) {
      const seen = new Set<string>()
      for (const pair of pairs) {
        if (seen.has(pair.name)) throw new RuntimeError('E0803', `Field '${pair.name}' is repeated`, at.line, at.column)
        seen.add(pair.name)
      }
    }
    for (const name of given.keys()) {
      if (placed.has(name)) {
        throw new RuntimeError('E0803', `Field '${name}' is set by at`, at.line, at.column)
      }
      if (!required.includes(name)) {
        throw new RuntimeError('E0803', `Entity ${type.name} has no field '${name}'`, at.line, at.column)
      }
    }
    for (const name of required) {
      if (!given.has(name)) {
        throw new RuntimeError('E0803', `Entity ${type.name} is missing field '${name}'`, at.line, at.column)
      }
    }
    const fields: Record<string, unknown> = { x, y }
    if (type.fields.includes('pos')) {
      const center: VecValue = { type: 'vec', x: x as VecValue['x'], y: y as VecValue['y'] }
      fields.pos = center
    }
    for (const name of required) fields[name] = given.get(name)
    const entity: EntityValue = { type: 'entity', id: this.nextId++, name: type.name, alive: true, fields }
    this.entities.push(entity)
    return entity
  }

  despawn(value: unknown, at: SourceLocation): void {
    if (!isEntity(value)) {
      throw new RuntimeError('E0804', 'Expected an entity', at.line, at.column)
    }
    if (!value.alive) {
      throw new RuntimeError('E0806', `Entity ${value.name}#${value.id} is already gone`, at.line, at.column)
    }
    value.alive = false
    const index = this.entities.indexOf(value)
    if (index >= 0) this.entities.splice(index, 1)
  }

  ofType(name: string): EntityValue[] {
    return this.entities.filter((entity) => entity.alive && entity.name === name)
  }

  replace(entities: EntityValue[]): void {
    this.entities.length = 0
    this.entities.push(...entities)
    this.nextId = entities.reduce((max, entity) => Math.max(max, entity.id), 0) + 1
  }
}

export function touchingPairs(
  world: World,
  left: string,
  right: string,
  at: SourceLocation,
): [EntityValue, EntityValue][] {
  const found: [EntityValue, EntityValue][] = []
  for (const a of world.ofType(left)) {
    for (const b of world.ofType(right)) {
      if (a.id === b.id) continue
      if (left === right && a.id > b.id) continue
      if (touches(a, b, at)) found.push([a, b])
    }
  }
  return found
}

function touches(left: EntityValue, right: EntityValue, at: SourceLocation): boolean {
  const a = shapeOf(left, at)
  const b = shapeOf(right, at)
  const parts = [...a.parts, ...b.parts]
  for (const part of parts) {
    if (!sameUnit(part.unit, parts[0].unit)) {
      throw new RuntimeError(
        'E0807',
        `Collision units do not match (${unitLabel(parts[0].unit)} and ${unitLabel(part.unit)})`,
        at.line,
        at.column,
      )
    }
  }
  if (a.kind === 'circle' && b.kind === 'circle') {
    return distance2(a.x - b.x, a.y - b.y) <= (a.r + b.r) * (a.r + b.r)
  }
  if (a.kind === 'rect' && b.kind === 'rect') {
    return Math.abs(a.x - b.x) <= (a.w + b.w) / 2 && Math.abs(a.y - b.y) <= (a.h + b.h) / 2
  }
  const circle = a.kind === 'circle' ? a : (b as Circle)
  const rect = a.kind === 'rect' ? a : (b as Rect)
  const nearestX = clamp(circle.x, rect.x - rect.w / 2, rect.x + rect.w / 2)
  const nearestY = clamp(circle.y, rect.y - rect.h / 2, rect.y + rect.h / 2)
  return distance2(circle.x - nearestX, circle.y - nearestY) <= circle.r * circle.r
}

interface Part {
  n: number
  unit: Unit
}

interface Circle {
  kind: 'circle'
  x: number
  y: number
  r: number
  parts: Part[]
}

interface Rect {
  kind: 'rect'
  x: number
  y: number
  w: number
  h: number
  parts: Part[]
}

function shapeOf(entity: EntityValue, at: SourceLocation): Circle | Rect {
  const has = (name: string) => Object.prototype.hasOwnProperty.call(entity.fields, name)
  const pos = entity.fields.pos
  const xRaw = isVec(pos) ? pos.x : entity.fields.x
  const yRaw = isVec(pos) ? pos.y : entity.fields.y
  if (xRaw === undefined || yRaw === undefined) {
    throw new RuntimeError('E0802', `Entity ${entity.name} has no position`, at.line, at.column)
  }
  const x = component(xRaw, `${entity.name}.x`, at)
  const y = component(yRaw, `${entity.name}.y`, at)
  if (has('r')) {
    const r = component(entity.fields.r, `${entity.name}.r`, at)
    return { kind: 'circle', x: x.n, y: y.n, r: r.n, parts: [x, y, r] }
  }
  if (has('w') && has('h')) {
    const w = component(entity.fields.w, `${entity.name}.w`, at)
    const h = component(entity.fields.h, `${entity.name}.h`, at)
    return { kind: 'rect', x: x.n, y: y.n, w: w.n, h: h.n, parts: [x, y, w, h] }
  }
  throw new RuntimeError('E0801', `Entity ${entity.name} has no collision shape`, at.line, at.column)
}

function component(value: unknown, label: string, at: SourceLocation): Part {
  if (typeof value === 'number') return { n: value, unit: { px: 0, s: 0 } }
  if (isQuantity(value)) return { n: value.value, unit: value.unit }
  throw new RuntimeError('E0802', `${label} must be a number or a quantity`, at.line, at.column)
}

function distance2(dx: number, dy: number): number {
  return dx * dx + dy * dy
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}
