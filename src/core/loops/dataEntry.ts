import type { MaterializedDataEntry } from '@core/data-read'
import type { LoopItem } from '@core/loops-schema'
import { projectDataMediaCells } from '@core/data/mediaCells'
import { firstImagePathFromMarkdown } from '@core/markdown/renderMarkdown'

/** The publisher and canvas share this projection of an admitted native entry. */
export function dataEntryToLoopItem(entry: MaterializedDataEntry): LoopItem {
  const featuredMediaId = typeof entry.cells.featuredMedia === 'string' ? entry.cells.featuredMedia : null
  const featuredMediaPath = featuredMediaId ? entry.media[featuredMediaId]?.publicPath ?? null : null
  const firstImage = typeof entry.cells.body === 'string' ? firstImagePathFromMarkdown(entry.cells.body) : null
  return {
    id: entry.id,
    dataEntry: { reference: structuredClone(entry.reference), fields: structuredClone(entry.fields), cells: structuredClone(entry.cells), media: structuredClone(entry.media) },
    fields: {
      ...projectDataMediaCells(entry.cells, entry.fields, entry.media),
      id: entry.id, rowId: entry.reference.rowId, tableId: entry.reference.tableId, tableSlug: entry.tableSlug,
      versionId: entry.version?.id ?? null, versionNumber: entry.version?.number ?? null,
      title: entry.title, slug: entry.slug, permalink: entry.url,
      featuredMediaId, featuredMedia: featuredMediaPath, featuredMediaPath, featuredMediaUrl: featuredMediaPath,
      firstImage, firstImagePath: firstImage, firstImageUrl: firstImage,
      createdAt: entry.createdAt, updatedAt: entry.updatedAt, publishedAt: entry.publishedAt,
      author: entry.author?.displayName ?? null, authorName: entry.author?.displayName ?? null,
      authorRoleSlug: entry.author?.roleSlug ?? null, authorRoleName: entry.author?.roleName ?? null,
      publishedBy: entry.publishedBy?.displayName ?? null, publishedByName: entry.publishedBy?.displayName ?? null,
      publishedByRoleSlug: entry.publishedBy?.roleSlug ?? null, publishedByRoleName: entry.publishedBy?.roleName ?? null,
    },
  }
}

/** Materialized tree identity plus real entry stack prevents cross-instance reuse. */
export function loopReadKey(frameId: string, entryStack: readonly LoopItem[]): string {
  return JSON.stringify([frameId, entryStack.map(item => {
    const reference = item.dataEntry?.reference
    return reference
      ? ['data', item.id, reference.branchId, reference.view, reference.generation, reference.tableId, reference.rowId,
        reference.repeater?.fieldId ?? null, reference.repeater?.itemId ?? null]
      : ['source', item.id]
  })])
}
