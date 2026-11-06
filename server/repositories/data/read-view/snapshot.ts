import { DATA_QUERY_LIMITS, DataReadGenerationError, RelationResolutionError, parsePublishedDataReadPlan, type DataEntryReference, type DataReadView, type DataRowReadRecord, type MaterializedDataEntry } from '@core/data-read'
import type { DataRowCells, DataTable } from '@core/data/schemas'
import type { SiteDocument } from '@core/page-tree'
import { LocalizationError, resolveSiteLanguage } from '@core/localization'
import { hasLocalizedDataFields, type DataLocalizationContext } from '@core/data/localizedCells'
import type { DbClient } from '../../../db/client'
import type { BranchScope } from '../../../branches/scope'
import { getDraftSite } from '../../site'
import { getDataTable } from '../tables'
import { readDataRowRecords, readDataRowIdBySlug } from '../rows'
import { captureDataReadGeneration, assertDataReadGeneration } from '../generation'
import { canReadDataTable, canReadDataEntry, dataReadOwnerUserId, type DataReadAuthority } from './authority'
import { projectDataReadEntry } from './projection'
import { readDataTableIdentities, readDataTableIdentityBySlug } from './tableIdentity'
import { collectDataMediaIds, type DataReadMediaMap } from '@core/data/mediaCells'
import { readDataMedia } from './media'
import { assertLocalizedDataPrincipalWrite } from '../localization'

export interface DataReadSnapshotOptions {
  language?: string
  /** Server-owned catalogue from the exact site being rendered or admitted. */
  localizationSite?: Pick<SiteDocument, 'settings' | 'files'>
  /** Captured before route resolution when the snapshot belongs to a public response. */
  generation?: string
}

/** A request owns one immutable authority/view/generation and one batched row cache. */
export class DataReadSnapshot {
  private readonly tables = new Map<string, Promise<DataTable>>()
  private readonly recordCache = new Map<string, Map<string, DataRowReadRecord | null>>()
  private readonly completeTables = new Set<string>()
  private localizationPromise?: Promise<DataLocalizationContext>
  private readonly media: DataReadMediaMap = {}

  private constructor(
    readonly db: DbClient, readonly scope: BranchScope, readonly view: DataReadView,
    readonly authority: DataReadAuthority, readonly generation: string,
    private readonly options: DataReadSnapshotOptions,
  ) {}

  static async create(
    db: DbClient, scope: BranchScope, view: DataReadView,
    authority: DataReadAuthority, options: DataReadSnapshotOptions = {},
  ): Promise<DataReadSnapshot> {
    const generationView = authority.kind === 'public' ? 'public' : 'draft'
    if (authority.kind === 'public' && (!options.localizationSite || view !== 'public')) {
      throw new RelationResolutionError('view', 'relation_unavailable', 'The certified published content view is unavailable')
    }
    if (authority.kind === 'public') {
      const plan = parsePublishedDataReadPlan(authority.plan)
      if (!plan.scopes.some(scope => scope.id === authority.scopeId)) throw new RelationResolutionError('dataReadPlan', 'uncertified_read_plan', 'The public render scope has no certified data read plan')
      authority = { ...authority, plan }
    }
    const generation = options.generation ?? await captureDataReadGeneration(db, scope, generationView)
    await assertDataReadGeneration(db, scope, generationView, generation)
    return new DataReadSnapshot(db, { ...scope }, view, structuredClone(authority), generation, structuredClone(options))
  }

  async assertFresh(): Promise<void> {
    await assertDataReadGeneration(this.db, this.scope, this.authority.kind === 'public' ? 'public' : 'draft', this.generation)
  }

  assertReference(reference: DataEntryReference): void {
    if (reference.generation !== this.generation) throw new DataReadGenerationError('owner.generation')
    if (reference.branchId !== this.scope.branchId || reference.view !== this.view) {
      throw new RelationResolutionError('owner', 'relation_unavailable', 'The requested entry view is unavailable')
    }
  }

  reference(tableId: string, rowId: string): DataEntryReference {
    return { branchId: this.scope.branchId, view: this.view, generation: this.generation, tableId, rowId }
  }

  async recordBySlug(table: DataTable, slug: string): Promise<DataRowReadRecord | null> {
    const admitted = await this.table(table.id)
    const rowId = await readDataRowIdBySlug(this.db, this.scope, admitted, this.view, slug)
    return rowId ? (await this.records(admitted.id, [rowId]))[0] ?? null : null
  }

  get language(): string | undefined { return this.options.language }

  async table(tableId: string): Promise<DataTable> {
    let pending = this.tables.get(tableId)
    if (!pending) {
      pending = this.admitTable(tableId)
      this.tables.set(tableId, pending)
    }
    return pending
  }

  async tableBySlug(slug: string): Promise<DataTable> {
    const identity = await readDataTableIdentityBySlug(this.db, this.scope, slug)
    if (!identity || !canReadDataTable(this.authority, identity)) {
      throw new RelationResolutionError('table', 'relation_unavailable', 'The requested collection is unavailable')
    }
    return this.table(identity.id)
  }

