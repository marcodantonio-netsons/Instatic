import { describe, expect, it, spyOn } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'
import { bunCommand, bunRunCommand, viteCommand } from '../../scripts/lib/bunCommand'
import viteConfig from '../../vite.config'

const root = new URL('../../', import.meta.url)

function readSiteFile(path: string) {
  return readFileSync(new URL(path, root), 'utf-8')
}

async function publicSiteMiddleware(): Promise<Connect.NextHandleFunction> {
  const plugin = viteConfig.plugins?.find((candidate): candidate is Plugin => (
    !!candidate && typeof candidate === 'object' &&
    'name' in candidate && candidate.name === 'instatic-public-site-dev-proxy'
  ))
  if (!plugin || typeof plugin.configureServer !== 'function') {
    throw new Error('Public-site proxy must register its development middleware')
  }

  let middleware: Connect.NextHandleFunction | undefined
  // Exercise the actual Vite hook without starting a server or opening a port.
  await Reflect.apply(plugin.configureServer, {}, [{
    middlewares: {
      use(handler: Connect.NextHandleFunction) {
        middleware = handler
      },
    },
  }])
  if (!middleware) throw new Error('Public-site proxy did not install middleware')
  return middleware
}

function runPublicSiteRequest(
  middleware: Connect.NextHandleFunction,
  method: string,
  url: string,
): Promise<{ passedThrough: boolean; status?: number; body?: string }> {
  return new Promise((resolve, reject) => {
    let status: number | undefined
    // These are the Node HTTP members the middleware consumes; no network is used.
    const req = { method, url, headers: {} } as IncomingMessage
    const res = {
      writeHead(code: number) {
        status = code
      },
      end(body?: Uint8Array) {
        resolve({ passedThrough: false, status, body: body?.toString() })
      },
    } as unknown as ServerResponse
    middleware(req, res, (err?: unknown) => {
      if (err) reject(err)
      else resolve({ passedThrough: true })
    })
  })
}

