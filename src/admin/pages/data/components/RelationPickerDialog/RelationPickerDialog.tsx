import { useEffect, useState } from 'react'
import { useAsyncResource } from '@admin/lib/useAsyncResource'
import { useCurrentAdminUser } from '@admin/sessionContext'
import { useBranchStore } from '@admin/state/branchStore'
import { Button } from '@ui/components/Button'
import { Dialog } from '@ui/components/Dialog'
import { EmptyState } from '@ui/components/EmptyState'
import { SearchBar } from '@ui/components/SearchBar'
import { SkeletonBlock } from '@ui/components/Skeleton'
import { pushToast } from '@ui/components/Toast'
import { readCmsDataCollection } from '@core/persistence'
import { DATA_QUERY_LIMITS, DataReadGenerationError, RelationResolutionError, relationCellValue, type DataCollectionResult, type MaterializedDataEntry } from '@core/data-read'
import { useLocalizedData } from '@admin/pages/data/localizedData'
import { hasLocalizedDataFields } from '@core/data/localizedCells'
import { getErrorMessage } from '@core/utils/errorMessage'
import {
  movePickerRow, presentPickerRows, readPickerSelection, selectedPickerRows, togglePickerRow,
} from './relationPickerModel'
import type { DataTable } from '@core/data/schemas'
import styles from './RelationPickerDialog.module.css'

interface RelationPickerDialogProps {
  open: boolean
  onClose: () => void
  targetTable: DataTable | null
  currentValue: unknown
  allowMultiple: boolean
  onPick: (next: string | string[] | null) => void
}

const CANDIDATE_PAGE_SIZE = 100

function nextPageOffset(page: DataCollectionResult, offset: number): number | null {
  if (!page.hasMore) return null
  if (page.nextOffset === null || page.nextOffset <= offset) {
    throw new RelationResolutionError('relation.query', 'invalid_collection_query', 'The related row page could not be continued. Reload and retry.')
  }
  return page.nextOffset
}

function pageGeneration(page: DataCollectionResult, expected?: string): string {
  if ((expected && page.generation !== expected) || page.items.some(item => item.reference.generation !== page.generation)) {
    throw new DataReadGenerationError('relation.generation')
  }
  return page.generation
}

