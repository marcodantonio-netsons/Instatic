/**
 * Built-in `data.rows` loop source — iterates published data rows from a
 * data table (post-type or generic data-kind).
 *
 * Reads from `data_row_versions` joined to `data_rows`, `data_tables`, and
 * user/role tables, scoped to rows with `status = 'published'`. Featured
 * media resolution is handled in app code (not SQL) so the query stays
 * dialect-naive: after fetching the page of rows, a single batch query
 * resolves all unique media ids to their `public_path`.
 *
 * Order options:
 *   - publishedAt — most natural for post-type listings
 *   - createdAt   — first authored
 *   - updatedAt   — last modified
 *   - slug        — alphabetical by slug (closest dialect-neutral proxy for
 *                   title, which lives inside cells_json)
 *
 * Filters:
 *   - tableId (required) — the data table to iterate
 */

import { MAIN_BRANCH_ID, physicalId } from '@core/branches'
import type { LoopEntitySource, LoopFetchResult, LoopItem, LoopSourceDb } from '../types'
import { matchesCellFilter, parseCellFilter, parseCellOrder, type CellFilter } from '../cellFilter'
import { canUseCellSearchSql, scoreCellSearch, parseCellSearch, type CellSearch } from '../cellSearch'
import { isoDate } from '../../utils/isoDate'
import { firstImagePathFromMarkdown } from '@core/markdown/renderMarkdown'
import { normalizeRouteBase } from '@core/templates/templateMatching'
import { publicDataUserFromParts } from '@core/data/publicDataUser'
import { normalizeDataTableFields } from '@core/data/fields'
import { LocalizationError } from '@core/localization'
import { hasLocalizedDataFields, projectLocalizedDataCells, compareDataCellValues, type DataLocalizationContext } from '@core/data/localizedCells'
import { readFeaturedMediaCell } from '@core/data/cells'
import type { DataField, DataRowCells } from '@core/data/schemas'
import { collectMediaIds, resolveMediaIdsToPaths, resolvedMediaOverlay } from './dataRowsMedia'
import {
  ALLOWED_ORDER_BY,
  countDataKindRows,
  countPublishedPostRows,
  fetchDataTableProjection,
  fetchDataKindRowPage,
  fetchPublishedDataRowPage,
  type DataKindRowSqlRow,
  type OrderColumn,
  type PublishedDataRowSqlRow,
} from './dataRowsQueries'
import { parseValue, Type } from '../../utils/typeboxHelpers'

// ---------------------------------------------------------------------------
// Row → LoopItem projection
// ---------------------------------------------------------------------------

function rowToLoopItem(
  row: PublishedDataRowSqlRow,
  mediaPathMap: Map<string, string>,
  fields: readonly DataField[],
): LoopItem {
  const cells = row.cells_json as DataRowCells
  const tableRouteBase = normalizeRouteBase(row.table_route_base || `/${row.table_slug}`)
  const permalink = `${tableRouteBase === '/' ? '' : tableRouteBase}/${row.slug}`

  // Extract first inline image from the `body` cell (post-type rows only).
  const bodyValue = cells['body']
  const firstImagePath = typeof bodyValue === 'string'
    ? firstImagePathFromMarkdown(bodyValue)
    : null

  const featuredMediaId = readFeaturedMediaCell(cells)
  const featuredMediaPath = featuredMediaId ? (mediaPathMap.get(featuredMediaId) ?? null) : null

  const author = publicDataUserFromParts(
    row.author_display_name,
    row.author_role_slug,
    row.author_role_name,
  )
  const publishedBy = publicDataUserFromParts(
    row.published_by_display_name,
    row.published_by_role_slug,
    row.published_by_role_name,
  )

  return {
    id: row.row_id,
    fields: {
      // Cells — all user-defined fields accessible by fieldId
      ...cells,
      // Media fields: replace stored ids with resolved public paths so a
      // `{currentEntry.<field>}` binding renders a URL, not the raw id.
      ...resolvedMediaOverlay(cells, fields, mediaPathMap),
      // System identity (overlay after cells so these are never shadowed)
      id: row.row_id,
      rowId: row.row_id,
      versionId: row.version_id,
      versionNumber: Number(row.version_number),
      tableId: row.table_id,
      tableSlug: row.table_slug,
      // People — display names, never the reference object. See loopPrefetch.
      author: author?.displayName ?? null,
      authorName: author?.displayName ?? null,
      authorRoleSlug: author?.roleSlug ?? null,
      authorRoleName: author?.roleName ?? null,
      publishedBy: publishedBy?.displayName ?? null,
      publishedByName: publishedBy?.displayName ?? null,
      publishedByRoleSlug: publishedBy?.roleSlug ?? null,
      publishedByRoleName: publishedBy?.roleName ?? null,
      // Media aliases
      featuredMediaId,
      featuredMedia: featuredMediaPath,
      featuredMediaPath,
      featuredMediaUrl: featuredMediaPath,
      firstImage: firstImagePath,
      firstImagePath,
      firstImageUrl: firstImagePath,
      // Dates / routing
      slug: row.slug,
      publishedAt: isoDate(row.published_at),
      createdAt: isoDate(row.created_at),
      updatedAt: isoDate(row.updated_at),
      permalink,
    },
  }
}

