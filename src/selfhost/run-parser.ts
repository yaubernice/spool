import type { Value } from '../interpreter.ts'
import { interpretVm } from '../vm.ts'
import { readParseResult, type SpoolParseResult } from './parse.ts'

/**
 * Run lexer.spool + parser.spool on `source` inside the VM.
 * Strips the trailing `tokenize` / `parse` expressions, then ends with `parse(__source())`.
 */
export function runSpoolParser(lexerSource: string, parserSource: string, source: string): SpoolParseResult {
  const lexerBody = lexerSource.replace(/\ntokenize\s*$/, '\n')
  const parserBody = parserSource.replace(/\nparse\s*$/, '\n')
  const program = `${lexerBody}${parserBody}parse(__source())\n`
  const value = interpretVm(program, {
    maxSteps: 50_000_000,
    maxCallDepth: 2_000,
    builtins: {
      __source: () => source,
      __number: (args) => {
        const text = args[0]
        if (typeof text !== 'string') throw new Error('__number expects a string')
        return Number(text)
      },
    },
  })
  return readParseResult(value as Value)
}
