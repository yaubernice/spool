import { describe, expect, it } from 'vitest'
import type { Expr } from '../src/ast.ts'
import { ParseError } from '../src/errors.ts'
import { parse, parseExpression } from '../src/parser.ts'

/** Collapse a tree into a nested list so precedence is easy to see. */
function shape(expr: Expr): unknown {
  switch (expr.type) {
    case 'LiteralExpr':
      return expr.value
    case 'VariableExpr':
      return expr.name
    case 'UnaryExpr':
      return [expr.operator, shape(expr.operand)]
    case 'BinaryExpr':
      return [shape(expr.left), expr.operator, shape(expr.right)]
    case 'CallExpr':
      return [expr.callee, expr.args.map(shape)]
  }
}

describe('literals and variables', () => {
  it('reads numbers, strings, and names', () => {
    expect(shape(parseExpression('50'))).toBe(50)
    expect(shape(parseExpression('3.14'))).toBe(3.14)
    expect(shape(parseExpression('"red"'))).toBe('red')
    expect(shape(parseExpression('size'))).toBe('size')
  })

  it('keeps the decoded string value', () => {
    expect(shape(parseExpression('"a\\nb"'))).toBe('a\nb')
  })

  it('ignores comments and extra space', () => {
    expect(shape(parseExpression('1 + # keep going\n2'))).toEqual([1, '+', 2])
  })
})

describe('precedence', () => {
  it('binds * tighter than +', () => {
    expect(shape(parseExpression('1 + 2 * 3'))).toEqual([1, '+', [2, '*', 3]])
    expect(shape(parseExpression('2 * 3 + 4'))).toEqual([[2, '*', 3], '+', 4])
  })

  it('treats * / % as the same level, left to right', () => {
    expect(shape(parseExpression('8 / 2 / 2'))).toEqual([[8, '/', 2], '/', 2])
    expect(shape(parseExpression('10 % 4 * 2'))).toEqual([[10, '%', 4], '*', 2])
  })

  it('treats + and - as the same level, left to right', () => {
    expect(shape(parseExpression('10 - 3 - 2'))).toEqual([[10, '-', 3], '-', 2])
  })

  it('binds arithmetic tighter than comparisons', () => {
    expect(shape(parseExpression('1 + 2 < 3 * 4'))).toEqual([[1, '+', 2], '<', [3, '*', 4]])
  })

  it('binds comparisons tighter than and, and and tighter than or', () => {
    expect(shape(parseExpression('1 < 2 and 3 > 4'))).toEqual([[1, '<', 2], 'and', [3, '>', 4]])
    expect(shape(parseExpression('1 or 0 and 0'))).toEqual([1, 'or', [0, 'and', 0]])
  })

  it('lets parentheses override precedence', () => {
    expect(shape(parseExpression('(1 + 2) * 3'))).toEqual([[1, '+', 2], '*', 3])
    expect(shape(parseExpression('((size))'))).toBe('size')
  })
})

describe('prefix operators', () => {
  it('parses unary minus tighter than multiplication', () => {
    expect(shape(parseExpression('-2 * 3'))).toEqual([['-', 2], '*', 3])
    expect(shape(parseExpression('2 * -3'))).toEqual([2, '*', ['-', 3]])
    expect(shape(parseExpression('-(2 + 3)'))).toEqual(['-', [2, '+', 3]])
  })

  it('parses not looser than comparisons and tighter than and', () => {
    expect(shape(parseExpression('not 1 == 2'))).toEqual(['not', [1, '==', 2]])
    expect(shape(parseExpression('not done and ready'))).toEqual([['not', 'done'], 'and', 'ready'])
  })

  it('stacks prefix operators', () => {
    expect(shape(parseExpression('not not done'))).toEqual(['not', ['not', 'done']])
    expect(shape(parseExpression('--1'))).toEqual(['-', ['-', 1]])
  })
})

describe('locations', () => {
  it('points a binary expression at the operator', () => {
    expect(parseExpression('1 + 2')).toMatchObject({
      type: 'BinaryExpr',
      line: 1,
      column: 3,
    })
  })

  it('points a prefix expression at the operator', () => {
    const expr = parseExpression('not size')
    expect(expr).toMatchObject({ type: 'UnaryExpr', line: 1, column: 1 })
  })

  it('keeps the literal position inside parentheses', () => {
    const expr = parseExpression('( 50 )')
    expect(expr).toMatchObject({ type: 'LiteralExpr', value: 50, column: 3 })
  })
})

