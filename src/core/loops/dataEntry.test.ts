import { expect, test } from 'bun:test'
import type { MaterializedDataEntry } from '@core/data-read'
import { dataEntryToLoopItem, loopReadKey } from './dataEntry'

function nativeEntry(): MaterializedDataEntry {
  return {
    id: 'true-row', reference: { branchId: 'main', view: 'public', generation: 'opaque', tableId: 'guides', rowId: 'true-row' },
    title: 'Sicherheit', tableSlug: 'guides', slug: '', url: null, status: 'published',
    author: { displayName: 'Author', roleSlug: 'editor', roleName: 'Editor' }, publishedBy: null,
    createdAt: '2026-01-01', updatedAt: '2026-01-01', publishedAt: null, version: null,
    media: {},
    fields: [{ id: 'heading', label: 'Heading', type: 'localizedText' }],
    cells: { heading: 'Sicherheit', id: 'claimed-row', tableId: 'private', reference: { generation: 'fake' }, related: ['second', 'first'] },
  }
}

test('native provenance belongs to the admitted read frame, outside editable cells', () => {
  const entry = nativeEntry()
  const item = dataEntryToLoopItem(entry)
  expect(item.dataEntry?.reference).toEqual(entry.reference)
  expect(item.fields.id).toBe('true-row')
  expect(item.fields.tableId).toBe('guides')
  expect(item.fields.related).toEqual(['second', 'first'])
  expect(item.dataEntry?.cells.related).toEqual(['second', 'first'])
  expect(item.fields.author).toBe('Author')
  expect(item.fields.permalink).toBeNull()
  item.fields.related = []
  item.dataEntry!.reference.rowId = 'client-change'
  item.dataEntry!.cells.related = []
  expect(entry.reference.rowId).toBe('true-row')
  expect(entry.cells.related).toEqual(['second', 'first'])
})

test('native bindings resolve media aliases while the entry frame retains exact raw references', () => {
  const entry = nativeEntry()
  entry.fields.push({ id: 'featuredMedia', label: 'Featured media', type: 'media' })
  entry.cells.featuredMedia = 'asset'
  entry.cells.body = '![Authored image](/uploads/inline.png)'
  entry.media.asset = { publicPath: '/uploads/cover.png', mimeType: 'image/png', altText: 'Cover', width: 20, height: 10 }
  const item = dataEntryToLoopItem(entry)
  expect(item.fields.featuredMedia).toBe('/uploads/cover.png')
  expect(item.fields.featuredMediaId).toBe('asset')
  expect(item.fields.firstImage).toBe('/uploads/inline.png')
  expect(item.dataEntry?.cells.featuredMedia).toBe('asset')
  expect(entry.cells.featuredMedia).toBe('asset')
})

test('loop results never collide across repeated VC, parent, branch, view, generation or repeater frames', () => {
  const item = dataEntryToLoopItem(nativeEntry())
  const initial = loopReadKey('ref-one:loop', [item])
  expect(loopReadKey('ref-two:loop', [item])).not.toBe(initial)
  for (const reference of [
    { ...item.dataEntry!.reference, branchId: 'branch' },
    { ...item.dataEntry!.reference, view: 'draft' as const },
    { ...item.dataEntry!.reference, generation: 'changed' },
    { ...item.dataEntry!.reference, tableId: 'different' },
    { ...item.dataEntry!.reference, rowId: 'parent-two' },
    { ...item.dataEntry!.reference, repeater: { fieldId: 'items', itemId: 'stable-one' } },
  ]) expect(loopReadKey('ref-one:loop', [{ ...item, dataEntry: { ...item.dataEntry!, reference } }])).not.toBe(initial)
  expect(loopReadKey('ref-one:loop', [{ ...item, fields: { ...item.fields, id: 'spoofed' } }])).toBe(initial)
})
