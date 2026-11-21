import { describe, expect, it } from 'vitest'
import { compile } from '../src/compile.ts'
import { countInstructions, disassemble } from '../src/bytecode.ts'
import { RuntimeError } from '../src/errors.ts'
import { optimize } from '../src/optimize.ts'
import { parse } from '../src/parser.ts'
import { examples } from '../src/playground/examples.ts'
import { trace } from '../src/turtle.ts'
import { interpretVm } from '../src/vm.ts'

describe('optimizer', () => {
  it('folds constants and still returns the same value', () => {
    const source = '1 + 2 * 3'
    const raw = compile(parse(source))
    const folded = optimize(raw, { fold: true, dce: false })
    expect(countInstructions(folded)).toBeLessThan(countInstructions(raw))
    expect(disassemble(folded).some((row) => row.text.includes('CONST 7'))).toBe(true)
    expect(interpretVm(source, { optimize: { fold: true, dce: true } })).toBe(7)
    expect(interpretVm(source)).toBe(7)
  })

  it('drops the branch that a constant condition never takes', () => {
    const source = `if false {
  "no"
} else {
  2
}`
    const raw = compile(parse(source))
    const cleaned = optimize(raw, { fold: true, dce: true })
    const text = disassemble(cleaned)
      .map((row) => row.text)
      .join('\n')
    expect(text).not.toContain('"no"')
    expect(countInstructions(cleaned)).toBeLessThan(countInstructions(raw))
    expect(interpretVm(source, { optimize: { fold: true, dce: true } })).toBe(2)
  })

  it('keeps every gallery program working', () => {
    for (const example of examples) {
      if (example.code.includes('use draw')) continue
      const result = trace(example.code, (source, options) =>
        interpretVm(source, { ...options, optimize: { fold: true, dce: true } }),
      )
      const drew = result.strokes.some((stroke) => stroke.draw)
      expect(drew || result.prints.length > 0, example.name).toBe(true)
    }
  })

  it('leaves division by zero for the virtual machine', () => {
    expect(() => interpretVm('1 / 0', { optimize: { fold: true, dce: true } })).toThrow(RuntimeError)
    try {
      interpretVm('1 / 0', { optimize: { fold: true, dce: true } })
      expect.unreachable()
    } catch (error) {
      expect((error as RuntimeError).message).toContain('Division by zero')
      expect((error as RuntimeError).column).toBe(3)
    }
  })
})
