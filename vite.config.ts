import { build, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const root = decodeURIComponent(new URL('.', import.meta.url).pathname)

/**
 * One JavaScript file the export button inlines into a downloaded page.
 * Built on demand in dev, and emitted next to the site by `npm run build`.
 */
function playerBundle(): Plugin {
  let cached: Promise<string> | null = null
  const bundle = () => {
    cached ??= bundlePlayer(root)
    return cached
  }
  return {
    name: 'spool-player-bundle',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req as { url?: string }).url?.split('?')[0]
        if (url !== '/player-bundle.js') {
          next()
          return
        }
        void bundle()
          .then((code) => {
            res.setHeader('content-type', 'text/javascript; charset=utf-8')
            res.end(code)
          })
          .catch((error: unknown) => {
            cached = null
            res.statusCode = 500
            res.end(error instanceof Error ? error.message : 'Could not build the player')
          })
      })
    },
    async generateBundle() {
      const code = await bundle()
      this.emitFile({ type: 'asset', fileName: 'player-bundle.js', source: code })
    },
  }
}

async function bundlePlayer(projectRoot: string): Promise<string> {
  const built = await build({
    configFile: false,
    root: projectRoot,
    logLevel: 'error',
    build: {
      write: false,
      emptyOutDir: false,
      target: 'es2023',
      minify: true,
      rollupOptions: {
        input: decodeURIComponent(new URL('./src/player.ts', import.meta.url).pathname),
        output: { format: 'es', codeSplitting: false },
      },
    },
  })
  const output = Array.isArray(built) ? built[0] : built
  if (!output || !('output' in output)) throw new Error('Player bundle was empty')
  const chunk = output.output.find((item) => item.type === 'chunk')
  if (!chunk || chunk.type !== 'chunk') throw new Error('Player bundle was empty')
  return chunk.code
}

const pages = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GITHUB_PAGES === '1'

export default defineConfig({
  base: pages ? '/spool/' : '/',
  plugins: [playerBundle()],
  test: {
    globals: false,
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      'tests/bench-numbers.test.ts',
    ],
  },
})
