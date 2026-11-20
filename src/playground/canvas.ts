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

  paint(0)
  frame = requestAnimationFrame(tick)

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
    ctx.fillStyle = '#fffaf3'
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
