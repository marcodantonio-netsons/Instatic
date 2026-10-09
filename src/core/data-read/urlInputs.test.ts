import { expect, test } from 'bun:test'
import { decodeDataQueryUrlInputs } from './urlInputs'
import { RelationValidationError } from './errors'
import type { DataCollectionQuery, DataQueryUrlInput } from './querySchema'

const authored: DataCollectionQuery = {
  source: { kind: 'table', tableId: 'guides' }, search: { fieldIds: ['heading'], text: '' },
  where: { kind: 'presence', fieldId: 'heading', operator: 'present' }, offset: 0, limit: 20,
}
const declarations: DataQueryUrlInput[] = [
  { parameter: 'q', operand: 'search' },
  { parameter: 'category', operand: 'relationOwner', ownerTableId: 'categories', field: { fieldId: 'members' }, allowedRowIds: ['security', 'cloud'] },
  { parameter: 'featured', operand: 'predicate', fieldId: 'label', kind: 'field', allowedValues: ['yes'] },
  { parameter: 'size', operand: 'pageSize', maximum: 50 },
]

test('only declared URL operands affect query/cache identity; no client chooses table or locale', () => {
  const params = new URLSearchParams('utm=tracking&tableId=private&language=it&size=2&q=Sicherheit&category=security&featured=yes')
  const decoded = decodeDataQueryUrlInputs(authored, declarations, params)
  expect(decoded.query.source).toEqual({ kind: 'relation', owner: { tableId: 'categories', rowId: 'security' }, field: { fieldId: 'members' } })
  expect(decoded.query.search).toEqual({ fieldIds: ['heading'], text: 'Sicherheit' })
  expect(decoded.query.limit).toBe(2)
  expect(decoded.canonicalSearch).toBe('?category=security&featured=yes&q=Sicherheit&size=2')
  expect(authored.source).toEqual({ kind: 'table', tableId: 'guides' })
  expect(authored.search?.text).toBe('')
})

test.each(['category=private', 'category=', 'size=0', 'size=51', 'size=1.5', 'size=02', 'size=Infinity', 'q=a&q=b'])('malformed declared operands fail: %s', search => {
  expect(() => decodeDataQueryUrlInputs(authored, declarations, new URLSearchParams(search))).toThrow(RelationValidationError)
})

test('absent operands preserve authored conditions and empty search has one canonical identity', () => {
  expect(decodeDataQueryUrlInputs(authored, declarations, new URLSearchParams('q=&utm=1')).canonicalSearch).toBe('')
  expect(decodeDataQueryUrlInputs(authored, declarations, new URLSearchParams()).query).toEqual(authored)
})

test('duplicate declaration is a configuration error and unconfigured search is not silently accepted', () => {
  expect(() => decodeDataQueryUrlInputs(authored, [declarations[0], declarations[0]], new URLSearchParams())).toThrow(RelationValidationError)
  expect(() => decodeDataQueryUrlInputs({ ...authored, search: undefined }, [declarations[0]], new URLSearchParams('q=a'))).toThrow(RelationValidationError)
})