  private async admitTable(tableId: string): Promise<DataTable> {
    const identity = (await readDataTableIdentities(this.db, this.scope, [tableId]))[0]
    if (!identity || !canReadDataTable(this.authority, identity)) {
      throw new RelationResolutionError('table', 'relation_unavailable', 'The requested collection is unavailable')
    }
    const table = await getDataTable(this.db, this.scope, tableId)
    if (!table) throw new RelationResolutionError('table', 'relation_unavailable', 'The requested collection is unavailable')
    return table
  }

  async records(tableId: string, requestedIds?: readonly string[]): Promise<DataRowReadRecord[]> {
    const table = await this.table(tableId)
    let cache = this.recordCache.get(tableId)
    if (!cache) { cache = new Map(); this.recordCache.set(tableId, cache) }
    const ids = requestedIds ? [...new Set(requestedIds)] : undefined
    if (ids && ids.length > DATA_QUERY_LIMITS.candidates) {
      throw new RelationResolutionError('rows', 'query_limit', 'The requested membership exceeds the native read limit')
    }
    if (!ids && !this.completeTables.has(tableId)) {
      const records = await this.fetchRecords(table)
      if (records.length > DATA_QUERY_LIMITS.candidates) throw new RelationResolutionError('rows', 'query_limit', 'The collection exceeds the native candidate limit')
      // Replace partial lookups: their insertion order is not collection order,
      // and cached misses must not survive a complete authoritative read.
      cache = new Map(records.map(record => [record.row.id, record]))
      this.recordCache.set(tableId, cache)
      this.completeTables.add(tableId)
    } else if (ids && !this.completeTables.has(tableId)) {
      const missing = ids.filter(id => !cache.has(id))
      const batches: string[][] = []
      for (let index = 0; index < missing.length; index += DATA_QUERY_LIMITS.batchSize) batches.push(missing.slice(index, index + DATA_QUERY_LIMITS.batchSize))
      const fetched = await Promise.all(batches.map(batch => this.fetchRecords(table, batch)))
      for (const id of missing) cache.set(id, null)
      for (const record of fetched.flat()) cache.set(record.row.id, record)
    }
    const records = ids ? ids.flatMap(id => { const record = cache.get(id); return record ? [record] : [] }) : [...cache.values()].filter(record => record !== null)
    return structuredClone(records)
  }

  private async fetchRecords(table: DataTable, rowIds?: readonly string[]): Promise<DataRowReadRecord[]> {
    const records = await readDataRowRecords(this.db, this.scope, table, this.view, { rowIds, ownerUserId: dataReadOwnerUserId(this.authority) })
    return records.filter(record => canReadDataEntry(this.authority, record.row))
  }

  /** An explicit in-memory authoring overlay keeps the real row identity/view. */
  async previewDraftCells(tableId: string, rowId: string, proposed: DataRowCells): Promise<MaterializedDataEntry> {
    if (this.view !== 'draft' || this.authority.kind !== 'user') throw new RelationResolutionError('preview', 'relation_unavailable', 'Draft cell overrides require an authorized authoring view')
    const table = await this.table(tableId)
    const record = (await this.records(table.id, [rowId]))[0]
    if (!record) throw new RelationResolutionError('preview', 'relation_unavailable', 'The requested entry is unavailable')
    await assertLocalizedDataPrincipalWrite(this.db, this.scope, table.fields, proposed, this.authority.principal, 'preview.cells', this.options.localizationSite)
    const overlay = { ...record, row: { ...record.row, cells: { ...record.row.cells, ...structuredClone(proposed) } } }
    // The same request's relation reads must see these proposed memberships;
    // editable slug/id fields do not replace native record identity.
    this.recordCache.get(table.id)!.set(rowId, overlay)
    const entry = (await this.project(table, [overlay]))[0]
    await this.assertFresh()
    return entry
  }

  async project(table: DataTable, records: readonly DataRowReadRecord[]): Promise<MaterializedDataEntry[]> {
    const localization = hasLocalizedDataFields(table.fields) ? await this.localization() : undefined
    const ids = [...new Set(records.flatMap(record => collectDataMediaIds(record.row.cells, table.fields, `rows.${record.row.id}.cells`)))]
    Object.assign(this.media, await readDataMedia(this.db, ids.filter(id => !this.media[id])))
    return records.map(record => {
      const demanded = collectDataMediaIds(record.row.cells, table.fields, `rows.${record.row.id}.cells`)
      const media = Object.fromEntries(demanded.map(id => [id, this.media[id]]))
      return projectDataReadEntry(record, table, this.reference(table.id, record.row.id), localization, media)
    })
  }

  /** A localized empty collection still needs an explicitly configured locale. */
  async assertTableLanguage(table: DataTable): Promise<void> {
    if (hasLocalizedDataFields(table.fields)) await this.localization()
  }

  private localization(): Promise<DataLocalizationContext> {
    this.localizationPromise ??= this.readLocalization()
    return this.localizationPromise
  }

  private async readLocalization(): Promise<DataLocalizationContext> {
    if (this.options.language === undefined) throw new LocalizationError('language', 'Choose an explicit configured content language')
    const site = this.options.localizationSite ?? await getDraftSite(this.db, this.scope)
    if (!site) throw new LocalizationError('settings.localization', 'The language catalogue is unavailable')
    return resolveSiteLanguage(site, this.options.language)
  }
}