// ---------------------------------------------------------------------------
// Row → LoopItem projection
// ---------------------------------------------------------------------------

function dataKindRowToLoopItem(
  row: DataKindRowSqlRow,
  mediaPathMap: Map<string, string>,
  fields: readonly DataField[],
): LoopItem {
  const cells = row.cells_json as DataRowCells
  const tableRouteBase = normalizeRouteBase(row.table_route_base || `/${row.table_slug}`)
  const permalink = `${tableRouteBase === '/' ? '' : tableRouteBase}/${row.slug}`

  const featuredMediaId = readFeaturedMediaCell(cells)
  const featuredMediaPath = featuredMediaId ? (mediaPathMap.get(featuredMediaId) ?? null) : null

  const author = publicDataUserFromParts(
    row.author_display_name,
    row.author_role_slug,
    row.author_role_name,
  )

  return {
    id: row.row_id,
    fields: {
      ...cells,
      // Media fields: replace stored ids with resolved public paths (see
      // `rowToLoopItem`).
      ...resolvedMediaOverlay(cells, fields, mediaPathMap),
      id: row.row_id,
      rowId: row.row_id,
      tableId: row.table_id,
      tableSlug: row.table_slug,
      author,
      authorName: author?.displayName ?? null,
      authorRoleSlug: author?.roleSlug ?? null,
      authorRoleName: author?.roleName ?? null,
      publishedBy: null,
      publishedByName: null,
      publishedByRoleSlug: null,
      publishedByRoleName: null,
      featuredMediaId,
      featuredMedia: featuredMediaPath,
      featuredMediaPath,
      featuredMediaUrl: featuredMediaPath,
      firstImage: null,
      firstImagePath: null,
      firstImageUrl: null,
      slug: row.slug,
      // Data-kind rows have no publishedAt — use createdAt as a proxy so
      // ordering / display stays consistent across both kinds.
      publishedAt: isoDate(row.created_at),
      createdAt: isoDate(row.created_at),
      updatedAt: isoDate(row.updated_at),
      permalink,
    },
  }
}

// ---------------------------------------------------------------------------
// Reusable fetch helper
//
// Extracted so both the publisher (`DataRowsSource.fetch`) and the admin
// loop-preview endpoint can return the same LoopItem projection without
// duplicating SQL or media-path logic. The admin endpoint doesn't have a
// `SourceFetchContext` to hand in — it only knows `(db, tableId, orderBy,
// direction, limit, offset)` — so this helper accepts those directly.
//
// Dispatch by table kind: post-type tables use the published-version join
// (active_version_id), data-kind tables read `data_rows` directly because
// they have no version workflow.
// ---------------------------------------------------------------------------

