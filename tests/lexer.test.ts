import { describe, expect, it } from 'vitest'
import { LexError } from '../src/errors.ts'
import { tokenize, type Token, type TokenType } from '../src/lexer.ts'

function types(source: string): TokenType[] {
  return tokenize(source).map((token) => token.type)
}

function lexemes(source: string): string[] {
  return tokenize(source)
    .filter((token) => token.type !== 'EOF')
    .map((token) => token.lexeme)
}

function find(source: string, lexeme: string): Token {
  const token = tokenize(source).find((item) => item.lexeme === lexeme)
  if (!token) throw new Error(`missing token ${lexeme}`)
  return token
}

describe('numbers', () => {
  it('reads integers and decimals', () => {
    const tokens = tokenize('50 3.14 0')
    expect(tokens.map((token) => token.literal)).toEqual([50, 3.14, 0, null])
    expect(types('50 3.14 0')).toEqual(['NUMBER', 'NUMBER', 'NUMBER', 'EOF'])
  })

  it('keeps unary minus as its own token', () => {
    expect(types('-50')).toEqual(['MINUS', 'NUMBER', 'EOF'])
    expect(tokenize('-50')[1].literal).toBe(50)
  })

  it('rejects a trailing decimal point', () => {
    expect(() => tokenize('1.')).toThrow(LexError)
    expect(() => tokenize('1.x')).toThrow(LexError)
  })
})

describe('identifiers', () => {
  it('reads names, including underscores and digits', () => {
    expect(types('size _x turn90')).toEqual([
      'IDENTIFIER',
      'IDENTIFIER',
      'IDENTIFIER',
      'EOF',
    ])
    expect(lexemes('size _x turn90')).toEqual(['size', '_x', 'turn90'])
  })

  it('leaves turtle commands as identifiers', () => {
    expect(types('forward back penup')).toEqual([
      'IDENTIFIER',
      'IDENTIFIER',
      'IDENTIFIER',
      'EOF',
    ])
  })
})

describe('operators', () => {
  it('reads arithmetic, comparison, and grouping tokens', () => {
    expect(types('+ - * / % = == != < > <= >= ( ) { } ,')).toEqual([
      'PLUS',
      'MINUS',
      'STAR',
      'SLASH',
      'PERCENT',
      'ASSIGN',
      'EQ',
      'NOT_EQ',
      'LT',
      'GT',
      'LTE',
      'GTE',
      'LPAREN',
      'RPAREN',
      'LBRACE',
      'RBRACE',
      'COMMA',
      'EOF',
    ])
  })

  it('does not split two-character operators', () => {
    expect(lexemes('== != <= >=')).toEqual(['==', '!=', '<=', '>='])
  })

  it('keeps a single = as assignment', () => {
    expect(types('= ==')).toEqual(['ASSIGN', 'EQ', 'EOF'])
  })
})

describe('keywords', () => {
  it('recognizes reserved words', () => {
    expect(types('let if else while repeat for in fn return and or not true false record match use')).toEqual([
      'LET',
      'IF',
      'ELSE',
      'WHILE',
      'REPEAT',
      'FOR',
      'IN',
      'FN',
      'RETURN',
      'AND',
      'OR',
      'NOT',
      'TRUE',
      'FALSE',
      'RECORD',
      'MATCH',
      'USE',
      'EOF',
    ])
  })

  it('does not treat a longer name as a keyword', () => {
    expect(types('letter note trueish')).toEqual(['IDENTIFIER', 'IDENTIFIER', 'IDENTIFIER', 'EOF'])
  })
})

describe('strings', () => {
  it('decodes a double-quoted string', () => {
    const token = tokenize('"hello"')[0]
    expect(token.type).toBe('STRING')
    expect(token.lexeme).toBe('"hello"')
    expect(token.literal).toBe('hello')
  })

  it('reads an empty string', () => {
    expect(tokenize('""')[0].literal).toBe('')
  })

  it('decodes escapes', () => {
    // Source text is: "say \"hi\"\n\t\\"
    const source = '"say \\"hi\\"\\n\\t\\\\"'
    expect(tokenize(source)[0].literal).toBe('say "hi"\n\t\\')
  })
})

