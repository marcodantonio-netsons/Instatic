/**
 * Data access for published data rows.
 *
 *   persistDataRowPublish         — transactional write of one row publish:
 *                                   append a new data_row_versions row, flip
 *                                   the row to `published`, write
 *                                   `active_version_id`, and (when the slug
 *                                   changed) record a redirect from the
 *                                   previous public path
 *   getPublishedDataRowByRoute    — resolve a public URL to the active
 *                                   identity of a row, before payload admission
 *   getDataRowRedirectByRoute     — resolve a public URL to a redirect target
 *                                   when the URL belongs to a
 *                                   previously-published slug
 *   listPublishedRowRoutes        — every published row route (for the bake)
 *   getRowTableRouteInfo          — route base + table slug for one row
 *   getRowTableRouteBase          — route base only, ignoring soft deletes
 *
 * Data access ONLY. The row-publish orchestration (publish lock, Layer A
 * artefact writes, cache bump) lives in `server/publish/publishRow.ts` and
 * calls down into this repository.
 */
import { nanoid } from 'nanoid'
import { placeholder, type DbClient } from '../../db/client'
import { MAIN_SCOPE } from '../../branches/scope'
import type { DataRow, DataRowVersion, DataRowRedirect } from '@core/data/schemas'
import { normalizeRouteBase } from '@core/templates/templateMatching'
import { getDataRow } from './rows'
import { nextDataRowVersionNumber } from './versions'
import { DataRowRouteIdentitySchema, type DataRowRouteIdentity } from '@core/data-read'
import { safeParseValue } from '@core/utils/typeboxHelpers'
import { isoDate, nowIso } from '@core/utils/isoDate'

// ---------------------------------------------------------------------------
// Internal row shapes
// ---------------------------------------------------------------------------

interface PublishedDataRowIdentityRow {
  version_id: string | null
  version_number: number | string | null
  row_id: string
  table_id: string
  table_slug: string
  slug: string
}

interface PreviousPublishedRouteRow {
  previous_slug: string
  previous_route_base: string
}

interface DataRowRedirectRow {
  id: string
  from_route_base: string
  from_slug: string
  target_route_base: string
  target_slug: string
}

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/** The public route a row's previously-published version was served under. */
export interface PreviousPublishedRoute {
  slug: string
  routeBase: string
}

export interface PersistDataRowPublishResult {
  row: DataRow
  version: DataRowVersion
  /**
   * The route of the version that was active BEFORE this publish, or `null`
   * on a first publish. The orchestrator uses it to prune the stale Layer A
   * artefact when the slug changed.
   */
  previousRoute: PreviousPublishedRoute | null
}

