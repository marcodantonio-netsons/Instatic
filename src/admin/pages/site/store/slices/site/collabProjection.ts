import type { Page, SiteDocument, SiteShell } from '@core/page-tree'
import type { VisualComponent } from '@core/visualComponents'
import type { SavedLayout } from '@core/layouts'
import { encodeCollabDocId, parseCollabDocId, projectComponentDoc, projectLayoutDoc, projectPageDoc, projectSiteDoc, type CollabDocSet } from '@core/collab'
import { validateSite } from '@core/persistence/validate'

interface ProjectionContext {
  getDoc: CollabDocSet['get']
  branchId: string
  bindDoc: (docId: string) => void
}

function rowFromDoc(docId: string, context: ProjectionContext): Page | VisualComponent | SavedLayout | null {
  const parsed = parseCollabDocId(docId)
  if (!parsed || parsed.kind === 'site') return null
  const doc = context.getDoc(docId)
  if (!doc) return null
  if (parsed.kind === 'page') {
    const page = projectPageDoc(doc, parsed.rowId)
    return page.rootNodeId ? page : null
  }
  if (parsed.kind === 'component') {
    const vc = projectComponentDoc(doc, parsed.rowId)
    return vc.tree.rootNodeId ? vc : null
  }
  const layout = projectLayoutDoc(doc, parsed.rowId)
  return layout.rootNodeId ? layout : null
}

/** Seeders and persisted JSON omit undefined object fields. Their presence in
 * an HTTP parser's optional output does not represent a collaborative edit. */
function equalProjectedJson(previous: unknown, next: unknown): boolean {
  if (previous === next) return true
  if (previous === null || next === null || typeof previous !== 'object' || typeof next !== 'object') return false
  if (Array.isArray(previous) || Array.isArray(next)) {
    return Array.isArray(previous) && Array.isArray(next) && previous.length === next.length
      && previous.every((value, index) => equalProjectedJson(value, next[index]))
  }
  const left = previous as Record<string, unknown>, right = next as Record<string, unknown>
  const keys = Object.keys(left).filter((key) => left[key] !== undefined)
  return keys.length === Object.keys(right).filter((key) => right[key] !== undefined).length
    && keys.every((key) => Object.hasOwn(right, key) && equalProjectedJson(left[key], right[key]))
}

function reuseEqualFields<T extends object>(previous: T, next: T): { value: T; changed: boolean } {
  const value = { ...next }
  let changed = Object.keys(previous).some((key) => !Object.hasOwn(next, key) && previous[key as keyof T] !== undefined)
  for (const key of Object.keys(next) as Array<keyof T>) {
    if (equalProjectedJson(previous[key], next[key])) value[key] = previous[key]
    else changed = true
  }
  return { value, changed }
}

function sameRows<T>(previous: T[], next: T[]): T[] {
  return previous.length === next.length && previous.every((row, index) => row === next[index]) ? previous : next
}