export async function fetchPublishedDataRowItems(
  db: LoopSourceDb,
  opts: {
    tableId: string
    orderBy: string
    direction: 'asc' | 'desc'
    limit: number
    offset: number
    /** Optional condition on one of the row's own cells. */
    cellFilter?: CellFilter | null
    cellSearch?: CellSearch | null
    selectedRowIds?: ReadonlySet<string>
    /**
     * Read post-type rows as DRAFTS instead of through their published
     * versions — a branch has no versions (publishing is main-only), so its
     * loops show what the branch would publish.
     */
    drafts?: boolean
    localization?: DataLocalizationContext
    /** Admin previews apply own/any row authorization before counting or slicing. */
    readableRowIds?: ReadonlySet<string>
  },
): Promise<LoopFetchResult> {
  if (!opts.tableId) return { items: [], totalItems: 0 }
  const cellFilter = opts.cellFilter ?? null
  const cellSearch = opts.cellSearch ?? null

  const table = await fetchDataTableProjection(db, opts.tableId)
  if (!table) return { items: [], totalItems: 0 }
  const fields = normalizeDataTableFields(table.fields_json)
  const localized = hasLocalizedDataFields(fields)
  if (localized && !opts.localization?.translations) throw new LocalizationError(`tables.${opts.tableId}`, 'Choose a configured content language to resolve localized data')
  // Keep locale validation above, then avoid constructing an empty `IN ()`.
  if (opts.selectedRowIds?.size === 0) return { items: [], totalItems: 0 }
  // Derived texts must be filtered and ordered before pagination. Admin row
  // visibility uses this same sequence, so counts cannot expose hidden rows.
  if (localized || opts.readableRowIds || opts.selectedRowIds || (cellSearch && !canUseCellSearchSql(cellSearch))) {
    const direction = opts.direction === 'asc' ? 'asc' : 'desc'
    const orderBy: OrderColumn = ALLOWED_ORDER_BY.has(opts.orderBy as OrderColumn) ? opts.orderBy as OrderColumn : 'publishedAt'
    const orderCell = parseCellOrder(opts.orderBy)
    const dataKind = table.kind === 'data' || opts.drafts === true
    const sqlRows = dataKind
      ? await fetchDataKindRowPage(db, orderBy, direction, {
        tableId: opts.tableId,
        limit: 2147483647,
        offset: 0,
        filter: null,
        orderCell: null,
        excludeUnpublished: table.kind !== 'data',
        selectedRowIds: opts.selectedRowIds,
      })
      : await fetchPublishedDataRowPage(db, orderBy, direction, {
        tableId: opts.tableId,
        limit: 2147483647,
        offset: 0,
        filter: null,
        orderCell: null,
        selectedRowIds: opts.selectedRowIds,
      })
    const visibleRows = sqlRows.filter(row => !opts.readableRowIds || opts.readableRowIds.has(row.row_id))
    const projectedRows = visibleRows.map(row => ({ ...row, cells_json: opts.localization
      ? projectLocalizedDataCells(row.cells_json, fields, opts.localization, `rows.${row.row_id}.cells`) : row.cells_json }))
    const scores = new Map<string, number>()
    const matching = projectedRows.filter(row => {
      if (cellFilter && !matchesCellFilter(row.cells_json, cellFilter)) return false
      const score = cellSearch ? scoreCellSearch(row.cells_json, cellSearch) : 1
      scores.set(row.row_id, score)
      return score > 0
    })
    if (orderCell) {
      // Preserve numeric field semantics from cellOrderSql when projection or
      // row authorization requires the same ordering in memory.
      const numeric = fields.some(field => field.id === orderCell.field && field.type === 'number')
      const orderValue = (value: unknown) => numeric
        ? typeof value === 'number' && Number.isFinite(value) ? value : null
        : value ?? ''
      matching.sort((a, b) => compareDataCellValues(orderValue(a.cells_json[orderCell.field]), orderValue(b.cells_json[orderCell.field]), opts.localization?.language, direction)
        || a.row_id.localeCompare(b.row_id))
    }
    // Stable sorting retains the configured source order for equal scores.
    if (cellSearch?.configuration.rank === 'score') {
      const tieField = cellSearch.configuration.tieBreakField
      matching.sort((a, b) => scores.get(b.row_id)! - scores.get(a.row_id)!
        || (tieField ? String(a.cells_json[tieField] ?? '').localeCompare(String(b.cells_json[tieField] ?? ''), opts.localization?.language) : 0))
    }
    const page = matching.slice(opts.offset, opts.offset + opts.limit)
    const mediaPathMap = await resolveMediaIdsToPaths(db, collectMediaIds(page, fields))
    return {
      items: page.map(row => dataKind ? dataKindRowToLoopItem(row as DataKindRowSqlRow, mediaPathMap, fields) : rowToLoopItem(row as PublishedDataRowSqlRow, mediaPathMap, fields)),
      totalItems: matching.length,
    }
  }


  // `orderBy` is either one of the whitelisted columns or `cell:<fieldId>`,
  // in which case the sort runs on the row's own cell (the field name binds
  // as a parameter, so nothing reaches the SQL text).
  const cellOrder = parseCellOrder(opts.orderBy)
  const orderCell = cellOrder ? {
    field: cellOrder.field,
    numeric: fields.some((field) => field.id === cellOrder.field && field.type === 'number'),
  } : null
  const orderBy: OrderColumn = ALLOWED_ORDER_BY.has(opts.orderBy as OrderColumn)
    ? (opts.orderBy as OrderColumn)
    : 'publishedAt'
  const direction: 'asc' | 'desc' = opts.direction === 'asc' ? 'asc' : 'desc'

  const excludeUnpublished = table.kind !== 'data' && opts.drafts === true
  if (table.kind === 'data' || opts.drafts) {
    // The count must apply the same condition, or pagination advertises rows
    // the page query filters out.
    const totalItems = await countDataKindRows(db, {
      tableId: opts.tableId,
      filter: cellFilter,
      search: cellSearch,
      excludeUnpublished,
    })
    if (totalItems === 0) return { items: [], totalItems: 0 }

    const sqlRows = await fetchDataKindRowPage(db, orderBy, direction, {
      tableId: opts.tableId,
      limit: opts.limit,
      offset: opts.offset,
      filter: cellFilter,
      search: cellSearch,
      orderCell,
      excludeUnpublished,
    })
    const mediaPathMap = await resolveMediaIdsToPaths(db, collectMediaIds(sqlRows, fields))
    return {
      items: sqlRows.map((row) => dataKindRowToLoopItem(row, mediaPathMap, fields)),
      totalItems,
    }
  }

  // Post-type path (default): only published rows, joined to active version.
  const totalItems = await countPublishedPostRows(db, {
    tableId: opts.tableId,
    filter: cellFilter,
    search: cellSearch,
  })
  if (totalItems === 0) return { items: [], totalItems: 0 }

  const sqlRows = await fetchPublishedDataRowPage(db, orderBy, direction, {
    tableId: opts.tableId,
    limit: opts.limit,
    offset: opts.offset,
    filter: cellFilter,
    search: cellSearch,
    orderCell,
  })
  const mediaPathMap = await resolveMediaIdsToPaths(db, collectMediaIds(sqlRows, fields))

  return {
    items: sqlRows.map((row) => rowToLoopItem(row, mediaPathMap, fields)),
    totalItems,
  }
}

