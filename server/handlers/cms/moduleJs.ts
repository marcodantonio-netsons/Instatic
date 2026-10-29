/**
 * `/_instatic/module-js/<moduleId>.js` — per-module published-JS assets.
 *
 * Modules declare invariant `assets.js` on their definition; the publisher
 * dedupes it per moduleId and pages reference it via
 * `<script src="/_instatic/module-js/<id>.js?v=<publishVersion>" defer>` tags
 * injected by `injectModuleScripts`. This endpoint serves the body from the
 * active static generation. Sites with static artefacts disabled build the
 * site-wide module-JS map through a versioned single-flight (`?v=` is a pure
 * cache-buster — the content always reflects the LATEST published generation).
 *
 * The `<moduleId>` path segment is UNTRUSTED input: it is validated against
 * the namespaced-module-id grammar before any lookup, so traversal sequences
 * and junk ids are rejected with a plain 404 (public route — no error
 * envelope).
 */
import type { DbClient } from '../../db/client'
import { createHash } from 'node:crypto'
import { registry } from '@core/module-engine'
import { buildPublishedSiteModuleJsMap, MODULE_JS_PATH_PREFIX, moduleJsAssetPath, moduleJsIdFromAssetPath } from '../../publish/moduleJsBundle'
import { createVersionedSingleFlight, getPublishVersion } from '../../publish/publishState'
import { getLatestSnapshotForVersion } from '../../publish/publishedSnapshotCache'
import { readStaticAsset } from '../../publish/staticArtefact'
import { binaryResponse } from '../../binary'

export function isModuleJsAssetPath(pathname: string): boolean {
  return pathname.startsWith(MODULE_JS_PATH_PREFIX)
}

interface ModuleJsHandlerContext {
  db: DbClient
  uploadsDir?: string
}

// Without static artefacts, memoize the published module-JS map. Snapshot +
// walking every page per request would be the same per-request cost the hole
// endpoint was flagged for — the single-flight runs the load once per publish
// version and the shared test-reset hook clears it.
const moduleJsMapCache = createVersionedSingleFlight<ReadonlyMap<string, string>>()

function loadModuleJsMapForVersion(
  db: DbClient,
  version: number,
): Promise<ReadonlyMap<string, string> | null> {
  return moduleJsMapCache.get(version, async () => {
    const snapshot = await getLatestSnapshotForVersion(db, version)
    if (!snapshot) return null
    return buildPublishedSiteModuleJsMap(snapshot.site, registry)
  })
}

function plainResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

function scriptResponse(req: Request, body: string | Uint8Array): Response {
  const etag = `"${createHash('sha256').update(body).digest('hex')}"`
  const headers = {
    'content-type': 'text/javascript; charset=utf-8',
    // The process-local ?v= counter can repeat after a server restart.
    'cache-control': 'public, no-cache',
    'etag': etag,
    'x-content-type-options': 'nosniff',
  }
  const unchanged = (req.headers.get('if-none-match') ?? '').split(',')
    .some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag)
  if (unchanged) return new Response(null, { status: 304, headers })
  return typeof body === 'string' ? new Response(body, { headers }) : binaryResponse(body, { headers })
}

/** GET `/_instatic/module-js/<moduleId>.js?v=<publishVersion>` → JS body. */
export async function handleModuleJsAssetRequest(
  req: Request,
  url: URL,
  ctx: ModuleJsHandlerContext,
): Promise<Response> {
  if (req.method !== 'GET') return plainResponse('Method not allowed', 405)

  const moduleId = moduleJsIdFromAssetPath(url.pathname)
  if (!moduleId) {
    return plainResponse('Not found', 404)
  }

  if (ctx.uploadsDir) {
    const bytes = await readStaticAsset(ctx.uploadsDir, moduleJsAssetPath(moduleId))
    return bytes ? scriptResponse(req, bytes) : plainResponse('Not found', 404)
  }

  const jsMap = await loadModuleJsMapForVersion(ctx.db, getPublishVersion())
  const body = jsMap?.get(moduleId)
  if (body === undefined) return plainResponse('Not found', 404)

  return scriptResponse(req, body)
}
