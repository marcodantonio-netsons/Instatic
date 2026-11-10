/**
 * Version-keyed caches over the latest published site snapshot.
 *
 * The public router's entry/404 resolution and the Layer C hole endpoint
 * share one latest published site snapshot per publish version:
 *
 *   - the public router's row-route resolution (`publicRouter.ts`)
 *   - the Layer C hole endpoint (`handlers/cms/hole.ts`)
 *
 * This module owns the per-version published snapshot memo built on
 * `createVersionedSingleFlight` from `publishState.ts`: one concurrent loader
 * per version, cached until the version changes, reset together with the rest
 * of the publish state in tests. Hole lookup resolves the forwarded public
 * route and its composed render context rather than indexing raw page nodes;
 * template composition can change both a rendered node's id and its owner.
 *
 * The publish-time bake may pass `nextPublishVersion` (the version that
 * becomes current the instant `bumpPublishVersion()` runs after the slot
 * swap) — that pre-warms the memo for the version visitors are about to hit.
 */

import type { DbClient } from '../db/client'
import type { SiteDocument } from '@core/page-tree'
import type { PublishedPageSnapshot } from '../repositories/publish'
import { getLatestPublishedSiteSnapshot } from '../repositories/publish'
import { createVersionedSingleFlight } from './publishState'
import { contentHash } from '../branches/contentHash'

// ---------------------------------------------------------------------------
// Latest snapshot
// ---------------------------------------------------------------------------

// Published documents are immutable. Cache the fingerprint by object identity
// so a full-site bake hashes the document once, not once per rendered page.
const snapshotHashes = new WeakMap<SiteDocument, string>()

/** Stable across cache invalidations and process restarts; changes with the frozen site. */
export function getPublishedSnapshotHash(site: SiteDocument): string {
  let hash = snapshotHashes.get(site)
  if (hash === undefined) {
    hash = contentHash(site)
    snapshotHashes.set(site, hash)
  }
  return hash
}

const snapshotMemo = createVersionedSingleFlight<PublishedPageSnapshot>()

/**
 * The latest published site snapshot for `version`. Loads (and JSON-parses)
 * it from the DB once per publish version; warm calls do zero I/O.
 */
export function getLatestSnapshotForVersion(
  db: DbClient,
  version: number,
): Promise<PublishedPageSnapshot | null> {
  return snapshotMemo.get(version, () => getLatestPublishedSiteSnapshot(db))
}
