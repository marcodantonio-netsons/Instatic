import type { SiteDocument } from '@core/page-tree'
import {
  buildTemplateRenderContext, buildRouteFrame, publishedRenderScopes,
  type PublishedRenderScope, type TemplateRenderDataContext,
} from '@core/templates'
import { dataEntryToLoopItem } from '@core/loops'
import {
  readDataLoopQuery, RelationResolutionError,
  type PublishedDataReadPlan,
} from '@core/data-read'
import { canSeeAllDataRows, type DataAccessUser } from '../../../auth/dataAccess'
import type { DbClient } from '../../../db/client'
import { MAIN_SCOPE } from '../../../branches/scope'
import { getLatestPublishedSiteSnapshot, listActivePublishedSiteSnapshots } from '../../publishedSnapshot'
import { captureDataReadGeneration, assertDataReadGeneration } from '../generation'
import { DataReadSnapshot } from './snapshot'
import { readDataRenderTree, type DataRenderEntryShape } from './renderRead'
import { readRegisteredLoopSource } from './sourceRead'
import { collectDataRenderQueryInputs } from './renderQueryInputs'

export function publishedDataScopeId(scope: PublishedRenderScope): string {
  return scope.kind === 'entry' ? `entry:${scope.tableSlug}` : `${scope.kind}:${scope.sourcePage.id}`
}

async function scopeContexts(snapshot: DataReadSnapshot, scope: PublishedRenderScope, site: SiteDocument): Promise<{
  contexts: TemplateRenderDataContext[]
  schemaContexts?: Array<{ context: TemplateRenderDataContext; entryShape: DataRenderEntryShape }>
}> {
  if (scope.kind !== 'entry') return { contexts: [buildTemplateRenderContext(scope.sourcePage, site, { entryStack: [] })] }
  const table = await snapshot.tableBySlug(scope.tableSlug)
  await snapshot.assertTableLanguage(table)
  const entries = await snapshot.project(table, await snapshot.records(table.id))
  if (!entries.length) return { contexts: [], schemaContexts: [{
    context: buildTemplateRenderContext(scope.page, site, { entryStack: [] }),
    entryShape: { tableId: table.id, fields: table.fields },
  }] }
  return { contexts: entries.map(entry => buildTemplateRenderContext({ ...scope.page, title: entry.title }, site, {
    entryStack: [dataEntryToLoopItem(entry)], ...(entry.url ? { route: buildRouteFrame(entry.url) } : {}),
  })) }
}

