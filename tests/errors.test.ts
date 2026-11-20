import { describe, expect, it } from 'vitest'
import { LexError, ParseError, RuntimeError } from '../src/errors.ts'
import { interpret } from '../src/interpreter.ts'
import { tokenize } from '../src/lexer.ts'
import { parse, parseExpression } from '../src/parser.ts'

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
    const message = report(() => interpret('1 / 0'))
    expect(message).toBe(
      ['RuntimeError: Division by zero (line 1, column 3)', ' 1 | 1 / 0', '   |   ^'].join('\n'),
    )
    expect(() => interpret('1 / 0')).toThrow(RuntimeError)
  })

  it('shows the line that failed, not the line before it', () => {
    const message = report(() => interpret('let x = 1\ny'))
    expect(message).toBe(
      ["RuntimeError: Undefined variable 'y' (line 2, column 1)", ' 2 | y', '   | ^'].join('\n'),
    )
  })

  it('points a caret at a parse error past the end of the line', () => {
    const message = report(() => parse('1 +'))
    expect(message).toBe(
      [
        'ParseError: Expected an expression, got end of input (line 1, column 4)',
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
        "LexError: Unexpected character '@' (line 1, column 9)",
        ' 1 | let y = @',
        '   |         ^',
      ].join('\n'),
    )
    expect(() => tokenize('let y = @')).toThrow(LexError)
  })

  it('keeps the caret aligned when a tab is one column', () => {
    const message = report(() => interpret('1\t/\t0'))
    expect(message).toBe(
      ['RuntimeError: Division by zero (line 1, column 3)', ' 1 | 1 / 0', '   |   ^'].join('\n'),
    )
  })

  it('still names the line and column when the line is empty', () => {
    const message = report(() => parseExpression(''))
    expect(message).toContain('ParseError: Expected an expression, got end of input (line 1, column 1)')
    expect(message).toContain('| ^')
  })
})
