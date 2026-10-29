import { describe, expect, it } from 'bun:test'
import { cloneNodeWithRemap, duplicateNode, remapNodeReferenceProps } from '@core/page-tree'
import { makeNode, makePage } from '../fixtures'

describe('native tree-node reference remapping', () => {
  it('remaps only declared references, preserving list whitespace and unrelated identifier namespaces', () => {
    const map = new Map([['loop', 'new-loop'], ['other', 'new-other']])
    const props = { loopIds: ' loop\tother  external ', text: 'loop', formId: 'loop', htmlAttributes: { id: 'loop', 'aria-controls': 'loop' } }
    const before = structuredClone(props)
    expect(remapNodeReferenceProps('base.loop-count', props, map)).toEqual({ ...props, loopIds: ' new-loop\tnew-other  external ' })
    expect(remapNodeReferenceProps('base.loop-conditional', props, map).loopIds).toBe(' new-loop\tnew-other  external ')
    expect(remapNodeReferenceProps('base.loop-more', { loopId: 'loop' }, map).loopId).toBe('new-loop')
    expect(remapNodeReferenceProps('custom.unrelated', props, map)).toEqual(before)
    expect(props).toEqual(before)
  })

  it('uses the same reference map for clones, breakpoint overrides and complete subtree duplication', () => {
    const page = makePage({ nodes: {
      root: makeNode({ id: 'root', moduleId: 'base.body', children: ['group'] }),
      group: makeNode({ id: 'group', moduleId: 'base.container', children: ['loop', 'count', 'more'] }),
      loop: makeNode({ id: 'loop', moduleId: 'base.loop' }),
      count: makeNode({ id: 'count', moduleId: 'base.loop-count', props: { loopIds: 'loop external' }, breakpointOverrides: { mobile: { loopIds: 'loop' } } }),
      more: makeNode({ id: 'more', moduleId: 'base.loop-more', props: { loopId: 'loop' } }),
    } })
    const original = structuredClone(page.nodes.count), map = new Map([['group', 'group-copy'], ['loop', 'loop-copy'], ['count', 'count-copy'], ['more', 'more-copy']])
    const clone = cloneNodeWithRemap(page.nodes.count, { newId: 'count-copy', idMap: map })
    expect(clone.props.loopIds).toBe('loop-copy external')
    expect(clone.breakpointOverrides.mobile.loopIds).toBe('loop-copy')
    expect(page.nodes.count).toEqual(original)
    duplicateNode(page, 'group', { nodeIdMap: map })
    expect(page.nodes['count-copy'].props.loopIds).toBe('loop-copy external')
    expect(page.nodes['more-copy'].props.loopId).toBe('loop-copy')
    expect(page.nodes['count-copy'].breakpointOverrides.mobile.loopIds).toBe('loop-copy')
    expect(page.nodes.count).toEqual(original)
  })
})
