import { DATA_QUERY_LIMITS } from '@core/data-read'
import { DataMediaValidationError, type DataReadMediaMap } from '@core/data/mediaCells'
import type { DbClient } from '../../../db/client'
import { placeholder } from '../rows/mapper'
import { MEDIA_ASSET_COLUMNS, mapMediaAssetRow, type MediaAssetRow } from '../../mediaAssetMapping'

/** Batch the demanded identities through the canonical media mapper. */
export async function readDataMedia(db: DbClient, requestedIds: readonly string[]): Promise<DataReadMediaMap> {
  const ids = [...new Set(requestedIds)]
  if (ids.length > DATA_QUERY_LIMITS.candidates) throw new DataMediaValidationError('media', 'The media demand exceeds the native read limit')
  const media: DataReadMediaMap = {}
  for (let offset = 0; offset < ids.length; offset += DATA_QUERY_LIMITS.batchSize) {
    const batch = ids.slice(offset, offset + DATA_QUERY_LIMITS.batchSize)
    const placeholders = batch.map((_, index) => placeholder(db.dialect, index + 1)).join(', ')
    const { rows } = await db.unsafe<MediaAssetRow>(
      `select ${MEDIA_ASSET_COLUMNS} from media_assets where deleted_at is null and id in (${placeholders})`, batch,
    )
    for (const row of rows) {
      const asset = mapMediaAssetRow(row)
      media[asset.id] = { publicPath: asset.publicPath, mimeType: asset.mimeType, altText: asset.altText, width: asset.width, height: asset.height }
    }
  }
  if (ids.some(id => media[id] === undefined)) throw new DataMediaValidationError('media', 'A referenced media asset is unavailable')
  return media
}