async function readScope(snapshot: DataReadSnapshot, scope: PublishedRenderScope, site: SiteDocument, declaration?: PublishedDataReadPlan['scopes'][number]) {
  const contexts = await scopeContexts(snapshot, scope, site)
  if (scope.kind === 'entry') {
    const table = await snapshot.tableBySlug(scope.tableSlug)
    declaration?.tableIds.push(table.id)
  }
  const tables = new Set(declaration?.tableIds)
  const relations = new Map<string, PublishedDataReadPlan['scopes'][number]['relations'][number]>()
  await readDataRenderTree(snapshot, scope.page, site, {
    mode: 'integrity', ...contexts,
    queryForLoop: async node => readDataLoopQuery(node).query,
    readSource: (node, context) => readRegisteredLoopSource(snapshot, site, node, context),
    onTable: table => tables.add(table.id),
    onDeclarationNode: (node, frame) => {
      if (!declaration) return
      // A ref's token may already have selected its component; retain the
      // authored dependency as well as effective parameter/slot values.
      declaration.queryInputs = collectDataRenderQueryInputs(declaration.queryInputs, frame.nodes[node.id] ?? node)
      declaration.queryInputs = collectDataRenderQueryInputs(declaration.queryInputs, node)
    },
    onRelation: edge => relations.set(JSON.stringify(edge), edge),
  })
  if (declaration) {
    declaration.tableIds = [...tables].sort()
    declaration.relations = [...relations.values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  }
}

/** Admission uses the real actor and the same exact candidate view as rendering. */
export async function compilePublishedDataReadPlan(
  db: DbClient, site: SiteDocument, principal: DataAccessUser,
): Promise<PublishedDataReadPlan> {
  const plan: PublishedDataReadPlan = { scopes: [] }
  const generation = await captureDataReadGeneration(db, MAIN_SCOPE, 'draft')
  for (const scope of publishedRenderScopes(site)) {
    const framePage = scope.kind === 'entry' ? scope.page : scope.sourcePage
    const context = buildTemplateRenderContext(framePage, site, { entryStack: [] })
    const snapshot = await DataReadSnapshot.create(db, MAIN_SCOPE, 'public', { kind: 'user', principal }, {
      language: context.site?.language, localizationSite: site, generation,
    })
    const declaration: PublishedDataReadPlan['scopes'][number] = {
      id: publishedDataScopeId(scope), tableIds: [], relations: [], queryInputs: { kind: 'declared', names: [] },
      rowScope: canSeeAllDataRows(principal) ? { kind: 'all' } : { kind: 'owned', userId: principal.id },
    }
    await readScope(snapshot, scope, site, declaration)
    plan.scopes.push(declaration)
  }
  await assertDataReadGeneration(db, MAIN_SCOPE, 'draft', generation)
  return plan
}

async function assertScopePlans(
  db: DbClient, site: SiteDocument, plan: PublishedDataReadPlan | null,
  expected: string, include: (scope: PublishedRenderScope) => boolean,
): Promise<void> {
  if (!plan) throw new RelationResolutionError('dataReadPlan', 'uncertified_read_plan', 'This published content has no certified data read plan; publish it with an authorized actor')
  for (const scope of publishedRenderScopes(site)) {
    if (!include(scope)) continue
    const scopeId = publishedDataScopeId(scope)
    if (!plan.scopes.some(candidate => candidate.id === scopeId)) throw new RelationResolutionError('dataReadPlan', 'uncertified_read_plan', 'The active public render scope has no certified data read plan')
    const framePage = scope.kind === 'entry' ? scope.page : scope.sourcePage
    const context = buildTemplateRenderContext(framePage, site, { entryStack: [] })
    const snapshot = await DataReadSnapshot.create(db, MAIN_SCOPE, 'public', { kind: 'public', plan, scopeId }, {
      language: context.site?.language, localizationSite: site, generation: expected,
    })
    await readScope(snapshot, scope, site)
  }
}

/** Exercise every actual public demand, including later parent pages, before activation. */
export async function assertPublishedDataReadPlan(
  db: DbClient, site: SiteDocument, plan: PublishedDataReadPlan, expectedGeneration?: string,
): Promise<void> {
  const expected = expectedGeneration ?? await captureDataReadGeneration(db, MAIN_SCOPE, 'public')
  await assertScopePlans(db, site, plan, expected, () => true)
  await assertDataReadGeneration(db, MAIN_SCOPE, 'public', expected)
}

/** Old page snapshots retain only their active routes; entry/404 use the canonical carrier. */
export async function assertActivePublishedDataReadPlans(db: DbClient, expectedGeneration?: string): Promise<void> {
  const expected = expectedGeneration ?? await captureDataReadGeneration(db, MAIN_SCOPE, 'public')
  const [groups, latest] = await Promise.all([listActivePublishedSiteSnapshots(db), getLatestPublishedSiteSnapshot(db)])
  for (const { snapshot, activePageIds } of groups) {
    const active = new Set(activePageIds)
    await assertScopePlans(db, snapshot.site, snapshot.dataReadPlan, expected, scope => scope.kind === 'page' && active.has(scope.sourcePage.id))
  }
  if (latest) await assertScopePlans(db, latest.site, latest.dataReadPlan, expected, scope => scope.kind !== 'page')
  await assertDataReadGeneration(db, MAIN_SCOPE, 'public', expected)
}