// ---------------------------------------------------------------------------
// Source export
// ---------------------------------------------------------------------------

export const DataRowsSource: LoopEntitySource = {
  id: 'data.rows',
  label: 'Data rows',
  description: 'Loop published rows in a data table (posts, products, etc.).',
  queryFilterKeys: ['searchText', 'cellValue', 'rowIds'],

  filterSchema: {
    tableId: {
      type: 'select',
      label: 'Table',
      // Options are populated dynamically by the Properties Panel from the
      // available data tables — passing an empty list here keeps the schema
      // valid when the source is registered before the table list is loaded.
      options: [],
    },
    // Optional condition on one of the row's own cells: the difference
    // between "the newest three" and "the three marked featured". Field
    // options are populated per selected table by the Properties Panel.
    cellField: {
      type: 'select',
      label: 'Filter by',
      options: [],
    },
    cellOperator: {
      type: 'select',
      label: 'Condition',
      options: [
        { label: 'is', value: 'is' },
        { label: 'is not', value: 'isNot' },
        { label: 'is checked', value: 'isTrue' },
        { label: 'is unchecked', value: 'isFalse' },
        { label: 'has any value', value: 'isSet' },
        { label: 'has no value', value: 'isEmpty' },
      ],
    },
    cellValue: {
      type: 'text',
      label: 'Value',
    },
    searchText: { type: 'text', label: 'Search text' },
  },

  orderByOptions: [
    { id: 'publishedAt', label: 'Published date' },
    { id: 'createdAt', label: 'Created date' },
    { id: 'updatedAt', label: 'Last updated' },
    { id: 'slug', label: 'Slug (A–Z)' },
  ],

  fields: [
    { id: 'slug', label: 'Slug' },
    { id: 'title', label: 'Title (post-type)' },
    { id: 'author', label: 'Author name' },
    { id: 'authorName', label: 'Author name (alias)' },
    { id: 'authorRoleName', label: 'Author role' },
    { id: 'body', label: 'Body (post-type, markdown)', format: 'html' },
    { id: 'featuredMedia', label: 'Featured media (post-type)', format: 'media' },
    { id: 'firstImage', label: 'First inline image', format: 'media' },
    { id: 'seoTitle', label: 'SEO title (post-type)' },
    { id: 'seoDescription', label: 'SEO description (post-type)' },
    { id: 'permalink', label: 'Permalink', format: 'url' },
    { id: 'publishedAt', label: 'Published date' },
    { id: 'publishedByName', label: 'Published by' },
    { id: 'publishedByRoleName', label: 'Publisher role' },
    { id: 'createdAt', label: 'Created date' },
    { id: 'updatedAt', label: 'Updated date' },
  ],

  async fetch(ctx): Promise<LoopFetchResult> {
    // The loop stores the table's logical id; the SQL below addresses the
    // physical table row of the branch being rendered.
    const logicalTableId = typeof ctx.filters.tableId === 'string' ? ctx.filters.tableId : ''
    return fetchPublishedDataRowItems(ctx.db, {
      tableId: logicalTableId ? physicalId(ctx.branchId ?? MAIN_BRANCH_ID, logicalTableId) : '',
      drafts: ctx.drafts ?? (ctx.branchId ?? MAIN_BRANCH_ID) !== MAIN_BRANCH_ID,
      orderBy: ctx.orderBy,
      direction: ctx.direction,
      limit: ctx.limit,
      offset: ctx.offset,
      cellFilter: parseCellFilter(ctx.filters),
      cellSearch: parseCellSearch(ctx.filters, ctx.localization?.language),
      selectedRowIds: ctx.filters.rowIds === undefined ? undefined : new Set(parseValue(Type.Array(Type.String({ maxLength: 256 }), { maxItems: 1000 }), ctx.filters.rowIds)),
      localization: ctx.localization,
    })
  },

  preview() {
    // Editor-side preview is handled by the canvas via `useLoopPreviewItems`:
    // it first calls the admin endpoint `/data/tables/:id/loop-preview` to
    // fetch real published rows via `fetchPublishedDataRowItems` (this file),
    // using the canonical page language. Empty sources have no real entries;
    // this synchronous contract never manufactures representative row values.
    return []
  },
}