describe('parse errors', () => {
  it('reports an empty input', () => {
    try {
      parseExpression('')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError)
      expect((error as ParseError).message).toContain('Expected an expression')
      expect((error as ParseError).line).toBe(1)
      expect((error as ParseError).column).toBe(1)
    }
  })

  it('reports a missing right-hand side', () => {
    try {
      parseExpression('1 +')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError)
      expect((error as ParseError).message).toContain('Expected an expression')
      expect((error as ParseError).column).toBe(4)
    }
  })

  it('reports a missing closing parenthesis', () => {
    try {
      parseExpression('(1 + 2')
      expect.unreachable()
    } catch (error) {
      expect((error as ParseError).message).toContain("Expected ')'")
      expect((error as ParseError).line).toBe(1)
      expect((error as ParseError).column).toBe(7)
    }
  })

  it('reports leftover tokens', () => {
    try {
      parseExpression('1 2')
      expect.unreachable()
    } catch (error) {
      expect((error as ParseError).message).toContain("Unexpected token '2'")
      expect((error as ParseError).column).toBe(3)
    }
  })

  it('reports an error on a later line', () => {
    try {
      parseExpression('1 +\n*')
      expect.unreachable()
    } catch (error) {
      expect((error as ParseError).line).toBe(2)
      expect((error as ParseError).column).toBe(1)
    }
  })
})

describe('statements', () => {
  it('parses an empty program', () => {
    expect(parse('')).toMatchObject({ type: 'Program', body: [], line: 1, column: 1 })
    expect(parse('# nothing\n')).toMatchObject({ type: 'Program', body: [] })
  })

  it('parses let with an expression value', () => {
    const program = parse('let size = 1 + 2 * 3')
    expect(program.body).toMatchObject([
      {
        type: 'LetStmt',
        name: 'size',
        line: 1,
        column: 1,
        value: { type: 'BinaryExpr', operator: '+' },
      },
    ])
    const statement = program.body[0]
    if (statement.type !== 'LetStmt') return
    expect(shape(statement.value)).toEqual([1, '+', [2, '*', 3]])
  })

  it('parses several statements, including two on one line', () => {
    const program = parse('let a = 1 let b = a + 1\nsize')
    expect(program.body.map((statement) => statement.type)).toEqual([
      'LetStmt',
      'LetStmt',
      'ExprStmt',
    ])
    const last = program.body[2]
    if (last.type !== 'ExprStmt') return
    expect(shape(last.expression)).toBe('size')
  })

  it('parses if, else, while, and repeat', () => {
    const source = `let size = 50
while size > 0 {
  repeat 1 + 2 {
    let step = size
  }
}
if size == 0 {
  let done = 1
} else {
  let done = 0
}`
    const program = parse(source)
    expect(program.body.map((statement) => statement.type)).toEqual([
      'LetStmt',
      'WhileStmt',
      'IfStmt',
    ])

    const loop = program.body[1]
    if (loop.type !== 'WhileStmt') return
    expect(shape(loop.condition)).toEqual(['size', '>', 0])
    expect(loop.body.statements[0].type).toBe('RepeatStmt')
    const repeat = loop.body.statements[0]
    if (repeat.type !== 'RepeatStmt') return
    expect(shape(repeat.count)).toEqual([1, '+', 2])
    expect(repeat.body.statements).toMatchObject([{ type: 'LetStmt', name: 'step' }])

    const branch = program.body[2]
    if (branch.type !== 'IfStmt') return
    expect(branch.elseBranch?.statements).toMatchObject([{ type: 'LetStmt', name: 'done' }])
  })

  it('allows an empty block', () => {
    const program = parse('if 1 { }')
    const statement = program.body[0]
    if (statement.type !== 'IfStmt') throw new Error('expected if')
    expect(statement.thenBranch.statements).toEqual([])
    expect(statement.elseBranch).toBeNull()
  })

  it('points a later statement at its own line', () => {
    const program = parse('# comment\nlet size = 1')
    expect(program.body[0]).toMatchObject({ type: 'LetStmt', line: 2, column: 1 })
  })

  it('rejects a let with no name or no equals', () => {
    expect(() => parse('let = 1')).toThrow(ParseError)
    try {
      parse('let x 1')
      expect.unreachable()
    } catch (error) {
      expect((error as ParseError).message).toContain("Expected '='")
      expect((error as ParseError).column).toBe(7)
    }
  })

  it('rejects a missing block', () => {
    try {
      parse('while size')
      expect.unreachable()
    } catch (error) {
      expect((error as ParseError).message).toContain("Expected '{'")
    }
  })

  it('rejects an unclosed block', () => {
    try {
      parse('repeat 4 { let x = 1')
      expect.unreachable()
    } catch (error) {
      expect((error as ParseError).message).toContain("Expected '}'")
    }
  })

  it('rejects else that is not attached to an if', () => {
    expect(() => parse('else { }')).toThrow(ParseError)
    try {
      parse('if 1 { else { } }')
      expect.unreachable()
    } catch (error) {
      expect((error as ParseError).message).toContain("Expected '}' before 'else'")
      expect((error as ParseError).column).toBe(8)
    }
  })

  it('rejects fn and return until functions are parsed', () => {
    expect(() => parse('fn square(s) { }')).toThrow(ParseError)
    expect(() => parse('return 1')).toThrow(ParseError)
  })
})
