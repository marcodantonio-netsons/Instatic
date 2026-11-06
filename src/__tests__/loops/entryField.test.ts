import { describe, expect, it } from 'bun:test'
import { LoopQueryConfigurationError, readEntryFieldItemIdFilter, resolveEntryFieldItems } from '@core/loops'

describe('current-entry-field loop items', () => {
  it('keeps primitive array values in authored order', () => {
    const result = resolveEntryFieldItems(['first', 'second'], {
      direction: 'asc',
      limit: 10,
    })

    expect(result.totalItems).toBe(2)
    expect(result.items.map((item) => item.fields.value)).toEqual(['first', 'second'])
    expect(result.items.map((item) => item.fields.index)).toEqual([0, 1])
    expect(resolveEntryFieldItems(['first', 'second'], { itemId: '' }).items.map((item) => item.fields.value))
      .toEqual(['first', 'second'])
  })

  it('projects object members while preserving the original value', () => {
    const object = { id: 'shot-1', caption: 'Evening light' }
    const result = resolveEntryFieldItems([object])

    expect(result.items[0]?.id).toBe('shot-1')
    expect(result.items[0]?.fields.caption).toBe('Evening light')
    expect(result.items[0]?.fields.value).toEqual(object)
  })

  it('enriches media ids with renderable media fields', () => {
    const result = resolveEntryFieldItems(['media-1'], {
      mediaByReference: new Map([
        ['media-1', {
          publicPath: '/uploads/portfolio-1.webp',
          mimeType: 'image/webp',
          width: 1600,
          height: 1067,
          altText: 'Portrait in a studio',
        }],
      ]),
    })

    expect(result.items[0]?.fields).toMatchObject({
      id: 'media-1',
      value: '/uploads/portfolio-1.webp',
      src: '/uploads/portfolio-1.webp',
      url: '/uploads/portfolio-1.webp',
      path: '/uploads/portfolio-1.webp',
      altText: 'Portrait in a studio',
      mimeType: 'image/webp',
      width: 1600,
      height: 1067,
    })
  })

  it('returns an empty result for non-array fields', () => {
    expect(resolveEntryFieldItems('not-an-array')).toEqual({
      items: [],
      totalItems: 0,
    })
  })

  it('selects stable item IDs before direction and pagination', () => {
    const firstOrder = [
      { id: 'feature-0', label: 'First' },
      { id: 'feature-1', label: 'Second' },
    ]
    const reordered = [...firstOrder].reverse()
    const options = { itemId: 'feature-0', direction: 'desc' as const, limit: 1 }

    const first = resolveEntryFieldItems(firstOrder, options)
    const afterReorder = resolveEntryFieldItems(reordered, options)

    expect(first.totalItems).toBe(1)
    expect(first.items.map((item) => item.id)).toEqual(['feature-0'])
    expect(afterReorder.items.map((item) => item.id)).toEqual(['feature-0'])
    expect(afterReorder.items[0]?.fields.label).toBe('First')
    expect(resolveEntryFieldItems(reordered, { ...options, offset: 1 })).toEqual({ items: [], totalItems: 1 })
  })

  it('matches string and media-reference identities as well as object IDs', () => {
    const strings = resolveEntryFieldItems(['media-1', 'plain-value'], { itemId: 'plain-value' })
    expect(strings.items.map((item) => item.id)).toEqual(['plain-value'])
    expect(strings.items[0]?.fields.value).toBe('plain-value')

    const objects = resolveEntryFieldItems([{ id: 'feature-1', caption: 'Selected' }], { itemId: 'feature-1' })
    expect(objects.items[0]?.fields.caption).toBe('Selected')

    const media = resolveEntryFieldItems(['media-1'], {
      itemId: 'media-1',
      mediaByReference: new Map([['media-1', { publicPath: '/uploads/photo.webp' }]]),
    })
    expect(media.items[0]?.fields.src).toBe('/uploads/photo.webp')

    const scalar = resolveEntryFieldItems([10, 20], { itemId: 'entry-item-1' })
    expect(scalar.items.map((item) => item.id)).toEqual(['entry-item-1'])
    expect(scalar.items[0]?.fields.value).toBe(20)
  })

  it('returns no items for a missing identity and validates authored itemId values', () => {
    expect(resolveEntryFieldItems([{ id: 'feature-0' }], { itemId: 'missing' })).toEqual({ items: [], totalItems: 0 })
    expect(readEntryFieldItemIdFilter(undefined, 'filters.itemId')).toBeUndefined()
    expect(readEntryFieldItemIdFilter('', 'filters.itemId')).toBe('')

    let error: unknown
    try { readEntryFieldItemIdFilter(42, 'nodes.loop.props.filters.itemId') } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(LoopQueryConfigurationError)
    if (error instanceof LoopQueryConfigurationError) expect(error.path).toBe('nodes.loop.props.filters.itemId')
  })
})
