/** Pipkin, the glowing cat. The reducer is pure so tests can drive it. */

export type MascotMood =
  | 'idle'
  | 'blink'
  | 'look'
  | 'typing'
  | 'thinking'
  | 'happy'
  | 'cheer'
  | 'worried'
  | 'tangled'
  | 'dizzy'
  | 'rewind'
  | 'sleepy'
  | 'asleep'
  | 'surprised'
  | 'giggle'

export interface MascotModel {
  mood: MascotMood
  lastInput: number
  lastBubble: number
  hadError: boolean
  relief: boolean
  bubble: string | null
}

export type MascotEvent =
  | { type: 'key'; now: number }
  | { type: 'pointer'; now: number }
  | { type: 'error'; now: number }
  | { type: 'compiled'; now: number; bubbles: boolean }
  | { type: 'score'; now: number }
  | { type: 'hit'; now: number }
  | { type: 'over'; now: number }
  | { type: 'win'; now: number }
  | { type: 'scrub'; now: number; active: boolean }
  | { type: 'tweak'; now: number; fast: boolean }
  | { type: 'poke'; now: number }
  | { type: 'hover'; now: number }
  | { type: 'react'; now: number; mood: string }
  | { type: 'settle'; now: number }
  | { type: 'relax'; now: number }
  | { type: 'idle-check'; now: number }
  | { type: 'hint'; now: number; text: string; bubbles: boolean }
  | { type: 'dismiss' }

const TRANSIENT = new Set<MascotMood>(['happy', 'cheer', 'giggle', 'surprised', 'dizzy', 'blink'])
const REACTIONS = new Set<MascotMood>(['cheer', 'surprised', 'happy', 'worried', 'giggle', 'idle'])
const BUBBLE_GAP = 180_000

export function initialMascot(now = 0): MascotModel {
  return { mood: 'idle', lastInput: now, lastBubble: -BUBBLE_GAP, hadError: false, relief: false, bubble: null }
}

/** One event in, one model out. No timers and no DOM. */
export function reduceMascot(model: MascotModel, event: MascotEvent): MascotModel {
  switch (event.type) {
    case 'dismiss':
      return { ...model, bubble: null }
    case 'hint': {
      if (!event.bubbles || event.now - model.lastBubble < BUBBLE_GAP) return model
      return { ...model, bubble: event.text, lastBubble: event.now }
    }
    case 'error':
      return { ...model, mood: 'tangled', hadError: true, relief: false, lastInput: event.now }
    case 'compiled': {
      const next: MascotModel = {
        ...model,
        mood: 'happy',
        relief: model.hadError,
        hadError: false,
        lastInput: event.now,
      }
      if (model.hadError && event.bubbles && event.now - model.lastBubble >= BUBBLE_GAP) {
        next.bubble = 'That compiled.'
        next.lastBubble = event.now
      }
      return next
    }
    case 'key':
      return wake(model, event.now, 'typing')
    case 'pointer':
      return model.mood === 'asleep' || model.mood === 'sleepy' ? wake(model, event.now, 'idle') : { ...model, lastInput: event.now }
    case 'score':
      return { ...model, mood: 'happy', lastInput: event.now }
    case 'hit':
    case 'over':
      return { ...model, mood: 'surprised', lastInput: event.now }
    case 'win':
      return { ...model, mood: 'cheer', lastInput: event.now }
    case 'scrub':
      return { ...model, mood: event.active ? 'rewind' : 'idle', lastInput: event.now }
    case 'tweak':
      return event.fast ? { ...model, mood: 'dizzy', lastInput: event.now } : { ...model, lastInput: event.now }
    case 'poke':
    case 'hover':
      return wake(model, event.now, 'giggle')
    case 'react': {
      if (!REACTIONS.has(event.mood as MascotMood)) return model
      return { ...model, mood: event.mood as MascotMood, lastInput: event.now }
    }
    case 'settle':
      return model.mood === 'typing' ? { ...model, mood: 'thinking' } : model
    case 'relax':
      return TRANSIENT.has(model.mood) ? { ...model, mood: 'idle', relief: false } : model
    case 'idle-check':
      if (event.now - model.lastInput < 60_000) return model
      if (model.mood === 'asleep') return model
      if (event.now - model.lastInput < 63_000) return { ...model, mood: 'sleepy' }
      return { ...model, mood: 'asleep' }
    default:
      return model
  }
}

