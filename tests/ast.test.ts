import { describe, expect, it } from 'vitest'
import type { BlockStmt, Expr, Program, ReturnStmt } from '../src/ast.ts'

/** Stamp a source position onto a node. */
function at(line: number, column: number) {
  return { line, column }
}

function block(statements: BlockStmt['statements'], line: number, column: number): BlockStmt {
  return { type: 'BlockStmt', statements, ...at(line, column) }
}

describe('AST', () => {
  it('describes the square spiral as data', () => {
    const side: Expr = { type: 'VariableExpr', name: 's', ...at(2, 23) }

    // fn square(s) {
    //   repeat 4 { forward s  turn 90 }
    // }
    // repeat 36 {
    //   square(100)
    //   turn 10
    // }
    const program = {
      type: 'Program',
      ...at(1, 1),
      body: [
        {
          type: 'FnStmt',
          name: 'square',
          params: [{ name: 's', ...at(1, 11) }],
          body: block(
            [
              {
                type: 'RepeatStmt',
                count: { type: 'LiteralExpr', value: 4, ...at(2, 10) },
                body: block(
                  [
                    {
                      type: 'ExprStmt',
                      expression: {
                        type: 'CallExpr',
                        callee: { type: 'VariableExpr', name: 'forward', ...at(2, 15) },
                        args: [side],
                        ...at(2, 15),
                      },
                      ...at(2, 15),
                    },
                    {
                      type: 'ExprStmt',
                      expression: {
                        type: 'CallExpr',
                        callee: { type: 'VariableExpr', name: 'turn', ...at(2, 26) },
                        args: [{ type: 'LiteralExpr', value: 90, ...at(2, 31) }],
                        ...at(2, 26),
                      },
                      ...at(2, 26),
                    },
                  ],
                  2,
                  12,
                ),
                ...at(2, 3),
              },
            ],
            1,
            14,
          ),
          ...at(1, 1),
        },
        {
          type: 'RepeatStmt',
          count: { type: 'LiteralExpr', value: 36, ...at(4, 8) },
          body: block(
            [
              {
                type: 'ExprStmt',
                expression: {
                  type: 'CallExpr',
                  callee: { type: 'VariableExpr', name: 'square', ...at(5, 3) },
                  args: [{ type: 'LiteralExpr', value: 100, ...at(5, 10) }],
                  ...at(5, 3),
                },
                ...at(5, 3),
              },
              {
                type: 'ExprStmt',
                expression: {
                  type: 'CallExpr',
                  callee: { type: 'VariableExpr', name: 'turn', ...at(6, 3) },
                  args: [{ type: 'LiteralExpr', value: 10, ...at(6, 8) }],
                  ...at(6, 3),
                },
                ...at(6, 3),
              },
            ],
            4,
            12,
          ),
          ...at(4, 1),
        },
      ],
    } satisfies Program

    expect(program.body.map((stmt) => stmt.type)).toEqual(['FnStmt', 'RepeatStmt'])

    const square = program.body[0]
    expect(square.type).toBe('FnStmt')
    if (square.type !== 'FnStmt') return
    expect(square.params.map((param) => param.name)).toEqual(['s'])
    expect(square.body.statements[0].type).toBe('RepeatStmt')

    const outer = program.body[1]
    expect(outer.type).toBe('RepeatStmt')
    if (outer.type !== 'RepeatStmt') return
    expect(outer.count).toMatchObject({ type: 'LiteralExpr', value: 36 })
    expect(outer.body.statements).toHaveLength(2)
  })

  it('can hold the other statement and expression forms', () => {
    // let size = -50
    // if size > 0 and not done {
    //   while size > 0 { return size }
    // } else {
    //   print "small"
    // }
    const program = {
      type: 'Program',
      ...at(1, 1),
      body: [
        {
          type: 'LetStmt',
          name: 'size',
          value: {
            type: 'UnaryExpr',
            operator: '-',
            operand: { type: 'LiteralExpr', value: 50, ...at(1, 13) },
            ...at(1, 12),
          },
          ...at(1, 1),
        },
        {
          type: 'IfStmt',
          condition: {
            type: 'BinaryExpr',
            operator: 'and',
            left: {
              type: 'BinaryExpr',
              operator: '>',
              left: { type: 'VariableExpr', name: 'size', ...at(2, 4) },
              right: { type: 'LiteralExpr', value: 0, ...at(2, 11) },
              ...at(2, 9),
            },
            right: {
              type: 'UnaryExpr',
              operator: 'not',
              operand: { type: 'VariableExpr', name: 'done', ...at(2, 17) },
              ...at(2, 13),
            },
            ...at(2, 13),
          },
          thenBranch: block(
            [
              {
                type: 'WhileStmt',
                condition: {
                  type: 'BinaryExpr',
                  operator: '>',
                  left: { type: 'VariableExpr', name: 'size', ...at(3, 9) },
                  right: { type: 'LiteralExpr', value: 0, ...at(3, 16) },
                  ...at(3, 14),
                },
                body: block(
                  [
                    {
                      type: 'ReturnStmt',
                      value: { type: 'VariableExpr', name: 'size', ...at(3, 27) },
                      ...at(3, 20),
                    },
                  ],
                  3,
                  18,
                ),
                ...at(3, 3),
              },
            ],
            2,
            22,
          ),
          elseBranch: block(
            [
              {
                type: 'ExprStmt',
                expression: {
                  type: 'CallExpr',
                  callee: { type: 'VariableExpr', name: 'print', ...at(5, 3) },
                  args: [{ type: 'LiteralExpr', value: 'small', ...at(5, 9) }],
                  ...at(5, 3),
                },
                ...at(5, 3),
              },
            ],
            4,
            8,
          ),
          ...at(2, 1),
        },
      ],
    } satisfies Program

    expect(program.body.map((stmt) => stmt.type)).toEqual(['LetStmt', 'IfStmt'])
    const branch = program.body[1]
    expect(branch.type).toBe('IfStmt')
    if (branch.type !== 'IfStmt') return
    expect(branch.elseBranch?.statements[0].type).toBe('ExprStmt')
  })

  it('allows a bare return', () => {
    const statement = {
      type: 'ReturnStmt',
      value: null,
      ...at(1, 1),
    } satisfies ReturnStmt
    expect(statement.value).toBeNull()
  })
})
