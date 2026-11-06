import { describe, expect, it } from 'bun:test'
import { LoopQueryConfigurationError, resolveEntryFieldItems } from '@core/loops'
import { selectEntryFieldPreviewItems } from '@site/canvas/useLoopPreviewItems'

describe('entry.field canvas preview selection', () => {
  it('uses the shared identity filter and projection after collection reorder', () => {
    const gallery = [
      { id: 'feature-1', caption: 'Other feature' },
      { id: 'feature-0', caption: 'Selected feature' },
    ]
    const filters = { fieldId: 'gallery', itemId: 'feature-0' }
    const options = { direction: 'desc' as const, offset: 0, limit: 1 }
    const canvas = selectEntryFieldPreviewItems(gallery, filters, options, 'nodes.gallery-loop.props.filters.itemId')
    const publisherProjection = resolveEntryFieldItems(gallery, { ...options, itemId: 'feature-0' })

    expect(canvas).toEqual(publisherProjection.items)
    expect(canvas).toHaveLength(1)
    expect(canvas[0]?.id).toBe('feature-0')
    expect(canvas[0]?.fields.caption).toBe('Selected feature')
    expect(selectEntryFieldPreviewItems(gallery, { ...filters, itemId: 'missing' }, options, 'filters.itemId')).toEqual([])
  })

  it('raises a native configuration error for a non-string authored item ID', () => {
    let error: unknown
    try {
      selectEntryFieldPreviewItems([], { fieldId: 'gallery', itemId: 7 }, {}, 'nodes.gallery-loop.props.filters.itemId')
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(LoopQueryConfigurationError)
    if (error instanceof LoopQueryConfigurationError) expect(error.path).toBe('nodes.gallery-loop.props.filters.itemId')
  })
})
