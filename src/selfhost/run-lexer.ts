import type { Value } from '../interpreter.ts'
import { interpretVm } from '../vm.ts'
import { readLexResult, type SpoolLexResult } from './lex.ts'

/** Run `selfhost/lexer.spool` on `source` inside the VM. Safe for workers. */
export function runSpoolLexer(lexerSource: string, source: string): SpoolLexResult {
  const body = lexerSource.replace(/\ntokenize\s*$/, '\n')
  const program = `${body}tokenize(__source())\n`
  const value = interpretVm(program, {
    maxSteps: 50_000_000,
    maxCallDepth: 2_000,
    builtins: {
      __source: () => source,
    },
  })
  return readLexResult(value as Value)
}
