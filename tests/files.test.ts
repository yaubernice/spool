import { describe, expect, it } from 'vitest'
import { nextUntitledName, tidyUserFiles, type UserFile } from '../src/playground/files.ts'

function file(name: string, code: string): UserFile {
  return { id: name, name, code }
}

describe('scratch files', () => {
  it('drops empty untitled copies and keeps a real file', () => {
    const cleaned = tidyUserFiles([
      file('untitled.spool', ''),
      file('untitled.spool', 's=1'),
      file('untitled.spool', 'print "hello"\n'),
      file('untitled.spool', 'print "hello"\n'),
      file('pong-copy.spool', 'print "hello"\n'),
      file('notes.spool', 'let n = 1\n'),
    ])
    expect(cleaned.map((item) => item.name)).toEqual(['untitled.spool', 'pong-copy.spool', 'notes.spool'])
  })

  it('names a new file untitled-1, then untitled-2', () => {
    expect(nextUntitledName([])).toBe('untitled-1.spool')
    expect(nextUntitledName([{ name: 'untitled-1.spool' }, { name: 'untitled-3.spool' }])).toBe('untitled-2.spool')
  })
})
