import type { Display } from '../draw.ts'
import type { Stroke } from '../turtle.ts'

/** Stop an in-progress animation. */
export interface Playback {
  stop: () => void
}

/**
 * Draw strokes on a canvas, walking the turtle along them.
 * `unitsPerSecond` is how fast the pen moves. Infinity draws the whole picture at once.
 * The slider can change the speed while the picture is still being drawn.
 */
export function playDrawing(
  canvas: HTMLCanvasElement,
  strokes: Stroke[],
  unitsPerSecond: () => number,
  end: { x: number; y: number; heading: number } = { x: 0, y: 0, heading: 0 },
  onDone?: () => void,
): Playback {
  const lengths = strokes.map((stroke) => Math.hypot(stroke.x2 - stroke.x1, stroke.y2 - stroke.y1))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  const started = performance.now()
  let frame = 0
  let stopped = false

  const observer = new ResizeObserver(() => paint(distanceAt(performance.now())))
  observer.observe(canvas)

  const tick = (now: number) => {
    if (stopped) return
    const distance = distanceAt(now)
    paint(distance)
    if (distance < total) frame = requestAnimationFrame(tick)
    else onDone?.()
  }

  const first = distanceAt(performance.now())
  paint(first)
  if (first < total) frame = requestAnimationFrame(tick)
  else onDone?.()

  return {
    stop() {
      stopped = true
      cancelAnimationFrame(frame)
      observer.disconnect()
    },
  }

  function distanceAt(now: number): number {
    const speed = unitsPerSecond()
    if (!Number.isFinite(speed)) return total
    return Math.min(total, ((now - started) / 1000) * speed)
  }

  function paint(traveled: number): void {
    const ctx = prepare(canvas)
    if (!ctx) return
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const view = fit(strokes, width, height)

    ctx.clearRect(0, 0, width, height)
    const background = getComputedStyle(canvas).backgroundColor
    ctx.fillStyle = background && background !== 'rgba(0, 0, 0, 0)' ? background : '#1e1e1e'
    ctx.fillRect(0, 0, width, height)

    let remaining = traveled
    let turtleX = end.x
    let turtleY = end.y
    let heading = end.heading
    let placed = false

    for (let i = 0; i < strokes.length; i++) {
      const stroke = strokes[i]
      const length = lengths[i]
      const done = length === 0 || remaining >= length - 1e-9
      const t = done ? 1 : remaining / length
      const x = stroke.x1 + (stroke.x2 - stroke.x1) * t
      const y = stroke.y1 + (stroke.y2 - stroke.y1) * t
      if (stroke.draw && t > 0) {
        ctx.beginPath()
        ctx.moveTo(view.x(stroke.x1), view.y(stroke.y1))
        ctx.lineTo(view.x(x), view.y(y))
        ctx.strokeStyle = stroke.color
        ctx.lineWidth = stroke.width
        ctx.lineCap = 'round'
        ctx.stroke()
      }
      turtleX = x
      turtleY = y
      heading = stroke.heading
      placed = true
      if (!done) break
      remaining -= length
    }

    if (traveled >= total - 1e-9 || !placed) {
      turtleX = end.x
      turtleY = end.y
      heading = end.heading
    }
    // Canvas angles grow clockwise from east. Heading 0 is north.
    drawTurtle(ctx, view.x(turtleX), view.y(turtleY), (heading * Math.PI) / 180 - Math.PI / 2)
  }
}

/** Games draw on a 360×240 field. The preview scales that field to the canvas. */
export const FIELD_W = 360
export const FIELD_H = 240

export function fieldTransform(width: number, height: number): { scale: number; ox: number; oy: number } {
  const scale = Math.min(width / FIELD_W, height / FIELD_H)
  return { scale, ox: (width - FIELD_W * scale) / 2, oy: (height - FIELD_H * scale) / 2 }
}

/** Map a pointer into game coordinates. */
export function fieldPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  cameraX: number,
  cameraY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const { scale, ox, oy } = fieldTransform(width, height)
  const x = ((clientX - rect.left) / Math.max(1, rect.width)) * width
  const y = ((clientY - rect.top) / Math.max(1, rect.height)) * height
  return { x: (x - ox) / scale + cameraX, y: (y - oy) / scale + cameraY }
}

export interface DebugOverlay {
  grid: boolean
  bounds: boolean
  labels: boolean
  velocity: boolean
  selected: number | null
  entities: { id: number; name: string; fields: { name: string; value: string }[] }[]
}

export interface RewindWash {
  tint: boolean
  ghosts: { x: number; y: number }[]
}

