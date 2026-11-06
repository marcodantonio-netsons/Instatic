import {
  DataCollectionReadRequestSchema, DataRelationsReadRequestSchema,
  type RelationMaterializationRequest,
} from '@core/data-read'
import type { DbClient } from '../../../db/client'
import type { BranchScope } from '../../../branches/scope'
import { requireDataAccess } from '../../../auth/dataAccess'
import { DataReadSnapshot, materializeDataRelations, readDataCollection } from '../../../repositories/data'
import { badRequest, jsonResponse, methodNotAllowed, readValidatedBody } from '../../../http'
import { CMS_API_PREFIX } from '../shared'

/** Authenticated authoring/preview only. Anonymous reads are constructed from a published plan. */
export async function handleDataReadRoutes(req: Request, db: DbClient, scope: BranchScope): Promise<Response | null> {
  const path = new URL(req.url).pathname
  if (path !== `${CMS_API_PREFIX}/data/read/query` && path !== `${CMS_API_PREFIX}/data/read/relations`) return null
  if (req.method !== 'POST') return methodNotAllowed()
  const user = await requireDataAccess(req, db)
  if (user instanceof Response) return user
  if (path.endsWith('/query')) {
    const body = await readValidatedBody(req, DataCollectionReadRequestSchema, { maxBytes: 2 * 1024 * 1024 })
    if (!body) return badRequest('Invalid native collection read')
    const snapshot = await DataReadSnapshot.create(db, scope, body.view ?? 'draft', { kind: 'user', principal: user }, {
      language: body.language, generation: body.generation,
    })
    return jsonResponse(await readDataCollection(snapshot, body.query))
  }
  const body = await readValidatedBody(req, DataRelationsReadRequestSchema, { maxBytes: 2 * 1024 * 1024 })
  if (!body) return badRequest('Invalid native relation read')
  const snapshot = await DataReadSnapshot.create(db, scope, body.view ?? 'draft', { kind: 'user', principal: user }, {
    language: body.language, generation: body.generation,
  })
  const requests: RelationMaterializationRequest[] = body.requests.map(request => ({
    owner: { ...snapshot.reference(request.owner.tableId, request.owner.rowId), ...(request.owner.repeater ? { repeater: request.owner.repeater } : {}) },
    field: request.field,
    ...(Object.hasOwn(request, 'draftValue') ? { draftValue: request.draftValue } : {}),
  }))
  const relations = await materializeDataRelations(snapshot, requests)
  await snapshot.assertFresh()
  return jsonResponse({ relations: [...relations.values()], generation: snapshot.generation })
}
