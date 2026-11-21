import type { Pattern } from './ast.ts'
import { isQuantity, isRecord, isVec, sameUnit } from './data.ts'

export interface PatternBinding {
  name: string
  value: unknown
  line: number
  column: number
}

/**
 * Try one pattern against a value.
 * Returns the bindings when it matches, or null when it does not.
 * A failed pattern binds nothing.
 */
export function matchPattern(value: unknown, pattern: Pattern): PatternBinding[] | null {
  switch (pattern.type) {
    case 'wild':
      return []
    case 'bind':
      return [{ name: pattern.name, value, line: pattern.line, column: pattern.column }]
    case 'literal':
      return value === pattern.value ? [] : null
    case 'quantity':
      if (!isQuantity(value) || value.value !== pattern.value || !sameUnit(value.unit, pattern.unit)) return null
      return []
    case 'vec': {
      if (!isVec(value)) return null
      const x = matchPattern(value.x, pattern.x)
      if (!x) return null
      const y = matchPattern(value.y, pattern.y)
      if (!y) return null
      return [...x, ...y]
    }
    case 'record': {
      if (!isRecord(value) || value.name !== pattern.name) return null
      const bindings: PatternBinding[] = []
      for (const field of pattern.fields) {
        if (!Object.prototype.hasOwnProperty.call(value.fields, field.name)) return null
        const nested = matchPattern(value.fields[field.name], field.pattern)
        if (!nested) return null
        bindings.push(...nested)
      }
      return bindings
    }
  }
}