/** Paint a display list. The update loop does not call this. */
export function paintDisplay(
  canvas: HTMLCanvasElement,
  display: Display,
  overlay?: DebugOverlay | null,
  wash?: RewindWash | null,
): void {
  const ctx = prepare(canvas)
  if (!ctx) return
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = display.background
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = false
  const fit = fieldTransform(width, height)
  ctx.save()
  ctx.translate(fit.ox, fit.oy)
  ctx.scale(fit.scale, fit.scale)
  ctx.translate(-display.cameraX, -display.cameraY)
  for (const op of display.ops) {
    if (op.kind === 'rect') {
      ctx.fillStyle = op.color
      ctx.fillRect(op.x, op.y, op.w, op.h)
    } else if (op.kind === 'circle') {
      ctx.fillStyle = op.color
      ctx.beginPath()
      ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2)
      ctx.fill()
    } else if (op.kind === 'line') {
      ctx.strokeStyle = op.color
      ctx.beginPath()
      ctx.moveTo(op.x1, op.y1)
      ctx.lineTo(op.x2, op.y2)
      ctx.stroke()
    } else if (op.kind === 'text') {
      ctx.fillStyle = op.color
      ctx.font = '20px sans-serif'
      ctx.fillText(op.text, op.x, op.y)
    } else if (op.art.includes('\n')) {
      ctx.fillStyle = op.color
      const rows = op.art.split('\n')
      rows.forEach((row, y) => {
        ;[...row].forEach((cell, x) => {
          if (cell !== '.' && cell !== ' ') ctx.fillRect(op.x + x * 4, op.y + y * 4, 4, 4)
        })
      })
    } else {
      ctx.font = '32px sans-serif'
      ctx.fillText(op.art, op.x, op.y + 32)
    }
  }
  if (overlay) paintOverlay(ctx, overlay)
  if (wash?.tint) {
    ctx.fillStyle = 'rgba(110, 150, 255, 0.28)'
    ctx.fillRect(-20, -20, FIELD_W + 40, FIELD_H + 40)
  }
  if (wash) {
    ctx.fillStyle = 'rgba(244, 239, 230, 0.45)'
    for (const ghost of wash.ghosts) {
      ctx.beginPath()
      ctx.arc(ghost.x, ghost.y, 5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

function paintOverlay(ctx: CanvasRenderingContext2D, overlay: DebugOverlay): void {
  if (overlay.grid) {
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    for (let n = 0; n <= 400; n += 40) {
      ctx.beginPath()
      ctx.moveTo(n, 0)
      ctx.lineTo(n, 280)
      ctx.moveTo(0, n)
      ctx.lineTo(400, n)
      ctx.stroke()
    }
    ctx.restore()
  }
  for (const entity of overlay.entities) {
    const x = fieldNum(entity, 'x')
    const y = fieldNum(entity, 'y')
    if (x === null || y === null) continue
    const selected = entity.id === overlay.selected
    if (overlay.bounds) {
      const r = fieldNum(entity, 'r')
      const w = fieldNum(entity, 'w')
      const h = fieldNum(entity, 'h')
      ctx.save()
      ctx.strokeStyle = selected ? '#4ec9b0' : 'rgba(78, 201, 176, 0.7)'
      ctx.lineWidth = selected ? 2 : 1
      if (r !== null) {
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.stroke()
      } else if (w !== null && h !== null) {
        ctx.strokeRect(x - w / 2, y - h / 2, w, h)
      }
      ctx.restore()
    }
    if (overlay.velocity) {
      const vx = fieldNum(entity, 'vx')
      const vy = fieldNum(entity, 'vy')
      if (vx !== null && vy !== null) {
        ctx.save()
        ctx.strokeStyle = '#f2c14e'
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + vx * 0.15, y + vy * 0.15)
        ctx.stroke()
        ctx.restore()
      }
    }
    if (overlay.labels || selected) {
      ctx.save()
      ctx.fillStyle = '#f4efe6'
      ctx.font = '11px sans-serif'
      ctx.fillText(`${entity.name}#${entity.id}`, x + 6, y - 6)
      ctx.restore()
    }
  }
}

function fieldNum(entity: DebugOverlay['entities'][number], name: string): number | null {
  const field = entity.fields.find((item) => item.name === name)
  if (!field) return null
  const matched = /^-?\d+(?:\.\d+)?/.exec(field.value)
  return matched ? Number(matched[0]) : null
}

function prepare(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const width = Math.max(1, canvas.clientWidth)
  const height = Math.max(1, canvas.clientHeight)
  const ratio = window.devicePixelRatio || 1
  const pixelsWide = Math.floor(width * ratio)
  const pixelsHigh = Math.floor(height * ratio)
  if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) {
    canvas.width = pixelsWide
    canvas.height = pixelsHigh
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  return ctx
}

function fit(strokes: Stroke[], width: number, height: number): { x: (n: number) => number; y: (n: number) => number } {
  let minX = 0
  let maxX = 0
  let minY = 0
  let maxY = 0
  for (const stroke of strokes) {
    minX = Math.min(minX, stroke.x1, stroke.x2)
    maxX = Math.max(maxX, stroke.x1, stroke.x2)
    minY = Math.min(minY, stroke.y1, stroke.y2)
    maxY = Math.max(maxY, stroke.y1, stroke.y2)
  }
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)
  const pad = 36
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY)
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  return {
    x: (n) => width / 2 + (n - midX) * scale,
    y: (n) => height / 2 - (n - midY) * scale,
  }
}

function drawTurtle(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.moveTo(10, 0)
  ctx.lineTo(-7, 5.5)
  ctx.lineTo(-4, 0)
  ctx.lineTo(-7, -5.5)
  ctx.closePath()
  ctx.fillStyle = '#1f6f54'
  ctx.fill()
  ctx.restore()
}
