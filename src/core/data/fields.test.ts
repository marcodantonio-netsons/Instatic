import { expect, test } from 'bun:test'
import { DataFieldValidationError, parseDataTableFields } from './fields'

test('the persisted field parser retains every valid field without rewriting it', () => {
  const fields = [{ id: 'related', label: 'Related', type: 'relation', targetTableId: 'target', allowMultiple: true }]
  expect(parseDataTableFields(fields)).toEqual(fields)
})

test.each([
  [{ id: 'empty', label: 'Empty', type: 'unknown' }],
  [{ id: '', label: 'Empty', type: 'text' }],
  [{ id: 'same', label: 'One', type: 'text' }, { id: 'same', label: 'Two', type: 'relation', targetTableId: 'target' }],
  [{ id: 'repeater', label: 'Items', type: 'repeater', fields: [{ id: 'same', label: 'One', type: 'text' }, { id: 'same', label: 'Two', type: 'text' }] }],
  [{ id: 'valid', label: 'Valid', type: 'text' }, { id: 'broken', label: 'Broken', type: 'relation' }],
].map(fields => ({ fields })))('invalid whole schemas fail without dropping malformed fields: %j', ({ fields }) => {
  expect(() => parseDataTableFields(fields)).toThrow(DataFieldValidationError)
})

test('identity errors carry the collection/repeater path', () => {
  try { parseDataTableFields([{ id: 'items', label: 'Items', type: 'repeater', fields: [{ id: '', label: 'Empty', type: 'text' }] }], 'tables.real.fields') }
  catch (error) {
    expect(error).toBeInstanceOf(DataFieldValidationError)
    if (error instanceof DataFieldValidationError) expect(error.path).toBe('tables.real.fields.items.fields.0.id')
    return
  }
  throw new Error('Invalid identity was accepted')
})
