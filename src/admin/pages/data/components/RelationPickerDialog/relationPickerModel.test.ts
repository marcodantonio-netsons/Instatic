import { describe, expect, it } from 'bun:test'
import { DataReadGenerationError, RelationResolutionError, RelationValidationError, type MaterializedDataEntry } from '@core/data-read'
import { movePickerRow, presentPickerRows, readPickerSelection, selectedPickerRows, togglePickerRow } from './relationPickerModel'

const tableId = 'people'
const generation = 'opaque-generation'

function row(id: string, title: string, targetTableId = tableId): MaterializedDataEntry {
  return {
    id, reference: { tableId: targetTableId, rowId: id, generation, branchId: 'main', view: 'draft' },
    title, tableSlug: targetTableId, cells: { title: 'Editable value is not the canonical title' }, fields: [], media: {},
    slug: id, status: 'draft', author: null, publishedBy: null, url: null, version: null,
    createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z', publishedAt: null,
  }
}

describe('relation picker authored membership', () => {
  it('retains authored order and does not alias the stored array', () => {
    const value = ['third', 'first', 'second']
    const selection = readPickerSelection(value, true)
    expect(selection).toEqual({ kind: 'valid', ids: value })
    if (selection.kind === 'valid') selection.ids.push('fourth')
    expect(value).toEqual(['third', 'first', 'second'])
  })

  it('keeps malformed or duplicate drafts invalid instead of normalizing them', () => {
    for (const value of [['a', 'a'], [''], 'a']) {
      const selection = readPickerSelection(value, true)
      expect(selection.kind).toBe('invalid')
      if (selection.kind === 'invalid') {
        expect(selection.error).toBeInstanceOf(RelationValidationError)
        expect(selection.value).toBe(value)
      }
    }
    expect(readPickerSelection(['a'], false).kind).toBe('invalid')
  })

  it('appends new members, removes explicitly, and replaces a single relation', () => {
    const ids = ['third', 'first']
    expect(togglePickerRow(ids, 'second', true)).toEqual(['third', 'first', 'second'])
    expect(togglePickerRow(ids, 'third', true)).toEqual(['first'])
    expect(togglePickerRow(['first'], 'second', false)).toEqual(['second'])
    expect(togglePickerRow(['first'], 'first', false)).toEqual([])
    expect(ids).toEqual(['third', 'first'])
  })

  it('moves only the chosen member without mutating the draft or wrapping at boundaries', () => {
    const ids = ['third', 'first', 'second']
    expect(movePickerRow(ids, 1, -1)).toEqual(['first', 'third', 'second'])
    expect(movePickerRow(ids, 0, 1)).toEqual(['first', 'third', 'second'])
    expect(movePickerRow(ids, 0, -1)).toEqual(ids)
    expect(movePickerRow(ids, 2, 1)).toEqual(ids)
    expect(ids).toEqual(['third', 'first', 'second'])
  })

  it('keeps missing selected targets in place independently of candidate order', () => {
    const available = presentPickerRows([row('a', 'Alpha'), row('b', 'Beta')], tableId, generation)
    const selected = selectedPickerRows(['missing', 'b', 'a'], available)
    expect(selected.map(item => item.id)).toEqual(['missing', 'b', 'a'])
    expect(selected[0]?.kind).toBe('unavailable')
    if (selected[0]?.kind === 'unavailable') {
      expect(selected[0].error).toBeInstanceOf(RelationResolutionError)
      expect(selected[0].error).toMatchObject({ code: 'relation_unavailable', path: 'relation[0]' })
    }
    expect(selected.slice(1)).toEqual([{ id: 'b', kind: 'ready', title: 'Beta' }, { id: 'a', kind: 'ready', title: 'Alpha' }])
  })

  it('requires native target identity and rejects rows from a different table', () => {
    const presented = presentPickerRows([row('other', 'Private title', 'other-table')], tableId, generation)
    expect(presented[0]?.kind).toBe('unavailable')
    if (presented[0]?.kind === 'unavailable') {
      expect(presented[0].error).toMatchObject({ code: 'invalid_relation_target' })
      expect(presented[0]).not.toHaveProperty('title')
    }
  })

  it('uses the projected canonical title without guessing a cell or resolving a catalogue again', () => {
    const projected = row('row-id-is-not-a-title', 'Prima persona')
    projected.cells = { title: { key: 'people.private-key' }, id: 'cell-cannot-claim-identity' }
    expect(presentPickerRows([projected], tableId, generation)).toEqual([{ id: projected.id, kind: 'ready', title: 'Prima persona' }])
    expect(projected.cells.title).toEqual({ key: 'people.private-key' })
  })

  it('keeps a different native generation unavailable instead of accepting retained rows', () => {
    const projected = row('a', 'Alpha')
    const presented = presentPickerRows([projected], tableId, 'new-generation')
    expect(presented[0]?.kind).toBe('unavailable')
    if (presented[0]?.kind === 'unavailable') expect(presented[0].error).toBeInstanceOf(DataReadGenerationError)
  })
})
