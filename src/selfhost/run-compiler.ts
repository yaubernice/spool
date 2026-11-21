import type { Value } from '../interpreter.ts'
import { interpretVm } from '../vm.ts'
import { readCompileResult, type SpoolCompileResult } from './compile.ts'

/**
 * Run lexer.spool + parser.spool + compiler.spool on `source` inside the VM.
 * Strips trailing `tokenize` / `parse` / `compile` expressions, then ends with `compile(__source())`.
 */
export function runSpoolCompiler(
  lexerSource: string,
  parserSource: string,
  compilerSource: string,
  source: string,
): SpoolCompileResult {
  const lexerBody = lexerSource.replace(/\ntokenize\s*$/, '\n')
  const parserBody = parserSource.replace(/\nparse\s*$/, '\n')
  const compilerBody = compilerSource.replace(/\ncompile\s*$/, '\n')
  const program = `${lexerBody}${parserBody}${compilerBody}compile(__source())\n`
  const value = interpretVm(program, {
    maxSteps: 200_000_000,
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
  return readCompileResult(value as Value)
}
