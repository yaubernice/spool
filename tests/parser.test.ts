import { describe, expect, it } from 'vitest'
import type { Expr, Stmt } from '../src/ast.ts'
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

  it('rejects return outside a function', () => {
    try {
      parse('return 1')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError)
      expect((error as ParseError).message).toContain('return must be inside a function')
      expect((error as ParseError).column).toBe(1)
    }
  })
})

describe('functions and calls', () => {
  it('parses the square spiral', () => {
    const source = `fn square(s) {
  repeat 4 { forward s  turn 90 }
}
repeat 36 {
  square(100)
  turn 10
}`
    const program = parse(source)
    expect(program.body.map((statement) => statement.type)).toEqual(['FnStmt', 'RepeatStmt'])

    const fn = program.body[0]
    if (fn.type !== 'FnStmt') return
    expect(fn.name).toBe('square')
    expect(fn.params).toEqual([{ name: 's', line: 1, column: 11 }])

    const inner = fn.body.statements[0]
    if (inner.type !== 'RepeatStmt') return
    expect(inner.body.statements.map((statement) => callOf(statement))).toEqual([
      ['forward', ['s']],
      ['turn', [90]],
    ])

    const outer = program.body[1]
    if (outer.type !== 'RepeatStmt') return
    expect(outer.body.statements.map((statement) => callOf(statement))).toEqual([
      ['square', [100]],
      ['turn', [10]],
    ])
  })

  it('parses parameters, an empty list, and a returned call', () => {
    const program = parse(`fn add(a, b) {
  return a + b
}
fn zero() {
  return
}`)
    const add = program.body[0]
    const zero = program.body[1]
    if (add.type !== 'FnStmt' || zero.type !== 'FnStmt') throw new Error('expected functions')
    expect(add.params.map((param) => param.name)).toEqual(['a', 'b'])
    const returned = add.body.statements[0]
    if (returned.type !== 'ReturnStmt' || returned.value === null) throw new Error('expected return')
    expect(shape(returned.value)).toEqual(['a', '+', 'b'])
    expect(zero.params).toEqual([])
    expect(zero.body.statements[0]).toMatchObject({ type: 'ReturnStmt', value: null })
  })

  it('parses a call inside an expression', () => {
    expect(shape(parseExpression('square(1, 2 * 3)'))).toEqual(['square', [1, [2, '*', 3]]])
    expect(shape(parseExpression('fact(n - 1)'))).toEqual(['fact', [['n', '-', 1]]])
  })

  it('lets a command keep the following statement when it takes no arguments', () => {
    const program = parse('penup pendown')
    expect(program.body.map((statement) => callOf(statement))).toEqual([
      ['penup', []],
      ['pendown', []],
    ])
  })

  it('reads the fixed arguments of a command', () => {
    const program = parse('goto 10 + 1 20 print "red"')
    expect(program.body.map((statement) => callOf(statement))).toEqual([
      ['goto', [[10, '+', 1], 20]],
      ['print', ['red']],
    ])
  })

  it('uses the parenthesized form when a command is followed by (', () => {
    const program = parse('forward(s)')
    expect(program.body.map((statement) => callOf(statement))).toEqual([['forward', ['s']]])
  })

  it('does not turn a user function into a bare command', () => {
    const program = parse('square 100')
    expect(program.body).toHaveLength(2)
    const first = program.body[0]
    const second = program.body[1]
    if (first.type !== 'ExprStmt' || second.type !== 'ExprStmt') return
    expect(shape(first.expression)).toBe('square')
    expect(shape(second.expression)).toBe(100)
  })

  it('parses a recursive function', () => {
    const program = parse(`fn fact(n) {
  if n == 0 {
    return 1
  } else {
    return n * fact(n - 1)
  }
}`)
    const fn = program.body[0]
    if (fn.type !== 'FnStmt') return
    const branch = fn.body.statements[0]
    if (branch.type !== 'IfStmt' || branch.elseBranch === null) return
    const recursive = branch.elseBranch.statements[0]
    if (recursive.type !== 'ReturnStmt' || recursive.value === null) return
    expect(shape(recursive.value)).toEqual(['n', '*', ['fact', [['n', '-', 1]]]])
  })

  it('rejects a duplicate parameter and a missing parenthesis', () => {
    try {
      parse('fn f(a, a) { }')
      expect.unreachable()
    } catch (error) {
      expect((error as ParseError).message).toContain("Duplicate parameter 'a'")
    }
    expect(() => parse('fn square(s { }')).toThrow(ParseError)
    expect(() => parseExpression('square(1')).toThrow(ParseError)
  })
})

function callOf(statement: Stmt): unknown {
  if (statement.type !== 'ExprStmt') return statement.type
  return shape(statement.expression)
}
