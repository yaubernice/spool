import { describe, expect, it } from 'vitest'
import { gamePage } from '../src/export.ts'

describe('export', () => {
  it('embeds the program and the runtime in one page', () => {
    const page = gamePage('print "hi"\n', 'console.log("player")')
    expect(page).toContain('type="text/spool"')
    expect(page).toContain('print "hi"')
    expect(page).toContain('console.log("player")')
    expect(page).toContain('id="stage"')
  })

  it('does not let the program close the script tag', () => {
    const page = gamePage('let s = "</script><script>alert(1)</script>"', 'let x = 1')
    const closers = page.match(/<\/script/gi) ?? []
    expect(closers).toHaveLength(2)
    expect(page).toContain('<\\/script>')
  })
})
