import { examples } from './examples.ts'

export type FolderName = 'Games' | 'Graphics' | 'Algorithms'

export interface LibraryFile {
  id: string
  /** File name shown in the tree and the tab. */
  name: string
  folder: FolderName
  /** Key into the example gallery. */
  example: string
  category: 'game' | 'graphics' | 'algorithm'
}

export interface UserFile {
  id: string
  name: string
  code: string
}

export const library: LibraryFile[] = [
  { id: 'undo', name: 'undo.spool', folder: 'Games', example: 'Undo', category: 'game' },
  { id: 'pong', name: 'pong.spool', folder: 'Games', example: 'Pong', category: 'game' },
  { id: 'snake', name: 'snake.spool', folder: 'Games', example: 'Snake', category: 'game' },
  { id: 'breakout', name: 'breakout.spool', folder: 'Games', example: 'Breakout', category: 'game' },
  { id: 'asteroids', name: 'asteroids.spool', folder: 'Games', example: 'Asteroids', category: 'game' },
  { id: 'flappy', name: 'flappy.spool', folder: 'Games', example: 'Flappy', category: 'game' },
  { id: 'spiral', name: 'spiral.spool', folder: 'Graphics', example: 'Spiral', category: 'graphics' },
  { id: 'snowflake', name: 'snowflake.spool', folder: 'Graphics', example: 'Snowflake', category: 'graphics' },
  { id: 'tree', name: 'tree.spool', folder: 'Graphics', example: 'Tree', category: 'graphics' },
  { id: 'flower', name: 'flower.spool', folder: 'Graphics', example: 'Flower', category: 'graphics' },
  { id: 'koch', name: 'koch.spool', folder: 'Graphics', example: 'Koch', category: 'graphics' },
  { id: 'sierpinski', name: 'sierpinski.spool', folder: 'Graphics', example: 'Sierpinski', category: 'graphics' },
  { id: 'rainbow', name: 'rainbow.spool', folder: 'Graphics', example: 'Rainbow', category: 'graphics' },
  { id: 'particles', name: 'particles.spool', folder: 'Graphics', example: 'Particles', category: 'graphics' },
  { id: 'primes', name: 'primes.spool', folder: 'Algorithms', example: 'Primes', category: 'algorithm' },
  { id: 'sort', name: 'sort.spool', folder: 'Algorithms', example: 'Sort', category: 'algorithm' },
  { id: 'fibonacci', name: 'fibonacci.spool', folder: 'Algorithms', example: 'Fibonacci', category: 'algorithm' },
  { id: 'fizzbuzz', name: 'fizzbuzz.spool', folder: 'Algorithms', example: 'FizzBuzz', category: 'algorithm' },
]

const originOf = new Map(examples.map((example) => [example.name, example.code]))

export function originCode(example: string): string {
  return originOf.get(example) ?? ''
}

export function libraryFile(id: string): LibraryFile | undefined {
  return library.find((file) => file.id === id)
}

function overrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem('spool-overrides')
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function readLibraryCode(id: string): string {
  const file = libraryFile(id)
  if (!file) return ''
  const saved = overrides()[id]
  return saved ?? originCode(file.example)
}

export function isModified(id: string): boolean {
  const file = libraryFile(id)
  if (!file) return false
  return overrides()[id] !== undefined && overrides()[id] !== originCode(file.example)
}

export function saveLibraryCode(id: string, code: string): void {
  const file = libraryFile(id)
  if (!file) return
  const next = overrides()
  if (code === originCode(file.example)) delete next[id]
  else next[id] = code
  localStorage.setItem('spool-overrides', JSON.stringify(next))
}

export function resetLibraryCode(id: string): string {
  const file = libraryFile(id)
  const next = overrides()
  delete next[id]
  localStorage.setItem('spool-overrides', JSON.stringify(next))
  return file ? originCode(file.example) : ''
}

const SCRATCH_NAME = /^untitled(?:-\d+)?\.spool$/

/** Drop blank scratch files and identical untitled copies left by an old bug. */
export function tidyUserFiles(files: UserFile[]): UserFile[] {
  const kept: UserFile[] = []
  const seen = new Set<string>()
  for (const file of files) {
    const code = file.code.trim()
    if (!code || code === 's=1') continue
    if (SCRATCH_NAME.test(file.name)) {
      if (seen.has(code)) continue
      seen.add(code)
    }
    kept.push(file)
  }
  return kept
}

/** The next free scratch name: untitled-1.spool, untitled-2.spool, and so on. */
export function nextUntitledName(files: { name: string }[]): string {
  const used = new Set(files.map((file) => file.name))
  let n = 1
  while (used.has(`untitled-${n}.spool`)) n += 1
  return `untitled-${n}.spool`
}

export function readUserFiles(): UserFile[] {
  try {
    const raw = localStorage.getItem('spool-user-files')
    return raw ? (JSON.parse(raw) as UserFile[]) : []
  } catch {
    return []
  }
}

export function writeUserFiles(files: UserFile[]): void {
  localStorage.setItem('spool-user-files', JSON.stringify(files))
}

/** The first comment, without the leading name, for the preview hint. */
export function controlsHint(code: string): string {
  const line = code.split('\n').find((item) => item.trim().startsWith('#'))
  if (!line) return ''
  return line.replace(/^#\s*/, '').replace(/^[A-Za-z][A-Za-z ]*\.\s*/, '')
}

/** Entity declarations, so a reload can tell whether the world shape changed. */
export function entityShape(code: string): string {
  return [...code.matchAll(/entity\s+([A-Za-z_]\w*)\s*\{([^}]*)\}/g)]
    .map((match) => `${match[1]}:${match[2].replace(/\s+/g, '')}`)
    .sort()
    .join('|')
}
