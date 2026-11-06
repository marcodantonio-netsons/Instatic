import { apiRequest } from '@core/http'
import {
  DataCollectionResultSchema, DataRelationsReadResponseSchema,
  type DataCollectionReadRequest, type DataCollectionResult,
  type DataRelationsReadRequest, type DataRelationsReadResponse,
} from '@core/data-read'

export function readCmsDataCollection(input: DataCollectionReadRequest): Promise<DataCollectionResult> {
  return apiRequest('/admin/api/cms/data/read/query', {
    method: 'POST', body: input, schema: DataCollectionResultSchema,
    fallbackMessage: 'Could not read the native collection',
  })
}

export function readCmsDataRelations(input: DataRelationsReadRequest): Promise<DataRelationsReadResponse> {
  return apiRequest('/admin/api/cms/data/read/relations', {
    method: 'POST', body: input, schema: DataRelationsReadResponseSchema,
    fallbackMessage: 'Could not read the native relations',
  })
}