export function RelationPickerDialog({
  open, onClose, targetTable, currentValue, allowMultiple, onPick,
}: RelationPickerDialogProps) {
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState(() => readPickerSelection(currentValue, allowMultiple))
  const [candidatePages, setCandidatePages] = useState(1)
  const user = useCurrentAdminUser()
  const branchId = useBranchStore(state => state.activeBranchId)
  const branchEpoch = useBranchStore(state => state.epoch)
  const authorityKey = JSON.stringify([user?.id, user?.capabilities, branchId, branchEpoch])
  const tableKey = targetTable ? JSON.stringify([targetTable.id, targetTable.fields]) : null
  const localization = useLocalizedData()
  const language = localization?.context?.language
  const localizedTarget = Boolean(targetTable && hasLocalizedDataFields(targetTable.fields))
  const languageError = localizedTarget ? localization?.error : null
  const languageLoading = localizedTarget && Boolean(localization?.loading)
  const needsLanguage = localizedTarget && !localization?.context

  const [seed, setSeed] = useState({ open, currentValue, allowMultiple, tableKey })
  if (open !== seed.open || currentValue !== seed.currentValue || allowMultiple !== seed.allowMultiple || tableKey !== seed.tableKey) {
    setSeed({ open, currentValue, allowMultiple, tableKey })
    if (open) {
      setSelection(readPickerSelection(currentValue, allowMultiple))
      setSearch('')
    }
  }

  const searchText = search.trim()
  const [pageSeed, setPageSeed] = useState({ tableKey, language, searchText, authorityKey })
  if (tableKey !== pageSeed.tableKey || language !== pageSeed.language || searchText !== pageSeed.searchText || authorityKey !== pageSeed.authorityKey) {
    setPageSeed({ tableKey, language, searchText, authorityKey })
    setCandidatePages(1)
  }
  const selectionKey = JSON.stringify(selection.kind === 'valid' ? selection.ids : null)
  const canReadTarget = open && targetTable != null && !needsLanguage && !languageLoading && !languageError
  const scopeKey = JSON.stringify([open, tableKey, language, searchText, selectionKey, candidatePages, canReadTarget, authorityKey])
  // One resource result is one native generation. Search only limits the
  // candidates; the complete authored selection is resolved separately.
  const { data, loading, error: loadError, refresh } = useAsyncResource(
    async () => {
      const selectedEntries: MaterializedDataEntry[] = []
      const candidates: MaterializedDataEntry[] = []
      if (!canReadTarget || !targetTable) return { scopeKey, generation: null, readKey: null, selectedEntries, candidates, hasMore: false }
      let generation: string | undefined
      const context = { view: 'draft' as const, ...(language ? { language } : {}) }
      const ids = selection.kind === 'valid' ? selection.ids : []
      if (ids.length > 0) {
        let offset: number | null = 0
        const pageCount = Math.ceil(ids.length / DATA_QUERY_LIMITS.pageSize)
        for (let index = 0; index < pageCount && offset !== null; index += 1) {
          const page = await readCmsDataCollection({ ...context, ...(generation ? { generation } : {}),
            query: { source: { kind: 'entries', tableId: targetTable.id, rowIds: ids }, offset, limit: DATA_QUERY_LIMITS.pageSize } })
          generation = pageGeneration(page, generation)
          selectedEntries.push(...page.items)
          offset = nextPageOffset(page, offset)
        }
        if (offset !== null) throw new RelationResolutionError('relation.query', 'query_limit', 'The selected rows exceed the native page limit. Reload and retry.')
      }
      let offset: number | null = 0
      let hasMore = false
      for (let index = 0; index < candidatePages && offset !== null; index += 1) {
        const page = await readCmsDataCollection({ ...context, ...(generation ? { generation } : {}),
          query: { source: { kind: 'table', tableId: targetTable.id },
            ...(searchText ? { search: { fieldIds: [], title: true, text: searchText } } : {}),
            offset, limit: CANDIDATE_PAGE_SIZE } })
        generation = pageGeneration(page, generation)
        candidates.push(...page.items)
        hasMore = page.hasMore
        offset = nextPageOffset(page, offset)
      }
      return { scopeKey, generation: generation ?? null, readKey: JSON.stringify([scopeKey, generation]), selectedEntries, candidates, hasMore }
    },
    [scopeKey, canReadTarget, targetTable, language, selection, searchText, candidatePages],
    { fallbackError: 'Failed to load rows' },
  )
  // Retained success from a superseded scope/generation cannot enable actions.
  const currentRead = data && data.scopeKey === scopeKey && data.generation != null && data.readKey === JSON.stringify([scopeKey, data.generation])
    ? { ...data, generation: data.generation } : null
  const rowsPending = canReadTarget && (loading || currentRead == null)
  const rows = targetTable && currentRead && !loading
    ? presentPickerRows(currentRead.candidates, targetTable.id, currentRead.generation) : []
  const selectedRows = targetTable && currentRead && !loading
    ? presentPickerRows(currentRead.selectedEntries, targetTable.id, currentRead.generation) : []
  const selected = selection.kind === 'valid' ? selectedPickerRows(selection.ids, selectedRows) : []
  const selectionError = selection.kind === 'invalid' ? getErrorMessage(selection.error, 'The relation value is invalid') : null
  const targetError = !rowsPending && !loadError && !needsLanguage && !languageLoading && !languageError
    ? selected.find(row => row.kind === 'unavailable') : undefined
  const targetErrorMessage = targetError?.kind === 'unavailable' ? getErrorMessage(targetError.error, 'A selected row is unavailable') : null
  const projectionError = rows.find(row => row.kind === 'unavailable')
  const projectionErrorMessage = projectionError?.kind === 'unavailable' ? getErrorMessage(projectionError.error, 'Could not read a related row title') : null
  const blockingError = selectionError ?? loadError ?? targetErrorMessage
  const readError = blockingError ?? projectionErrorMessage

  useEffect(() => {
    if (open && readError) pushToast({ kind: 'error', title: 'Could not read related rows', body: readError,
      ...(selectionError ? {} : { action: { label: 'Retry', onSelect: refresh } }) })
  }, [open, readError, selectionError, refresh])

  const canConfirm = targetTable != null && !rowsPending && !languageLoading && !needsLanguage && !languageError && !blockingError
  const hasMore = Boolean(currentRead?.hasMore && !loading)

  function toggleRow(id: string) {
    setSelection(previous => previous.kind === 'valid'
      ? { kind: 'valid', ids: togglePickerRow(previous.ids, id, allowMultiple) } : previous)
  }

  function moveRow(index: number, direction: -1 | 1) {
    setSelection(previous => previous.kind === 'valid'
      ? { kind: 'valid', ids: movePickerRow(previous.ids, index, direction) } : previous)
  }

  function handleConfirm() {
    if (!canConfirm || selection.kind !== 'valid') return
    try {
      onPick(relationCellValue(selection.ids, { allowMultiple }))
      onClose()
    } catch (error) {
      pushToast({ kind: 'error', title: 'Could not update relation', body: getErrorMessage(error, 'The relation could not be updated') })
    }
  }

  function handleClose() {
    setSearch('')
    onClose()
  }

  const title = targetTable == null ? 'Pick relation'
    : `Pick ${allowMultiple ? targetTable.pluralLabel : targetTable.singularLabel}`

  return (
    <Dialog open={open} onClose={handleClose} title={title} size="lg" footer={<>
      <Button variant="ghost" size="sm" type="button" onClick={handleClose}>Cancel</Button>
      <Button variant="primary" size="sm" type="button" onClick={handleConfirm} disabled={!canConfirm}>Confirm</Button>
    </>}>
      {targetTable == null ? (
        <EmptyState title="No target table configured" description="Set a target table on the relation field to pick rows." variant="centered" />
      ) : (
        <div className={styles.body}>
          <section className={styles.selection} aria-label="Selection">
            {selection.kind === 'invalid' ? (
              <EmptyState title="The saved selection is invalid" description={selectionError}
                role="alert" variant="card" />
            ) : <>
              <p className={styles.count} role="status" aria-live="polite">
                {selection.ids.length} {selection.ids.length === 1 ? 'related row' : 'related rows'} selected
              </p>
              {selected.length > 0 && <ol className={styles.selectedList} aria-label="Selected rows">
                {selected.map((row, index) => {
                  const pending = (rowsPending && !loadError) || (languageLoading && !languageError)
                  const displayTitle = pending ? 'Loading related row' : languageError ? 'Could not load content language'
                    : needsLanguage ? 'Choose a content language' : loadError ? 'Could not load related row'
                      : row.kind === 'ready' ? row.title : 'Unavailable related row'
                  const actionLabel = row.kind === 'ready' && !pending && !needsLanguage && !loadError && !languageError
                    ? row.title : `selection ${index + 1}`
                  return <li key={row.id} className={styles.selectedRow}>
                    <div className={styles.selectedTitle}>
                      <span className={styles.position}>{index + 1}.</span>
                      <span className={styles.rowLabel}>{displayTitle}</span>
                    </div>
                    {!pending && !needsLanguage && !languageError && !loadError && row.kind === 'unavailable' &&
                      <p className={styles.rowError}>{getErrorMessage(row.error, 'The selected row is unavailable')}</p>}
                    <div className={styles.actions}>
                      {allowMultiple && <>
                        <Button variant="ghost" size="xs" type="button" disabled={index === 0}
                          aria-label={`Move ${actionLabel} up`} onClick={() => moveRow(index, -1)}>Up</Button>
                        <Button variant="ghost" size="xs" type="button" disabled={index === selected.length - 1}
                          aria-label={`Move ${actionLabel} down`} onClick={() => moveRow(index, 1)}>Down</Button>
                      </>}
                      <Button variant="ghost" size="xs" type="button" aria-label={`Remove ${actionLabel}`}
                        onClick={() => toggleRow(row.id)}>Remove</Button>
                    </div>
                  </li>
                })}
              </ol>}
            </>}
          </section>

          <SearchBar value={search} onValueChange={setSearch}
            placeholder={`Search ${targetTable.pluralLabel.toLowerCase()}…`} className={styles.search} />
          {rowsPending && !loadError && <SkeletonBlock minHeight={140} ariaLabel="Loading rows" />}
          {loadError && <EmptyState title="Could not load rows" description={loadError} variant="card"
            action={<Button variant="secondary" size="sm" onClick={refresh}>Retry</Button>} />}
          {languageError && <EmptyState title="Could not load content language" description={languageError} variant="card"
            action={<Button variant="secondary" size="sm" onClick={localization?.refresh}>Retry language</Button>} />}
          {!languageError && needsLanguage && <EmptyState title="Choose a content language"
            description="Select a language before choosing related localized rows." variant="card" />}
          {targetErrorMessage && <EmptyState title="A selected row is unavailable" description="Reload related rows or remove the unavailable selection before confirming."
            variant="card" action={<Button variant="secondary" size="sm" onClick={refresh}>Reload related rows</Button>} />}
          {!rowsPending && !loadError && !languageLoading && !needsLanguage && !languageError && rows.length === 0 &&
            <EmptyState title={search ? 'No matches' : `No ${targetTable.pluralLabel.toLowerCase()} yet`}
              description={search ? 'Try a different search term.' : undefined} variant="card" />}
          {!rowsPending && !loadError && !languageLoading && !needsLanguage && !languageError && rows.length > 0 &&
            <div className={styles.list} role="group" aria-label="Available rows">
              {rows.map(row => row.kind === 'unavailable' ? (
                <EmptyState key={row.id} title="Could not read row title" description={getErrorMessage(row.error, 'The row title is unavailable')}
                  compact variant="card" action={<Button variant="secondary" size="sm" onClick={refresh}>Retry</Button>} />
              ) : <Button key={row.id} variant="ghost" size="sm" type="button" fullWidth align="start"
                pressed={selection.kind === 'valid' && selection.ids.includes(row.id)} disabled={selection.kind === 'invalid'}
                onClick={() => toggleRow(row.id)}><span className={styles.rowLabel}>{row.title}</span></Button>)}
            </div>}
          {hasMore && !loadError && <Button variant="secondary" size="sm" type="button" className={styles.loadMore}
            onClick={() => setCandidatePages(pages => pages + 1)}>Load more</Button>}
        </div>
      )}
    </Dialog>
  )
}