function projectShell(site: SiteDocument, docId: string, context: ProjectionContext): SiteDocument {
  const parsed = parseCollabDocId(docId)
  if (parsed?.kind === 'site') {
    const doc = context.getDoc(docId)
    if (!doc) return site
    const projected = projectSiteDoc(doc)
    if (Object.keys(projected.shell).length === 0) return site
    // The projected shell is untyped wire data — validate it before it enters
    // the store, exactly like the HTTP load path (validateSite) and the relay's
    // persist path both do. `validateSite` is tolerant of individual malformed
    // entries (drops bad style rules / conditions / files rather than
    // rejecting the whole shell), so one corrupt rule from any source can't
    // crash a panel. `id`/`updatedAt` are non-collaborative — inject them like
    // the persist path. If the shell is not yet coherent (mid-sync), skip this
    // tick; the next projection re-runs once it is.
    let shell: SiteShell
    try {
      shell = validateSite({
        ...projected.shell,
        id: site.id,
        updatedAt: site.updatedAt,
      })
    } catch (err) {
      console.warn('[collabBinding] projected shell failed validation — projection skipped:', err)
      return site
    }
    const byId = {
      pages: new Map(site.pages.map((p) => [p.id, p])),
      components: new Map(site.visualComponents.map((vc) => [vc.id, vc])),
      layouts: new Map(site.layouts.map((l) => [l.id, l])),
    }
    const assemble = <T extends { id: string }>(
      ids: readonly string[],
      existing: Map<string, T>,
      kind: 'page' | 'component' | 'layout',
    ): T[] => {
      const rows: T[] = []
      for (const id of ids) {
        const known = existing.get(id)
        if (known) {
          rows.push(known)
          continue
        }
        const rowDocId = encodeCollabDocId({ kind, branchId: context.branchId, rowId: id })
        const fresh = rowFromDoc(rowDocId, context) as T | null
        if (fresh) {
          rows.push(fresh)
          continue
        }
        // A peer created this row — its doc isn't bound here yet. Bind it;
        // the whenSynced hook re-projects the site once content arrives.
        context.bindDoc(rowDocId)
      }
      return rows
    }
    if (projected.shell.conditions === undefined) delete shell.conditions
    const { pages: previousPages, visualComponents: previousComponents, layouts: previousLayouts, ...previousShell } = site
    const retained = reuseEqualFields(previousShell, shell)
    const pages = sameRows(previousPages, assemble(projected.rosters.pages, byId.pages, 'page'))
    const visualComponents = sameRows(previousComponents, assemble(projected.rosters.components, byId.components, 'component'))
    const layouts = sameRows(previousLayouts, assemble(projected.rosters.layouts, byId.layouts, 'layout'))
    if (!retained.changed && pages === previousPages && visualComponents === previousComponents && layouts === previousLayouts) return site
    return { ...retained.value, pages, visualComponents, layouts, updatedAt: Date.now() }
  }
  return site
}

/** Project each row once and rebuild each changed collection once per batch. */
export function projectCollabDocuments(site: SiteDocument, docIds: readonly string[], context: ProjectionContext): SiteDocument {
  type Row = Page | VisualComponent | SavedLayout
  const byId = {
    pages: new Map<string, Row>(site.pages.map((row) => [row.id, row])),
    visualComponents: new Map<string, Row>(site.visualComponents.map((row) => [row.id, row])),
    layouts: new Map<string, Row>(site.layouts.map((row) => [row.id, row])),
  }
  const changed = new Set<keyof typeof byId>()
  const shellDocs: string[] = []
  for (const docId of docIds) {
    const parsed = parseCollabDocId(docId)
    if (!parsed) continue
    if (parsed.kind === 'site') { shellDocs.push(docId); continue }
    const collection = parsed.kind === 'page' ? 'pages' : parsed.kind === 'component' ? 'visualComponents' : 'layouts'
    const rows = byId[collection], previous = rows.get(parsed.rowId)
    let row = rowFromDoc(docId, context)
    if (!row) {
      if (rows.delete(parsed.rowId)) changed.add(collection)
      continue
    }
    if (parsed.kind === 'page' && previous) {
      // These fields belong to the CMS row, never to the collaborative page
      // meta (see seed.populatePageDoc). Preserve the HTTP-owned values.
      const page = previous as Page
      row = { ...row,
        ...(Object.hasOwn(page, 'ownerUserId') ? { ownerUserId: page.ownerUserId } : {}),
        ...(Object.hasOwn(page, 'createdByUserId') ? { createdByUserId: page.createdByUserId } : {}),
        ...(Object.hasOwn(page, 'updatedByUserId') ? { updatedByUserId: page.updatedByUserId } : {}),
      }
    }
    if (previous && equalProjectedJson(previous, row)) continue
    rows.set(parsed.rowId, row)
    changed.add(collection)
  }
  let nextSite = changed.size === 0 ? site : {
    ...site,
    pages: changed.has('pages') ? [...byId.pages.values()] as Page[] : site.pages,
    visualComponents: changed.has('visualComponents') ? [...byId.visualComponents.values()] as VisualComponent[] : site.visualComponents,
    layouts: changed.has('layouts') ? [...byId.layouts.values()] as SavedLayout[] : site.layouts,
  }
  // Roster assembly must see all rows projected in this same batch.
  for (const docId of shellDocs) nextSite = projectShell(nextSite, docId, context)
  return nextSite
}
