import { expect, test } from 'bun:test'
import type { DataField } from './schemas'
import { collectDataMediaIds, projectDataMediaCells, readDataMediaIds, DataMediaValidationError } from './mediaCells'

const fields: DataField[] = [
  { id: 'cover', label: 'Cover', type: 'media' },
  { id: 'items', label: 'Items', type: 'repeater', fields: [{ id: 'gallery', label: 'Gallery', type: 'media', allowMultiple: true }] },
]
const media = {
  a: { publicPath: '/uploads/a.png', mimeType: 'image/png', altText: 'A', width: 20, height: 10 },
  b: { publicPath: '/uploads/b.png', mimeType: 'image/png', altText: 'B', width: 20, height: 10 },
}

test('media projection preserves ordered positions and stable repeater identity without editing raw cells', () => {
  const cells = { cover: 'a', items: [{ id: 'stable', cells: { gallery: ['b', 'a', 'b'], relation: ['second', 'first'] } }] }
  expect(collectDataMediaIds(cells, fields)).toEqual(['a', 'b', 'a', 'b'])
  const projected = projectDataMediaCells(cells, fields, media)
  expect(projected).toEqual({ cover: '/uploads/a.png', items: [{ id: 'stable', cells: { gallery: ['/uploads/b.png', '/uploads/a.png', '/uploads/b.png'], relation: ['second', 'first'] } }] })
  expect(cells.cover).toBe('a')
  expect(cells.items[0].cells.gallery).toEqual(['b', 'a', 'b'])
})

test('missing media stays an explicit failure rather than changing collection cardinality', () => {
  expect(() => projectDataMediaCells({ cover: null, items: [{ id: 'stable', cells: { gallery: ['b', 'missing', 'a'] } }] }, fields, media)).toThrow(DataMediaValidationError)
})

test.each([
  { value: ['a'], multiple: false }, { value: 'a', multiple: true },
  { value: ['a', null], multiple: true }, { value: [''], multiple: true },
  { value: ' a ', multiple: false },
])('media values honor declared cardinality and exact identities: %j', ({ value, multiple }) => {
  expect(() => readDataMediaIds(value, multiple, 'cells.media')).toThrow(DataMediaValidationError)
})

test('empty declared media cells have their native empty shape', () => {
  expect(projectDataMediaCells({ cover: null, items: [] }, fields, media)).toEqual({ cover: null, items: [] })
  expect(readDataMediaIds(null, true, 'cells.gallery')).toEqual([])
})
