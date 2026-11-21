import { describe, expect, it } from 'vitest'
import { Display } from '../src/draw.ts'
import { RuntimeError } from '../src/errors.ts'
import { loadGame as loadTree } from '../src/interpreter.ts'
import { InputState } from '../src/input.ts'
import { loadGame as loadVm } from '../src/vm.ts'

const engines = [
  ['tree-walker', loadTree],
  ['vm', loadVm],
] as const

const source = `use draw
use input
let n = 0
let p = vec(0px, 0px)
on tick(dt) {
  draw.background("#123456")
  draw.camera(4px, 5)
  draw.rect(1, 2px, 3, 4, "white")
  draw.circle(0, 0, 8, "red")
  draw.line(0, 0, 1, 1, "blue")
  draw.text(0, 10, "hi", "black")
  draw.sprite(0, 0, ".#.\\n#.#")
  p = input.mouse()
  if input.key("space") { n = n + 1 }
  if input.click() { n = n + 2 }
}`

for (const [engine, load] of engines) {
  describe(`draw and input (${engine})`, () => {
    it('records shapes and reads the host input', () => {
      const display = new Display()
      const input = new InputState()
      input.press('space')
      input.click = true
      input.x = 12
      input.y = 9
      const game = load(source, { modules: { draw: display.module(), input: input.module() } })
      display.begin()
      game.frame([])
      expect(display.background).toBe('#123456')
      expect(display.cameraX).toBe(4)
      expect(display.cameraY).toBe(5)
      expect(display.ops.map((op) => op.kind)).toEqual(['rect', 'circle', 'line', 'text', 'sprite'])
      expect(display.ops[0]).toMatchObject({ x: 1, y: 2, w: 3, h: 4, color: 'white' })
      expect(display.ops[4]).toMatchObject({ art: '.#.\n#.#' })
      expect(game.get('n')).toBe(3)
      expect(game.get('p')).toMatchObject({ x: { value: 12 }, y: { value: 9 } })
    })

    it('rejects a coordinate with the wrong unit', () => {
      const display = new Display()
      const game = load('use draw\non tick(dt) { draw.rect(1s, 0, 1, 1, "white") }', {
        modules: { draw: display.module() },
      })
      expect(() => game.frame([])).toThrow(RuntimeError)
      expect(() => game.frame([])).toThrow(/px quantity/)
    })
  })
}