function wake(model: MascotModel, now: number, mood: MascotMood): MascotModel {
  return { ...model, mood, lastInput: now, relief: false }
}

let serial = 0

/** Round glowing cat. The same silhouette is drawn three times: a wide halo, a tight bloom, and the lit body. */
export function pipkinMarkup(prefix = `pipkin-${serial++}`): string {
  const star = (cx: number, cy: number, r: number) => {
    const i = r * 0.32
    return `M${cx} ${cy - r}L${cx + i} ${cy - i}L${cx + r} ${cy}L${cx + i} ${cy + i}L${cx} ${cy + r}L${cx - i} ${cy + i}L${cx - r} ${cy}L${cx - i} ${cy - i}Z`
  }
  const glow = `
    <path class="tail" d="M86 108C112 116 128 96 122 76C118 60 104 62 108 78C114 96 100 104 86 100Z"/>
    <circle class="body" cx="60" cy="86" r="33"/>
    <ellipse class="paw left" cx="42" cy="116" rx="13" ry="7.5"/>
    <ellipse class="paw right" cx="78" cy="116" rx="13" ry="7.5"/>`
  const ears = `
    <path class="ear left" d="M34 60L29 47L48 54Z"/>
    <path class="ear right" d="M86 60L91 47L72 54Z"/>`
  return `<svg class="pipkin" data-mood="idle" viewBox="-16 -14 152 164" role="img" aria-label="Pipkin">
    <defs>
      <radialGradient id="${prefix}-fur" gradientUnits="userSpaceOnUse" cx="48" cy="68" r="70">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="18%" stop-color="var(--core, #fff6d2)"/>
        <stop offset="58%" stop-color="var(--mid, #ffb14a)"/>
        <stop offset="100%" stop-color="var(--edge, #ff742c)"/>
      </radialGradient>
      <radialGradient id="${prefix}-eye" cx="32%" cy="28%" r="78%">
        <stop offset="0%" stop-color="#8a6d60"/>
        <stop offset="42%" stop-color="#2a1e1a"/>
        <stop offset="100%" stop-color="#100c0a"/>
      </radialGradient>
      <filter id="${prefix}-halo" x="-80%" y="-80%" width="260%" height="260%" color-interpolation-filters="sRGB">
        <feGaussianBlur stdDeviation="10"/>
      </filter>
      <filter id="${prefix}-bloom" x="-60%" y="-60%" width="220%" height="220%" color-interpolation-filters="sRGB">
        <feGaussianBlur stdDeviation="3.2"/>
      </filter>
    </defs>
    <g class="halo" filter="url(#${prefix}-halo)" fill="var(--bloom, #ff8a3c)">${glow}</g>
    <g class="bloom" filter="url(#${prefix}-bloom)" fill="var(--bloom, #ff8a3c)">${glow}</g>
    <g class="fur" fill="url(#${prefix}-fur)">${glow}</g>
    <g class="ears" fill="url(#${prefix}-fur)">${ears}</g>
    <ellipse class="shine" cx="48" cy="66" rx="14" ry="9"/>
    <path class="inner left" d="M35 57L32 50L44 54Z"/>
    <path class="inner right" d="M85 57L88 50L76 54Z"/>
    <ellipse class="cheek left" cx="36" cy="92" rx="5" ry="3"/>
    <ellipse class="cheek right" cx="84" cy="92" rx="5" ry="3"/>
    <g class="eye left">
      <g class="gaze">
        <circle class="iris" cx="46" cy="80" r="8.4" fill="url(#${prefix}-eye)"/>
        <circle class="catch" cx="43.2" cy="76.8" r="2.3"/>
        <path class="star" d="${star(49.2, 82.6, 2.5)}"/>
      </g>
      <path class="smile-eye" d="M37 81Q46 74 55 81"/>
      <ellipse class="lid" cx="46" cy="80" rx="9.2" ry="9.2"/>
    </g>
    <g class="eye right">
      <g class="gaze">
        <circle class="iris" cx="74" cy="80" r="8.4" fill="url(#${prefix}-eye)"/>
        <circle class="catch" cx="71.2" cy="76.8" r="2.3"/>
        <path class="star" d="${star(77.2, 82.6, 2.5)}"/>
      </g>
      <path class="smile-eye" d="M65 81Q74 74 83 81"/>
      <ellipse class="lid" cx="74" cy="80" rx="9.2" ry="9.2"/>
    </g>
    <path class="nose" d="M60 90.5l3 2.2a2.1 2.1 0 0 1-6 0z"/>
    <g class="whiskers">
      <path d="M42 90h-4M43 93h-3M78 90h4M77 93h3"/>
    </g>
    <path class="mote a" d="${star(16, 46, 3.2)}"/>
    <path class="mote b" d="${star(108, 34, 2.4)}"/>
    <path class="mote c" d="${star(112, 108, 2.8)}"/>
    <g class="zzz" aria-hidden="true">
      <text x="96" y="18">z</text>
      <text x="106" y="8">z</text>
    </g>
  </svg>`
}