export interface RowTableRouteInfo {
  tableRouteBase: string
  tableSlug: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Public URL path for a row: `<normalized route base>/<slug>`. */
export function publicDataPath(routeBase: string, slug: string): string {
  const normalizedBase = normalizeRouteBase(routeBase)
  return `${normalizedBase === '/' ? '' : normalizedBase}/${slug}`
}

/** True when the previously-published route differs from the current slug's. */
export function previousRouteChanged(previous: PreviousPublishedRoute, currentSlug: string): boolean {
  return (
    previous.slug.length > 0 &&
    publicDataPath(previous.routeBase, previous.slug) !==
      publicDataPath(previous.routeBase, currentSlug)
  )
}

// ---------------------------------------------------------------------------
// Publish persistence
// ---------------------------------------------------------------------------

/**
 * Transactional write of one row publish. DB writes only — the publish lock,
 * artefact bake, and cache bump are owned by `server/publish/publishRow.ts`.
 */
export async function persistDataRowPublish(
  db: DbClient,
  rowId: string,
  /**
   * The user attributed as the publisher. `null` is allowed for system
   * actors that have no user context — e.g. the scheduled-publish tick
   * (`server/publish/publishScheduler.ts`) which fires once
   * `scheduled_publish_at` is in the past. The `published_by_user_id`
   * column on `data_rows` is nullable (`on delete set null`), so a
   * null publisher round-trips cleanly through the schema.
   */
  publisherUserId: string | null,
): Promise<PersistDataRowPublishResult> {
  // Publishing only exists on `main`: versions and redirects reference main
  // rows, whose physical and logical ids coincide.
  return db.transaction(async (tx) => {
    const row = await getDataRow(tx, MAIN_SCOPE, rowId)
    if (!row) throw new Error('data row not found')

    const previousRoute = await readPreviousPublishedRoute(tx, rowId)
    const versionNumber = await nextDataRowVersionNumber(tx, rowId)
    const versionId = nanoid()

    await tx`
      insert into data_row_versions
        (id, row_id, version_number, cells_json, slug, published_by_user_id)
      values (
        ${versionId},
        ${row.id},
        ${versionNumber},
        ${row.cells},
        ${row.slug},
        ${publisherUserId}
      )
    `

    const now = nowIso()
    const { rows: updateRows } = await tx<{ id: string }>`
      update data_rows
      set status = 'published',
          active_version_id = ${versionId},
          published_by_user_id = ${publisherUserId},
          published_at = ${now},
          updated_by_user_id = ${publisherUserId},
          updated_at = ${now}
      where id = ${row.id}
        and deleted_at is null
      returning id
    `
    if (!updateRows[0]) throw new Error('data row publish update failed')

    if (previousRoute && previousRouteChanged(previousRoute, row.slug)) {
      await tx`
        insert into data_row_redirects (id, table_id, from_route_base, from_slug, target_row_id)
        values (
          ${nanoid()},
          ${row.tableId},
          ${normalizeRouteBase(previousRoute.routeBase)},
          ${previousRoute.slug},
          ${row.id}
        )
        on conflict (from_route_base, from_slug) do update
          set table_id = excluded.table_id,
              target_row_id = excluded.target_row_id
      `
    }

    const publishedRow = await getDataRow(tx, MAIN_SCOPE, row.id)
    if (!publishedRow) throw new Error('data row could not be re-read after publish')

    const publishedAt = publishedRow.publishedAt ?? new Date().toISOString()
    return {
      row: publishedRow,
      version: {
        id: versionId,
        rowId: publishedRow.id,
        versionNumber,
        cells: publishedRow.cells,
        slug: publishedRow.slug,
        publishedByUserId: publisherUserId,
        publishedAt,
        createdAt: publishedAt,
      },
      previousRoute,
    }
  })
}

async function readPreviousPublishedRoute(
  db: DbClient,
  rowId: string,
): Promise<PreviousPublishedRoute | null> {
  const { rows } = await db<PreviousPublishedRouteRow>`
    select data_row_versions.slug as previous_slug,
           data_tables.route_base as previous_route_base
    from data_rows
    join data_tables on data_tables.id = data_rows.table_id
    join data_row_versions on data_row_versions.id = data_rows.active_version_id
    where data_rows.id = ${rowId}
      and data_rows.deleted_at is null
      and data_tables.deleted_at is null
    limit 1
  `
  return rows[0]
    ? { slug: rows[0].previous_slug, routeBase: rows[0].previous_route_base }
    : null
}

// ---------------------------------------------------------------------------
// Route info lookups
// ---------------------------------------------------------------------------

/**
 * Fetch the `route_base` and `slug` of the `data_tables` row that owns
 * the given data row. Used by the artefact writer in
 * `server/publish/publishRow.ts` to resolve the public URL path without
 * joining the table into every other query.
 */
export async function getRowTableRouteInfo(
  db: DbClient,
  rowId: string,
): Promise<RowTableRouteInfo | null> {
  const { rows } = await db<{ route_base: string; table_slug: string }>`
    select data_tables.route_base,
           data_tables.slug as table_slug
    from data_rows
    join data_tables on data_tables.id = data_rows.table_id
    where data_rows.id = ${rowId}
      and data_rows.deleted_at is null
      and data_tables.deleted_at is null
    limit 1
  `
  if (!rows[0]) return null
  return {
    tableRouteBase: normalizeRouteBase(rows[0].route_base),
    tableSlug: rows[0].table_slug,
  }
}

/**
 * The owning table's raw `route_base` for a row, resolved WITHOUT the
 * `deleted_at is null` filters — artefact removal must still resolve the
 * route after a soft delete (ISS-039).
 */
export async function getRowTableRouteBase(
  db: DbClient,
  rowId: string,
): Promise<string | null> {
  const { rows } = await db<{ route_base: string }>`
    select data_tables.route_base
    from data_rows
    join data_tables on data_tables.id = data_rows.table_id
    where data_rows.id = ${rowId}
    limit 1
  `
  return rows[0]?.route_base ?? null
}

// ---------------------------------------------------------------------------
// Public-route lookups
// ---------------------------------------------------------------------------

interface PublishedRowRoute {
  rowId: string
  /** Slug of the row's ACTIVE published version (what the public URL uses). */
  rowSlug: string
  tableSlug: string
  tableRouteBase: string
}

/**
 * Every published, non-deleted data row (excluding the `pages` table) with
 * its active version's slug and its table's route info. The full publish uses
 * this to bake a Layer A artefact for each row route into the fresh slot —
 * without it, the slot swap would strand every row artefact written by
 * incremental publishes.
 */
export async function listPublishedRowRoutes(db: DbClient): Promise<PublishedRowRoute[]> {
  const { rows } = await db<{
    row_id: string
    row_slug: string
    table_slug: string
    table_route_base: string
  }>`
    select data_rows.id as row_id,
           data_row_versions.slug as row_slug,
           data_tables.slug as table_slug,
           data_tables.route_base as table_route_base
    from data_rows
    join data_tables on data_tables.id = data_rows.table_id
    join data_row_versions on data_row_versions.id = data_rows.active_version_id
    where data_rows.table_id <> 'pages'
      and data_rows.status = 'published'
      and data_rows.deleted_at is null
      and data_tables.deleted_at is null
    order by data_rows.created_at asc
  `
  return rows.map((row) => ({
    rowId: row.row_id,
    rowSlug: row.row_slug,
    tableSlug: row.table_slug,
    tableRouteBase: normalizeRouteBase(row.table_route_base),
  }))
}

/** Resolve only the native active identity, before reading schema, cells or people. */
export async function getPublishedDataRowByRoute(
  db: DbClient, tableRouteBase: string, rowSlug: string,
): Promise<DataRowRouteIdentity | null> {
  const p = (n: number) => placeholder(db.dialect, n)
  const { rows } = await db.unsafe<PublishedDataRowIdentityRow>(
    `select case when data_tables.kind = 'data' then null else data_row_versions.id end as version_id,
            case when data_tables.kind = 'data' then null else data_row_versions.version_number end as version_number,
            data_rows.logical_id as row_id,
            data_tables.logical_id as table_id,
            data_tables.slug as table_slug,
            case when data_tables.kind = 'data' then data_rows.slug else data_row_versions.slug end as slug
     from data_rows
     join data_tables on data_tables.id = data_rows.table_id
     left join data_row_versions on data_row_versions.id = data_rows.active_version_id
     where data_tables.route_base = ${p(1)}
       and (case when data_tables.kind = 'data' then data_rows.slug else data_row_versions.slug end) = ${p(2)}
       and data_rows.branch_id = ${p(3)}
       and (data_tables.kind = 'data' or (data_rows.status = 'published' and data_row_versions.id is not null))
       and data_rows.deleted_at is null
       and data_tables.deleted_at is null
     limit 1`,
    [normalizeRouteBase(tableRouteBase), rowSlug, MAIN_SCOPE.branchId],
  )
  if (!rows[0]) return null
  const row = rows[0]
  const parsed = safeParseValue(DataRowRouteIdentitySchema, {
    tableId: row.table_id, tableSlug: row.table_slug, rowId: row.row_id, slug: row.slug,
    version: row.version_id === null ? null : { id: row.version_id, number: Number(row.version_number) },
  })
  if (!parsed.ok) throw new Error('The stored public row route identity is invalid')
  return parsed.value
}

export async function getDataRowRedirectByRoute(
  db: DbClient,
  tableRouteBase: string,
  rowSlug: string,
): Promise<DataRowRedirect | null> {
  const normalizedBase = normalizeRouteBase(tableRouteBase)

  const { rows } = await db<DataRowRedirectRow>`
    select data_row_redirects.id,
           data_row_redirects.from_route_base,
           data_row_redirects.from_slug,
           data_tables.route_base as target_route_base,
           data_row_versions.slug as target_slug
    from data_row_redirects
    join data_rows target_rows on target_rows.id = data_row_redirects.target_row_id
    join data_tables on data_tables.id = target_rows.table_id
    join data_row_versions on data_row_versions.id = target_rows.active_version_id
    where data_row_redirects.from_route_base = ${normalizedBase}
      and data_row_redirects.from_slug = ${rowSlug}
      and target_rows.status = 'published'
      and target_rows.deleted_at is null
      and data_tables.deleted_at is null
    limit 1
  `

  if (!rows[0]) return null

  const queryRow = rows[0]
  const fromPath = publicDataPath(queryRow.from_route_base, queryRow.from_slug)
  const targetPath = publicDataPath(queryRow.target_route_base, queryRow.target_slug)
  if (fromPath === targetPath) return null

  return { id: queryRow.id, fromPath, targetPath }
}

// ---------------------------------------------------------------------------
// Bundle export / import — raw redirect rows
// ---------------------------------------------------------------------------

/**
 * A redirect serialized for bundle transfer, in raw column form (camelCased).
 * Shape-compatible with `BundleRedirect` in `@core/data/bundleSchema` so the
 * export handler can pass these straight through.
 */
export interface ExportableRedirect {
  id: string
  tableId: string
  fromRouteBase: string
  fromSlug: string
  targetRowId: string
}

interface ExportableRedirectRow {
  id: string
  table_id: string
  from_route_base: string
  from_slug: string
  target_row_id: string
}

/** Every redirect, raw, for a full-site export. */
export async function listExportableRedirects(db: DbClient): Promise<ExportableRedirect[]> {
  const { rows } = await db<ExportableRedirectRow>`
    select id, table_id, from_route_base, from_slug, target_row_id
    from data_row_redirects
    order by from_route_base asc, from_slug asc
  `
  return rows.map((row) => ({
    id: row.id,
    tableId: row.table_id,
    fromRouteBase: row.from_route_base,
    fromSlug: row.from_slug,
    targetRowId: row.target_row_id,
  }))
}

/** Wipe all redirects — used by the `replace` import strategy before reinsert. */
export async function deleteAllDataRowRedirects(db: DbClient): Promise<void> {
  await db`delete from data_row_redirects`
}

/**
 * Insert a redirect preserving its original id, upserting on the unique
 * (from_route_base, from_slug) source key. Used by the bundle import handler.
 */
export async function importDataRowRedirect(db: DbClient, input: ExportableRedirect): Promise<void> {
  await db`
    insert into data_row_redirects (id, table_id, from_route_base, from_slug, target_row_id)
    values (
      ${input.id},
      ${input.tableId},
      ${input.fromRouteBase},
      ${input.fromSlug},
      ${input.targetRowId}
    )
    on conflict (from_route_base, from_slug) do update
      set table_id = excluded.table_id,
          target_row_id = excluded.target_row_id
  `
}
