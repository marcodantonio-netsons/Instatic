import { afterEach, describe, expect, it, spyOn } from 'bun:test'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LocalizedDataContext, type LocalizedDataState } from '@admin/pages/data/localizedData'
import { useBranchStore } from '@admin/state/branchStore'
import type { DataTable } from '@core/data/schemas'
import type { DataCollectionReadRequest, MaterializedDataEntry } from '@core/data-read'
import { ToastProvider } from '@ui/components/Toast'
import { RelationPickerDialog } from './RelationPickerDialog'

const table: DataTable = {
  id: 'people', name: 'People', slug: 'people', kind: 'data', singularLabel: 'Person', pluralLabel: 'People',
  routeBase: '', primaryFieldId: 'title', fields: [{ id: 'title', type: 'text', label: 'Name' }], system: false,
  createdByUserId: null, updatedByUserId: null, createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z',
}

const generation = 'opaque-picker-generation'

function row(id: string, title: string, tableId = table.id): MaterializedDataEntry {
  return {
    id, reference: { tableId, rowId: id, branchId: 'main', view: 'draft', generation },
    title, tableSlug: tableId, cells: { title: 'Cell text cannot replace the native title' }, fields: table.fields, media: {},
    slug: id, status: 'draft', author: null, publishedBy: null, url: null, version: null,
    createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z', publishedAt: null,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let restoreFetch = () => {}
let restoreBranch = () => {}
function requestInput(init?: RequestInit): DataCollectionReadRequest {
  return JSON.parse(String(init?.body)) as DataCollectionReadRequest
}

function nativeResponse(rows: MaterializedDataEntry[], input: DataCollectionReadRequest, responseGeneration = generation): Response {
  const { query } = input
  const source = query.source
  const members = source.kind === 'entries' ? source.rowIds.map(id => rows.find(candidate => candidate.id === id)) : rows
  if (members.some(member => member === undefined)) return json({ error: 'The selected related rows are unavailable', code: 'relation_unavailable' }, 404)
  let admitted = members as MaterializedDataEntry[]
  if (query.search) admitted = admitted.filter(member => member.title.toLowerCase().includes(query.search!.text.toLowerCase()))
  const items = admitted.slice(query.offset, query.offset + query.limit)
  const hasMore = query.offset + query.limit < admitted.length
  return json({ items, cardinalityCount: members.length, totalItems: admitted.length, offset: query.offset, limit: query.limit,
    hasMore, nextOffset: hasMore ? query.offset + query.limit : null, generation: responseGeneration })
}

function respond(rows: MaterializedDataEntry[]) {
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => nativeResponse(rows, requestInput(init)))
  restoreFetch = () => fetchMock.mockRestore()
  return fetchMock
}

afterEach(() => {
  cleanup()
  restoreBranch()
  restoreBranch = () => {}
  restoreFetch()
})

function confirm(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement
}

function selectedNames(): (string | null)[] {
  const list = screen.getByRole('list', { name: 'Selected rows' })
  return within(list).getAllByRole('button', { name: /^Remove / }).map(button => button.getAttribute('aria-label'))
}

async function ready() {
  await waitFor(() => expect(confirm().disabled).toBe(false), { timeout: 5000 })
}

const base = { open: true, targetTable: table, onClose: () => {}, allowMultiple: true }

describe('RelationPickerDialog ordered membership', () => {
  it('retains authored order through search, appends a choice and reorders it with the keyboard', async () => {
    const user = userEvent.setup()
    respond([row('a', 'Alpha'), row('c', 'Gamma'), row('b', 'Beta')])
    let picked: string | string[] | null = null
    render(<RelationPickerDialog {...base} currentValue={['b', 'a']} onPick={value => { picked = value }} />)
    await ready()
    expect(selectedNames()).toEqual(['Remove Beta', 'Remove Alpha'])
    expect(screen.getByText('2 related rows selected')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Move Beta up' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Move Alpha down' }) as HTMLButtonElement).disabled).toBe(true)

    await user.type(screen.getByPlaceholderText('Search people…'), 'gamma')
    await ready()
    expect(selectedNames()).toEqual(['Remove Beta', 'Remove Alpha'])
    const candidates = screen.getByRole('group', { name: 'Available rows' })
    await user.click(within(candidates).getByRole('button', { name: 'Gamma' }))
    await ready()
    expect(selectedNames()).toEqual(['Remove Beta', 'Remove Alpha', 'Remove Gamma'])
    const moveUp = screen.getByRole('button', { name: 'Move Gamma up' })
    moveUp.focus()
    await user.keyboard('{Enter}')
    await ready()
    expect(selectedNames()).toEqual(['Remove Beta', 'Remove Gamma', 'Remove Alpha'])
    await user.click(confirm())
    expect(picked).toEqual(['b', 'c', 'a'])
  })

  it('commits an explicitly cleared multi relation as an empty array', async () => {
    const user = userEvent.setup()
    respond([row('a', 'Alpha')])
    let picked: string | string[] | null = 'not-called'
    render(<RelationPickerDialog {...base} currentValue={['a']} onPick={value => { picked = value }} />)
    await ready()
    await user.click(screen.getByRole('button', { name: 'Remove Alpha' }))
    expect(screen.getByText('0 related rows selected')).toBeTruthy()
    await ready()
    await user.click(confirm())
    expect(picked).toEqual([])
  })

  it('commits a cleared single relation as null and supplies no reorder controls', async () => {
    const user = userEvent.setup()
    respond([row('a', 'Alpha')])
    let picked: string | string[] | null = 'not-called'
    render(<RelationPickerDialog {...base} allowMultiple={false} currentValue="a" onPick={value => { picked = value }} />)
    await ready()
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Remove Alpha' }))
    await ready()
    await user.click(confirm())
    expect(picked).toBeNull()
  })

  it('keeps an unavailable member in its authored position and blocks confirmation until a successful retry', async () => {
    const user = userEvent.setup()
    const fetchMock = respond([row('a', 'Alpha')])
    let picked: string | string[] | null = null
    render(<RelationPickerDialog {...base} currentValue={['missing-private-id', 'a']} onPick={value => { picked = value }} />)
    await screen.findByText('The selected related rows are unavailable')
    expect(selectedNames()).toEqual(['Remove selection 1', 'Remove selection 2'])
    expect(screen.getByText('2 related rows selected')).toBeTruthy()
    expect(screen.queryByText('missing-private-id')).toBeNull()
    expect(confirm().disabled).toBe(true)
    await user.click(confirm())
    expect(picked).toBeNull()

    fetchMock.mockImplementation(async (_url, init) => nativeResponse([row('a', 'Alpha'), row('missing-private-id', 'Recovered person')], requestInput(init)))
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await ready()
    expect(selectedNames()).toEqual(['Remove Recovered person', 'Remove Alpha'])
    await user.click(confirm())
    expect(picked).toEqual(['missing-private-id', 'a'])
  })

  it('removes an unavailable member only when the author explicitly chooses Remove', async () => {
    const user = userEvent.setup()
    respond([row('a', 'Alpha')])
    let picked: string | string[] | null = null
    render(<RelationPickerDialog {...base} currentValue={['missing-private-id', 'a']} onPick={value => { picked = value }} />)
    await screen.findByText('The selected related rows are unavailable')
    await user.click(screen.getByRole('button', { name: 'Remove selection 1' }))
    await ready()
    expect(selectedNames()).toEqual(['Remove Alpha'])
    await user.click(confirm())
    expect(picked).toEqual(['a'])
  })

  it('shows the actual read error and retains every selected position until retry succeeds', async () => {
    const user = userEvent.setup()
    const fetchMock = respond([])
    fetchMock.mockImplementation(async () => json({ error: 'The related table is temporarily unavailable' }, 503))
    render(<RelationPickerDialog {...base} currentValue={['b', 'a']} onPick={() => { throw new Error('Must not commit') }} />)
    await screen.findByText('The related table is temporarily unavailable')
    expect(selectedNames()).toEqual(['Remove selection 1', 'Remove selection 2'])
    expect(screen.getAllByText('Could not load related row')).toHaveLength(2)
    expect(confirm().disabled).toBe(true)
    fetchMock.mockImplementation(async (_url, init) => nativeResponse([row('a', 'Alpha'), row('b', 'Beta')], requestInput(init)))
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await ready()
    expect(selectedNames()).toEqual(['Remove Beta', 'Remove Alpha'])
  })

  it('surfaces duplicate membership instead of silently reducing it to one row', async () => {
    respond([row('a', 'Alpha')])
    const props = { ...base, onPick: () => { throw new Error('Must not commit malformed membership') } }
    const view = render(<RelationPickerDialog {...props} currentValue={['a', 'a']} />)
    await screen.findByRole('group', { name: 'Available rows' })
    expect(screen.getByRole('alert').textContent).toContain('A row ID occurs more than once')
    expect(confirm().disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Alpha' }) as HTMLButtonElement).disabled).toBe(true)
    view.rerender(<RelationPickerDialog {...props} currentValue={['a']} />)
    await ready()
    expect(selectedNames()).toEqual(['Remove Alpha'])
  })

  it('never admits retained rows from a previous target while the new table is loading', async () => {
    const fetchMock = respond([row('a', 'Alpha')])
    const view = render(<RelationPickerDialog {...base} currentValue={['a']} onPick={() => {}} />)
    await ready()
    let complete: () => void = () => { throw new Error('The next read has not started') }
    const nextRead = new Promise<void>(resolve => { complete = resolve })
    fetchMock.mockImplementation(async (_url, init) => {
      await nextRead
      return nativeResponse([row('a', 'Another person', 'other-people')], requestInput(init))
    })
    const nextTable: DataTable = { ...table, id: 'other-people', slug: 'other-people' }
    view.rerender(<RelationPickerDialog {...base} targetTable={nextTable} currentValue={['a']} onPick={() => {}} />)
    expect(confirm().disabled).toBe(true)
    expect(screen.queryByText('Alpha')).toBeNull()
    expect(selectedNames()).toEqual(['Remove selection 1'])
    await act(async () => complete())
    await ready()
    expect(selectedNames()).toEqual(['Remove Another person'])
  })

  it('invalidates retained rows when the active branch content epoch changes', async () => {
    const previousEpoch = useBranchStore.getState().epoch
    restoreBranch = () => useBranchStore.setState({ epoch: previousEpoch })
    const fetchMock = respond([row('a', 'Before merge')])
    render(<RelationPickerDialog {...base} currentValue={['a']} onPick={() => {}} />)
    await ready()
    const next = row('a', 'After merge')
    next.reference.generation = 'after-merge-generation'
    let complete: () => void = () => { throw new Error('The next read has not started') }
    const nextRead = new Promise<void>(resolve => { complete = resolve })
    fetchMock.mockImplementation(async (_url, init) => {
      await nextRead
      return nativeResponse([next], requestInput(init), next.reference.generation)
    })
    act(() => useBranchStore.getState().bumpEpoch())
    expect(confirm().disabled).toBe(true)
    expect(screen.queryByText('Before merge')).toBeNull()
    await act(async () => complete())
    await ready()
    expect(selectedNames()).toEqual(['Remove After merge'])
  })

  it('requires an explicit content language and blocks a failed catalogue projection without exposing a reference as a title', async () => {
    const projected = row('private-row-id', 'Prima persona')
    projected.cells.title = { key: 'people.first' }
    const fetchMock = respond([projected])
    const localizedTable: DataTable = { ...table, fields: [{ id: 'title', type: 'localizedText', label: 'Name' }] }
    const props = { ...base, targetTable: localizedTable, currentValue: ['private-row-id'], onPick: () => {} }
    const resource: LocalizedDataState = {
      language: '', setLanguage: () => {}, data: null, context: undefined,
      loading: false, error: null, refresh: () => {}, required: true,
    }
    const view = render(<LocalizedDataContext.Provider value={resource}><RelationPickerDialog {...props} /></LocalizedDataContext.Provider>)
    await screen.findByText('Select a language before choosing related localized rows.')
    expect(confirm().disabled).toBe(true)
    expect(selectedNames()).toEqual(['Remove selection 1'])
    expect(screen.queryByText('private-row-id')).toBeNull()
    expect(screen.queryByText('people.first')).toBeNull()

    view.rerender(<LocalizedDataContext.Provider value={{ ...resource, language: 'it', context: { language: 'it', translations: { people: { first: 'Prima persona' } } } }}>
      <RelationPickerDialog {...props} />
    </LocalizedDataContext.Provider>)
    await ready()
    expect(selectedNames()).toEqual(['Remove Prima persona'])
    fetchMock.mockImplementation(async () => json({ error: 'The content language projection is unavailable' }, 422))
    view.rerender(<LocalizedDataContext.Provider value={{ ...resource, language: 'fr', context: { language: 'fr', translations: {} } }}>
      <RelationPickerDialog {...props} />
    </LocalizedDataContext.Provider>)
    await screen.findByText('The content language projection is unavailable')
    expect(confirm().disabled).toBe(true)
    expect(selectedNames()).toEqual(['Remove selection 1'])
    expect(screen.getByText('1 related row selected')).toBeTruthy()
    expect(screen.getByText('Could not load related row')).toBeTruthy()
  })

  it('resolves selected members outside the current candidate page and requests search and more pages from the server', async () => {
    const user = userEvent.setup()
    const rows = Array.from({ length: 101 }, (_, index) => row(`person-${index}`, `Person ${index}`))
    const fetchMock = respond(rows)
    render(<RelationPickerDialog {...base} currentValue={['person-100']} onPick={() => {}} />)
    await ready()
    expect(selectedNames()).toEqual(['Remove Person 100'])
    let candidates = screen.getByRole('group', { name: 'Available rows' })
    expect(within(candidates).queryByRole('button', { name: 'Person 100' })).toBeNull()
    const inputs = fetchMock.mock.calls.map(([, init]) => requestInput(init))
    expect(inputs[0]).toMatchObject({ view: 'draft', query: { source: { kind: 'entries', tableId: table.id, rowIds: ['person-100'] }, offset: 0, limit: 500 } })
    expect(inputs[1]).toMatchObject({ generation, query: { source: { kind: 'table', tableId: table.id }, offset: 0, limit: 100 } })
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await ready()
    candidates = screen.getByRole('group', { name: 'Available rows' })
    expect(within(candidates).getByRole('button', { name: 'Person 100' })).toBeTruthy()
    expect(fetchMock.mock.calls.map(([, init]) => requestInput(init)).some(input => input.generation === generation && input.query.source.kind === 'table' && input.query.offset === 100)).toBe(true)
    await user.type(screen.getByPlaceholderText('Search people…'), 'Person 100')
    await ready()
    expect(selectedNames()).toEqual(['Remove Person 100'])
    const searched = fetchMock.mock.calls.map(([, init]) => requestInput(init)).findLast(input => input.query.search?.text === 'Person 100')
    expect(searched).toMatchObject({ generation, query: { source: { kind: 'table', tableId: table.id }, search: { fieldIds: [], title: true, text: 'Person 100' }, offset: 0, limit: 100 } })
  })

  it('resolves more than 500 selected rows in bounded pages with one generation before confirmation', async () => {
    const rows = Array.from({ length: 501 }, (_, index) => row(`selected-${index}`, `Selected ${index}`))
    const fetchMock = respond(rows)
    render(<RelationPickerDialog {...base} currentValue={rows.map(member => member.id)} onPick={() => {}} />)
    expect(confirm().disabled).toBe(true)
    await ready()
    const inputs = fetchMock.mock.calls.map(([, init]) => requestInput(init))
    const selectedReads = inputs.filter(input => input.query.source.kind === 'entries')
    expect(selectedReads.map(input => [input.query.offset, input.query.limit, input.generation])).toEqual([[0, 500, undefined], [500, 500, generation]])
    expect(inputs.filter(input => input.query.source.kind === 'table').every(input => input.generation === generation)).toBe(true)
    expect(selectedNames()).toHaveLength(501)
    expect(selectedNames().at(-1)).toBe('Remove Selected 500')
  }, 15000)

  it('retains selection and blocks a real stale-generation failure between selected pages until retry succeeds', async () => {
    const user = userEvent.setup()
    const rows = Array.from({ length: 501 }, (_, index) => row(`selected-${index}`, `Selected ${index}`))
    const fetchMock = respond(rows)
    fetchMock.mockImplementation(async (_url, init) => {
      const input = requestInput(init)
      return input.query.source.kind === 'entries' && input.query.offset === 500
        ? json({ error: 'Content changed during this read; reload and retry.', code: 'stale_generation' }, 409)
        : nativeResponse(rows, input)
    })
    render(<RelationPickerDialog {...base} currentValue={rows.map(member => member.id)} onPick={() => { throw new Error('Must not commit a stale read') }} />)
    await screen.findByText('Content changed during this read; reload and retry.')
    expect(confirm().disabled).toBe(true)
    expect(selectedNames()).toHaveLength(501)
    expect(screen.getByText('501 related rows selected')).toBeTruthy()
    fetchMock.mockImplementation(async (_url, init) => nativeResponse(rows, requestInput(init)))
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await ready()
    expect(selectedNames().at(-1)).toBe('Remove Selected 500')
  }, 15000)

  it('keeps the dialog open and reports a rejected update through the native toast bus', async () => {
    const user = userEvent.setup()
    respond([row('a', 'Alpha')])
    let closed = 0
    render(<><ToastProvider /><RelationPickerDialog {...base} currentValue={['a']}
      onClose={() => { closed += 1 }} onPick={() => { throw new Error('The authoring transaction rejected this relation') }} /></>)
    await ready()
    await user.click(confirm())
    expect(closed).toBe(0)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((await screen.findByText('The authoring transaction rejected this relation')).closest('[role="alert"]')).toBeTruthy()
    for (const dismiss of screen.getAllByRole('button', { name: 'Dismiss notification' })) await user.click(dismiss)
  })
})
