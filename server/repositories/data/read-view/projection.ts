import type { DataEntryReference, DataRowReadRecord, MaterializedDataEntry } from '@core/data-read'
import type { DataTable } from '@core/data/schemas'
import { readProjectedDisplayTitle } from '@core/data/cells'
import { hasLocalizedDataFields, projectLocalizedDataCells, type DataLocalizationContext } from '@core/data/localizedCells'
import { LocalizationError } from '@core/localization'
import { normalizeRouteBase } from '@core/templates'
import { publicDataUserFromParts } from '@core/data/publicDataUser'
import type { DataReadMediaMap } from '@core/data/mediaCells'

/** Projection is derived only after admission; the stored payload is never rewritten. */
export function projectDataReadEntry(
  record: DataRowReadRecord, table: DataTable, reference: DataEntryReference,
  localization?: DataLocalizationContext, media: DataReadMediaMap = {},
): MaterializedDataEntry {
  const path = `tables.${table.id}.rows.${record.row.id}.cells`
  if (hasLocalizedDataFields(table.fields) && !localization?.translations) {
    throw new LocalizationError(path, 'Choose a configured content language to resolve localized data')
  }
  const cells = localization ? projectLocalizedDataCells(record.row.cells, table.fields, localization, path) : record.row.cells
  // An explicitly non-routable table stays non-routable. External destinations
  // are ordinary authored cells and require their own explicit binding.
  const base = table.routeBase.trim() ? normalizeRouteBase(table.routeBase) : null
  const url = base !== null && record.row.slug ? `${base === '/' ? '' : base}/${record.row.slug}` : null
  return {
    id: record.row.id, reference, tableSlug: table.slug, title: readProjectedDisplayTitle(cells, table),
    slug: record.row.slug, status: record.row.status, url, createdAt: record.row.createdAt,
    author: publicDataUserFromParts(record.row.author?.displayName, record.row.author?.roleSlug, record.row.author?.roleName),
    publishedBy: publicDataUserFromParts(record.row.publishedBy?.displayName, record.row.publishedBy?.roleSlug, record.row.publishedBy?.roleName),
    updatedAt: record.row.updatedAt, publishedAt: record.row.publishedAt,
    version: record.version, cells: structuredClone(cells), fields: structuredClone(table.fields), media: structuredClone(media),
  }
}