describe('comments', () => {
  it('skips a comment to the end of the line', () => {
    expect(types('let x = 1 # ignore this\nlet y = 2')).toEqual([
      'LET',
      'IDENTIFIER',
      'ASSIGN',
      'NUMBER',
      'LET',
      'IDENTIFIER',
      'ASSIGN',
      'NUMBER',
      'EOF',
    ])
  })

  it('ignores a file that is only a comment', () => {
    expect(types('# nothing here')).toEqual(['EOF'])
  })

  it('allows a comment after code on the same line', () => {
    expect(lexemes('forward 10 # move')).toEqual(['forward', '10'])
  })
})

describe('position tracking', () => {
  it('records the column after leading spaces', () => {
    expect(find('  let', 'let')).toMatchObject({ line: 1, column: 3 })
  })

  it('starts each line at column 1', () => {
    const source = 'let x = 1\nlet y = 2'
    expect(find(source, 'x')).toMatchObject({ line: 1, column: 5 })
    expect(find(source, 'y')).toMatchObject({ line: 2, column: 5 })
  })

  it('places a token at the start of a two-character operator', () => {
    expect(find('a == b', '==')).toMatchObject({ line: 1, column: 3 })
  })

  it('puts EOF after the last character', () => {
    const tokens = tokenize('let')
    expect(tokens.at(-1)).toMatchObject({ type: 'EOF', line: 1, column: 4 })
  })

  it('puts EOF on the next line when the source ends in a newline', () => {
    const tokens = tokenize('let\n')
    expect(tokens.at(-1)).toMatchObject({ type: 'EOF', line: 2, column: 1 })
  })

  it('treats a Windows newline as one break', () => {
    expect(find('let\r\ny', 'y')).toMatchObject({ line: 2, column: 1 })
  })
})

describe('errors', () => {
  it('reports an unexpected character with line and column', () => {
    expect(() => tokenize('let y = @')).toThrow(LexError)
    try {
      tokenize('let y = @')
    } catch (error) {
      expect(error).toBeInstanceOf(LexError)
      expect((error as LexError).line).toBe(1)
      expect((error as LexError).column).toBe(9)
      expect((error as LexError).message).toContain("Unexpected character '@'")
    }
  })

  it('reports a bare !', () => {
    expect(() => tokenize('!')).toThrow(LexError)
    try {
      tokenize('!')
    } catch (error) {
      expect((error as LexError).column).toBe(1)
    }
  })

  it('reports an unterminated string at the opening quote', () => {
    try {
      tokenize('let s = "hi')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(LexError)
      expect((error as LexError).message).toContain('Unterminated string')
      expect((error as LexError).line).toBe(1)
      expect((error as LexError).column).toBe(9)
    }
  })

  it('reports an unknown escape', () => {
    try {
      tokenize('"\\q"')
      expect.unreachable()
    } catch (error) {
      expect((error as LexError).message).toContain("Unknown string escape '\\q'")
      expect((error as LexError).column).toBe(2)
    }
  })

  it('rejects a raw newline inside a string', () => {
    expect(() => tokenize('"hi\n"')).toThrow(LexError)
  })
})

describe('example program', () => {
  it('tokenizes the square spiral', () => {
    const source = `fn square(s) {
  repeat 4 { forward s  turn 90 }
}
repeat 36 {
  square(100)
  turn 10
}`
    expect(types(source)).toEqual([
      'FN',
      'IDENTIFIER',
      'LPAREN',
      'IDENTIFIER',
      'RPAREN',
      'LBRACE',
      'REPEAT',
      'NUMBER',
      'LBRACE',
      'IDENTIFIER',
      'IDENTIFIER',
      'IDENTIFIER',
      'NUMBER',
      'RBRACE',
      'RBRACE',
      'REPEAT',
      'NUMBER',
      'LBRACE',
      'IDENTIFIER',
      'LPAREN',
      'NUMBER',
      'RPAREN',
      'IDENTIFIER',
      'NUMBER',
      'RBRACE',
      'EOF',
    ])
    expect(find(source, 'square').line).toBe(1)
    expect(find(source, 'forward')).toMatchObject({ line: 2, column: 14 })
    expect(find(source, '100').literal).toBe(100)
  })
})
