import { describe, expect, it } from 'vitest'
import { LexError, ParseError, RuntimeError } from '../src/errors.ts'
import { interpret as interpretTree } from '../src/interpreter.ts'
import { tokenize } from '../src/lexer.ts'
import { parse, parseExpression } from '../src/parser.ts'
import { interpretVm } from '../src/vm.ts'

const engines = [interpretTree, interpretVm]

function reports(source: string): string[] {
  return engines.map((engine) => report(() => engine(source)))
}

function report(run: () => void): string {
  try {
    run()
  } catch (error) {
    if (error instanceof Error) return error.message
    throw error
  }
  throw new Error('expected an error')
}

describe('friendly errors', () => {
  it('points a caret at a runtime error', () => {
    const messages = reports('1 / 0')
    for (const message of messages) {
      expect(message).toBe(
        ['RuntimeError E0203: Division by zero (line 1, column 3)', ' 1 | 1 / 0', '   |   ^'].join('\n'),
      )
    }
    expect(() => interpretTree('1 / 0')).toThrow(RuntimeError)
  })

  it('shows the line that failed, not the line before it', () => {
    for (const message of reports('let x = 1\ny')) {
      expect(message).toBe(
        ["RuntimeError E0202: Undefined variable 'y' (line 2, column 1)", ' 2 | y', '   | ^'].join('\n'),
      )
    }
  })

  it('points a caret at a parse error past the end of the line', () => {
    const message = report(() => parse('1 +'))
    expect(message).toBe(
      [
        'ParseError E0105: Expected an expression, got end of input (line 1, column 4)',
        ' 1 | 1 +',
        '   |    ^',
      ].join('\n'),
    )
    expect(() => parse('1 +')).toThrow(ParseError)
  })

  it('points a caret at a character the lexer rejected', () => {
    const message = report(() => tokenize('let y = @'))
    expect(message).toBe(
      [
        "LexError E0001: Unexpected character '@' (line 1, column 9)",
        ' 1 | let y = @',
        '   |         ^',
      ].join('\n'),
    )
    expect(() => tokenize('let y = @')).toThrow(LexError)
  })

  it('keeps the caret aligned when a tab is one column', () => {
    for (const message of reports('1\t/\t0')) {
      expect(message).toBe(
        ['RuntimeError E0203: Division by zero (line 1, column 3)', ' 1 | 1 / 0', '   |   ^'].join('\n'),
      )
    }
  })

  it('still names the line and column when the line is empty', () => {
    const message = report(() => parseExpression(''))
    expect(message).toContain('ParseError E0105: Expected an expression, got end of input (line 1, column 1)')
    expect(message).toContain('| ^')
  })
})