describe('development workflow', () => {
  it('`bun run dev` is the one-command launcher for cms + vite', () => {
    const pkg = JSON.parse(readSiteFile('package.json')) as {
      scripts: Record<string, string>
    }

    expect(pkg.scripts['dev']).toBe('bun run scripts/dev.ts')
    expect(pkg.scripts['dev:agent']).toBe('bun run dev:server')
    expect(pkg.scripts['dev:server']).toBe('bun --watch server/index.ts')
    expect(pkg.scripts['dev:vite']).toBe('bun run scripts/vite.ts')
    expect(pkg.scripts['build']).toBe('tsc -b && bun run scripts/vite.ts build')
    expect(pkg.scripts['preview']).toBe('bun run scripts/vite.ts preview')
    expect(pkg.scripts['dev:all']).toBeUndefined()
    expect(existsSync(new URL('scripts/dev.ts', root))).toBe(true)
    expect(existsSync(new URL('scripts/vite.ts', root))).toBe(true)
    expect(existsSync(new URL('scripts/dev-all.ts', root))).toBe(false)

    const script = readSiteFile('scripts/dev.ts')
    // Spawns cms + vite without a recursive `bun run dev` call.
    expect(script).toContain("bunCommand('--watch', 'server/index.ts')")
    expect(script).toContain("viteCommand('--host', '127.0.0.1'")
    expect(script).not.toContain('command: `vite')
    expect(script).not.toContain('command.split')
    // Knows about the docker postgres host port.
    expect(script).toContain('127.0.0.1')
    expect(script).toContain('5433')
    // Manages the docker postgres + app containers.
    expect(script).toContain('compose')
    expect(script).toContain('postgres')
    expect(script).toContain('app')
    // Forwards signals to children.
    expect(script).toContain('SIGINT')
    expect(script).toContain('SIGTERM')
  })

  it('development launchers route local Vite binaries through Bun on Windows', () => {
    const devScript = readSiteFile('scripts/dev.ts')
    const e2eScript = readSiteFile('scripts/e2e-dev.ts')
    const startScript = readSiteFile('scripts/start.ts')
    const viteScript = readSiteFile('scripts/vite.ts')

    expect(bunCommand('--watch', 'server/index.ts')).toEqual([
      process.execPath,
      '--watch',
      'server/index.ts',
    ])
    const viteDevCommand = viteCommand('--host', '127.0.0.1')
    expect(viteDevCommand[0]).toBe(process.execPath)
    expect(viteDevCommand[1].replaceAll('\\', '/')).toEndWith('/node_modules/vite/bin/vite.js')
    expect(viteDevCommand.slice(2)).toEqual(['--host', '127.0.0.1'])
    expect(existsSync(viteDevCommand[1])).toBe(true)

    expect(devScript).toContain("viteCommand('--host', '127.0.0.1'")
    expect(devScript).not.toContain("bunRunCommand('dev:vite'")
    expect(devScript).not.toContain("bunRunCommand('vite'")
    expect(devScript).not.toContain('command: `vite')
    expect(devScript).not.toContain('command.split')
    expect(e2eScript).toContain("viteCommand('--host', '127.0.0.1'")
    expect(e2eScript).not.toContain("bunRunCommand('dev:vite'")
    expect(e2eScript).not.toContain("bunRunCommand('vite'")
    expect(e2eScript).not.toContain("['vite'")
    expect(e2eScript).not.toContain("['bun'")
    expect(viteScript).toContain('viteCommand(...Bun.argv.slice(2))')
    expect(viteScript).not.toContain("['vite'")
    expect(startScript).toContain("bunRunCommand('build')")
    expect(startScript).toContain("bunRunCommand('server/index.ts')")
    expect(startScript).not.toContain("['bun'")
  })

  it('Vite proxies CMS API and uploaded media to the local Bun server', () => {
    const viteConfig = readSiteFile('vite.config.ts')

    // `/admin/api` covers both the CMS endpoints (`/admin/api/cms/...`) and
    // the agent endpoints (`/admin/api/agent`, `/admin/api/agent/tool-result`).
    // The shared `/admin/` prefix is required so the session cookie (scoped
    // to `Path=/admin`) is sent on every request to the Bun backend.
    expect(viteConfig).toContain("'/admin/api'")
    expect(viteConfig).toContain("'/uploads'")
    expect(viteConfig).toContain("const CMS_DEV_SERVER_ORIGIN = `http://localhost:${process.env.PORT ?? '3001'}`")
    expect(viteConfig).toContain('target: CMS_DEV_SERVER_ORIGIN')
    expect(viteConfig).toContain('changeOrigin: true')
  })

  it('Vite forwards WebSocket upgrades, so the collab socket is same-origin in dev', () => {
    const viteConfig = readSiteFile('vite.config.ts')
    const devScript = readSiteFile('scripts/dev.ts')

    // Since Bun 1.4.1 the node:http client emits 'upgrade', so the collab
    // socket rides the same proxy as every other /admin/api request and the
    // dev server is same-origin like production. No port is dialled directly.
    expect(viteConfig).toMatch(/^\s*ws:\s*true/m)
    expect(viteConfig).not.toContain('VITE_CMS_DEV_PORT')

    // dev.ts must hand PORT to the Vite child so the proxy target cannot
    // drift from the CMS it started (both defaults happen to be 3001).
    expect(devScript).toContain('env: { PORT: String(CMS_PORT) }')
  })

  it('Vite forwards GET and HEAD public pages, runtimes and PDFs to the CMS', async () => {
    const middleware = await publicSiteMiddleware()
    const upstream = spyOn(globalThis, 'fetch').mockImplementation(async () => (
      new Response('published content', { status: 200 })
    ))
    const origin = `http://localhost:${process.env.PORT ?? '3001'}`
    const routes = [
      '/',
      '/azienda',
      '/en/cloud-server?plan=start',
      '/_instatic/assets/site/classic/site.js',
      '/_instatic/visitor-preferences.js',
      '/media/legal/contratti/sla.pdf',
    ]

    try {
      for (const method of ['GET', 'HEAD']) {
        for (const route of routes) {
          const result = await runPublicSiteRequest(middleware, method, route)

          expect(result).toEqual({
            passedThrough: false,
            status: 200,
            body: method === 'GET' ? 'published content' : undefined,
          })
          const [target, options] = upstream.mock.calls.at(-1) ?? []
          expect(String(target)).toBe(`${origin}${route}`)
          expect(options).toMatchObject({ method, redirect: 'manual' })
        }
      }
      expect(upstream).toHaveBeenCalledTimes(routes.length * 2)
    } finally {
      upstream.mockRestore()
    }
  })

  it('Vite leaves editor assets and non-read requests to the remaining middleware', async () => {
    const middleware = await publicSiteMiddleware()
    const upstream = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Editor assets and non-read requests must not reach the CMS page proxy')
    })
    const editorRoutes = [
      '/admin',
      '/admin/site?page=401',
      '/admin/api/cms/site-socket',
      '/index.html',
      '/@vite/client',
      '/@fs/workspace/example.html',
      '/__vite_ping',
      '/src/main.tsx',
      '/node_modules/vite/client.js',
      '/assets/editor.js',
      '/runtime/editor.js',
      '/favicon.svg',
      '/api/example',
      '/uploads/example.pdf',
    ]

    try {
      for (const method of ['GET', 'HEAD']) {
        for (const route of editorRoutes) {
          expect(await runPublicSiteRequest(middleware, method, route))
            .toEqual({ passedThrough: true })
        }
      }
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
        expect(await runPublicSiteRequest(middleware, method, '/azienda'))
          .toEqual({ passedThrough: true })
      }
      expect(upstream).not.toHaveBeenCalled()
    } finally {
      upstream.mockRestore()
    }
  })

  it('Docker Postgres uses a non-default host port for local dev', () => {
    const compose = readSiteFile('docker-compose.yml')

    // docker-compose.yml is dev-only and only exposes the Postgres container
    // on a non-default host port (5433) to avoid clashing with a local
    // Postgres install. The DATABASE_URL the app uses to reach the container
    // lives in compose.prod.yml — not in the dev-only compose file.
    expect(compose).toContain('"5433:5432"')
    expect(compose).toContain('image: postgres:16')
  })
})

describe('Bun version guard wiring', () => {
  // The guard is worthless unless every launcher actually calls it, and the
  // server must only warn: a direct install must keep serving on an old Bun.
  it('both dev launchers refuse an old Bun before starting anything', () => {
    for (const script of ['scripts/dev.ts', 'scripts/e2e-dev.ts']) {
      const src = readSiteFile(script)
      expect(src).toContain("from '../server/bunVersion'")
      expect(src).toContain('devStackBunError(Bun.version)')
    }
  })

  it('the server logs the unsupported-Bun warning and boots anyway', () => {
    const src = readSiteFile('server/index.ts')
    expect(src).toContain('unsupportedBunWarning(Bun.version)')
    expect(src).toContain('console.warn(bunWarning)')
    expect(src).not.toContain('devStackBunError')
  })
})
