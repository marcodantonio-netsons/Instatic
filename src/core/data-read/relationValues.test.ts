import { describe, expect, it } from 'bun:test'
import {
  readRelationIds, relationCellValue, readRelationRepeaterValue, resolveRelationField,
  relationReadKey, relationFieldPathForOwner, RelationValidationError, type DataEntryReference,
} from './index'

describe('ordered relation cell contract', () => {
  it('preserves owner order and shared memberships without changing either cell', () => {
    const first = ['third', 'shared', 'first']
    const second = ['shared', 'other']
    expect(readRelationIds(first, { allowMultiple: true }, 'first')).toEqual(first)
    expect(readRelationIds(second, { allowMultiple: true }, 'second')).toEqual(second)
    expect(readRelationIds(first, { allowMultiple: true }, 'first')).not.toBe(first)
    expect(first).toEqual(['third', 'shared', 'first'])
    expect(second).toEqual(['shared', 'other'])
  })

  it('admits explicit empty draft states and writes canonical empty shapes', () => {
    for (const value of [undefined, null]) {
      expect(readRelationIds(value, {}, 'single')).toEqual([])
      expect(readRelationIds(value, { allowMultiple: true }, 'multiple')).toEqual([])
    }
    expect(relationCellValue([], {})).toBeNull()
    expect(relationCellValue([], { allowMultiple: true })).toEqual([])
    expect(relationCellValue(['a'], {})).toBe('a')
    expect(relationCellValue(['b', 'a'], { allowMultiple: true })).toEqual(['b', 'a'])
  })

  it.each(['', ' ', 1, false, { id: 'a' }, ['a', ''], ['a', null], ['a', 1]])('rejects malformed multiple memberships without filtering: %j', (value) => {
    expect(() => readRelationIds(value, { allowMultiple: true }, 'cells.members')).toThrow(RelationValidationError)
  })

  it('rejects duplicates and cardinality mismatches rather than deduplicating or taking the first', () => {
    try {
      readRelationIds(['a', 'b', 'a'], { allowMultiple: true }, 'cells.members')
      throw new Error('A duplicate was accepted')
    } catch (error) {
      expect(error).toBeInstanceOf(RelationValidationError)
      expect((error as RelationValidationError).code).toBe('duplicate_relation_id')
      expect((error as RelationValidationError).path).toBe('cells.members[2]')
    }
    expect(() => readRelationIds(['a'], {}, 'cells.member')).toThrow(RelationValidationError)
    expect(() => relationCellValue(['a', 'b'], {})).toThrow(RelationValidationError)
  })

  it('uses stable repeater identity rather than position when resolving the declared field', () => {
    const field = { id: 'members', type: 'relation' as const, label: 'Members', targetTableId: 'articles', allowMultiple: true }
    const schema = [{ id: 'sections', type: 'repeater' as const, label: 'Sections', fields: [field] }]
    const cells = { sections: [{ id: 'b', cells: { members: ['third', 'first'] } }, { id: 'a', cells: { members: ['second'] } }] }
    const path = { fieldId: 'members', repeater: { fieldId: 'sections', itemId: 'a' } }
    expect(resolveRelationField(schema, cells, path, 'row').value).toEqual(['second'])
    expect(resolveRelationField(schema, { sections: [...cells.sections].reverse() }, path, 'row').value).toEqual(['second'])
    expect(() => resolveRelationField(schema, cells, { ...path, repeater: { fieldId: 'sections', itemId: 'missing' } }, 'row')).toThrow(RelationValidationError)
    expect(() => resolveRelationField(schema, cells, { fieldId: 'missing' }, 'row')).toThrow(RelationValidationError)
  })

  it('rejects malformed or repeated repeater identities before selecting any item', () => {
    for (const value of [false, [{ id: '', cells: {} }], [{ id: 'a', cells: {} }, { id: 'a', cells: {} }]]) {
      expect(() => readRelationRepeaterValue(value, 'cells.sections')).toThrow(RelationValidationError)
    }
  })

  it('keys branch/view/generation/table/row/item separately and cannot collide through delimiters', () => {
    const owner: DataEntryReference = { branchId: 'main', view: 'draft', generation: '1', tableId: 'owners', rowId: 'a:b' }
    const field = { fieldId: 'members' }
    const key = relationReadKey(owner, field)
    for (const changed of [{ branchId: 'branch' }, { view: 'public' as const }, { generation: '2' }, { tableId: 'other' }, { rowId: 'b' }]) {
      expect(relationReadKey({ ...owner, ...changed }, field)).not.toBe(key)
    }
    expect(relationReadKey({ ...owner, rowId: 'a' }, { fieldId: 'b:members' })).not.toBe(key)
    expect(relationReadKey(owner, { fieldId: 'members', repeater: { fieldId: 'sections', itemId: 'a' } })).not.toBe(
      relationReadKey(owner, { fieldId: 'members', repeater: { fieldId: 'sections', itemId: 'b' } }),
    )
  })

  it('binds relative fields to the actual repeater frame and rejects conflicting item claims', () => {
    const owner: DataEntryReference = { branchId: 'main', view: 'draft', generation: '1', tableId: 'owners', rowId: 'row', repeater: { fieldId: 'sections', itemId: 'one' } }
    expect(relationFieldPathForOwner(owner, { fieldId: 'members' })).toEqual({ fieldId: 'members', repeater: owner.repeater })
    expect(() => relationReadKey(owner, { fieldId: 'members', repeater: { fieldId: 'sections', itemId: 'other' } })).toThrow(RelationValidationError)
  })
})