export interface MascotHandle {
  noteKey: () => void
  notePointer: (x: number, y: number) => void
  lookCaret: (line: number, column: number) => void
  lookEntity: (x: number, y: number) => void
  noteError: () => void
  noteCompiled: () => void
  noteScore: () => void
  noteHit: () => void
  noteOver: () => void
  noteWin: () => void
  noteScrub: (active: boolean) => void
  noteTweak: (fast: boolean) => void
  react: (mood: string) => void
  setEnabled: (on: boolean) => void
  setBubbles: (on: boolean) => void
  setSize: (size: 'small' | 'medium') => void
  setReduced: (on: boolean) => void
  destroy: () => void
}

const HINTS = [
  'Cmd+K opens the command bar.',
  'Alt-click a number to change it live.',
  'Cmd+B opens your files.',
]

/**
 * Header and preview copies of Pipkin. Timers only, so it never sits on the game loop.
 */
export function attachMascot(slot: HTMLElement, floatHost: HTMLElement): MascotHandle {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let model = initialMascot(Date.now())
  let bubbles = true
  let enabled = true
  let lastKey = 0
  let lastBounce = 0
  let lastReact = 0
  let gaze: 'caret' | 'play' | 'mouse' = 'mouse'
  let lastPlay = 0
  let relaxTimer = 0
  let thinkTimer = 0
  let sleepTimer = 0
  let hintTimer = 0

  slot.innerHTML = pipkinMarkup('slot')
  floatHost.innerHTML = pipkinMarkup('float')
  const svgs = [slot.querySelector('svg')!, floatHost.querySelector('svg')!]
  const bubble = document.createElement('div')
  bubble.className = 'mascot-bubble'
  bubble.hidden = true
  const bubbleText = document.createElement('p')
  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.textContent = 'Close'
  dismiss.addEventListener('click', () => apply({ type: 'dismiss' }))
  bubble.append(bubbleText, dismiss)
  floatHost.append(bubble)

  const paint = () => {
    for (const svg of svgs) {
      svg.dataset.mood = reduced && model.mood !== 'idle' && model.mood !== 'asleep' ? 'idle' : model.mood
      svg.dataset.relief = model.relief ? '1' : '0'
      svg.dataset.motion = reduced ? 'reduce' : 'full'
    }
    if (model.mood === 'thinking') {
      for (const svg of svgs) svg.style.setProperty('--look-y', '-0.8')
    }
    if (!bubbles || !model.bubble) bubble.hidden = true
    else {
      bubble.hidden = false
      bubbleText.textContent = model.bubble
    }
    slot.hidden = !enabled
    floatHost.hidden = !enabled
  }

  const apply = (event: MascotEvent) => {
    if (!enabled && event.type !== 'dismiss') return
    model = reduceMascot(model, event)
    paint()
    window.clearTimeout(relaxTimer)
    window.clearTimeout(thinkTimer)
    if (model.mood === 'typing') {
      thinkTimer = window.setTimeout(() => apply({ type: 'settle', now: Date.now() }), 700)
    } else if (TRANSIENT.has(model.mood)) {
      relaxTimer = window.setTimeout(() => apply({ type: 'relax', now: Date.now() }), 1200)
    }
    if (event.type === 'idle-check' && model.mood === 'sleepy') {
      sleepTimer = window.setTimeout(() => apply({ type: 'idle-check', now: Date.now() }), 3200)
    }
  }

  const armSleep = () => {
    window.clearTimeout(sleepTimer)
    sleepTimer = window.setTimeout(() => apply({ type: 'idle-check', now: Date.now() }), 60_000)
  }

  const armHint = () => {
    window.clearTimeout(hintTimer)
    hintTimer = window.setTimeout(() => {
      const text = HINTS[Math.floor(Date.now() / 1000) % HINTS.length] ?? HINTS[0]
      apply({ type: 'hint', now: Date.now(), text, bubbles })
      armHint()
    }, BUBBLE_GAP)
  }

  const look = (x: number, y: number) => {
    const lx = Math.max(-1, Math.min(1, x)).toFixed(3)
    const ly = Math.max(-1, Math.min(1, y)).toFixed(3)
    for (const svg of svgs) {
      svg.style.setProperty('--look-x', lx)
      svg.style.setProperty('--look-y', ly)
    }
  }

  const bounce = () => {
    const now = Date.now()
    if (now - lastBounce < 80) return
    lastBounce = now
    for (const svg of svgs) {
      svg.classList.remove('tap')
      void svg.getBoundingClientRect()
      svg.classList.add('tap')
    }
  }

  slot.addEventListener('pointerenter', () => apply({ type: 'hover', now: Date.now() }))
  floatHost.addEventListener('pointerenter', () => apply({ type: 'hover', now: Date.now() }))
  for (const host of [slot, floatHost]) {
    host.addEventListener('pointerdown', (event) => {
      if (host === slot) apply({ type: 'poke', now: Date.now() })
      if (host !== floatHost) return
      const parent = floatHost.parentElement
      if (!parent) return
      const startX = event.clientX
      const startY = event.clientY
      const origin = floatHost.getBoundingClientRect()
      const bounds = parent.getBoundingClientRect()
      const move = (ev: PointerEvent) => {
        const left = Math.min(bounds.width - 48, Math.max(8, origin.left - bounds.left + ev.clientX - startX))
        const top = Math.min(bounds.height - 48, Math.max(8, origin.top - bounds.top + ev.clientY - startY))
        floatHost.style.left = `${left}px`
        floatHost.style.top = `${top}px`
        floatHost.style.right = 'auto'
        floatHost.style.bottom = 'auto'
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        apply({ type: 'poke', now: Date.now() })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    })
  }

  paint()
  armSleep()
  armHint()
  if (reduced) for (const svg of svgs) svg.dataset.motion = 'reduce'

  return {
    noteKey() {
      const now = Date.now()
      lastKey = now
      gaze = 'caret'
      bounce()
      apply({ type: 'key', now })
      armSleep()
    },
    notePointer(x, y) {
      if (Date.now() - lastKey < 500) return
      if (gaze === 'play' && Date.now() - lastPlay < 300) return
      gaze = 'mouse'
      look(x, y)
      if (model.mood === 'asleep' || model.mood === 'sleepy') apply({ type: 'pointer', now: Date.now() })
      armSleep()
    },
    lookCaret(line, column) {
      gaze = 'caret'
      look((column - 24) / 36, (line - 16) / 28)
    },
    lookEntity(x, y) {
      if (Date.now() - lastKey < 500) return
      gaze = 'play'
      lastPlay = Date.now()
      look((x - 180) / 180, (y - 120) / 120)
    },
    noteError() {
      apply({ type: 'error', now: Date.now() })
    },
    noteCompiled() {
      apply({ type: 'compiled', now: Date.now(), bubbles })
      armSleep()
    },
    noteScore() {
      if (Date.now() - lastReact < 400) return
      lastReact = Date.now()
      apply({ type: 'score', now: Date.now() })
    },
    noteHit() {
      if (Date.now() - lastReact < 400) return
      lastReact = Date.now()
      apply({ type: 'hit', now: Date.now() })
    },
    noteOver() {
      apply({ type: 'over', now: Date.now() })
    },
    noteWin() {
      apply({ type: 'win', now: Date.now() })
    },
    noteScrub(active) {
      gaze = active ? 'play' : gaze
      apply({ type: 'scrub', now: Date.now(), active })
    },
    noteTweak(fast) {
      apply({ type: 'tweak', now: Date.now(), fast })
    },
    react(mood) {
      apply({ type: 'react', now: Date.now(), mood })
    },
    setEnabled(on) {
      enabled = on
      paint()
    },
    setBubbles(on) {
      bubbles = on
      if (!on) apply({ type: 'dismiss' })
      else paint()
    },
    setSize(size) {
      slot.classList.toggle('medium', size === 'medium')
      floatHost.classList.toggle('medium', size === 'medium')
    },
    setReduced(on) {
      for (const svg of svgs) svg.dataset.motion = on ? 'reduce' : 'full'
    },
    destroy() {
      window.clearTimeout(relaxTimer)
      window.clearTimeout(thinkTimer)
      window.clearTimeout(sleepTimer)
      window.clearTimeout(hintTimer)
    },
  }
}
