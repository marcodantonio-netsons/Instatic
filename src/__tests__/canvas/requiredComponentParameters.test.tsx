import { afterEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { CanvasTemplateContext } from '@site/canvas/CanvasContexts'
import { useEditorStore } from '@site/store/store'
import { ReadOnlyNodeTree } from '@modules/base/utils/ReadOnlyNodeTree'
import type { TemplateRenderDataContext } from '@core/templates'
import { makeNode, makePage, makeSite, makeVC, makeVCNode, makeVCTree } from '../fixtures'
import '@modules/base'

afterEach(() => {
  cleanup()
  useEditorStore.setState({ site: null, activePageId: null, activeDocument: null })
})

function fixture(value = '{currentEntry.url}') {
  const vc = makeVC({ id: 'link-card', name: 'Link Card', params: [{
    id: 'url', name: 'URL', type: 'url', defaultValue: value, required: true,
  }], tree: makeVCTree('card-body', [
    makeVCNode({ id: 'card-body', moduleId: 'base.body', children: ['link'] }),
    makeVCNode({ id: 'link', moduleId: 'base.link', props: { text: 'Go' }, propBindings: { href: { paramId: 'url' } } }),
  ]) })
  const page = makePage({ nodes: {
    root: makeNode({ id: 'root', moduleId: 'base.body', children: ['ref'] }),
    ref: makeNode({ id: 'ref', moduleId: 'base.visual-component-ref', props: { componentId: vc.id, propOverrides: {} } }),
  } })
  const site = makeSite({ visualComponents: [vc], pages: [makePage({ id: 'other-page' })] })
  useEditorStore.setState({ site, activePageId: 'other-page', activeDocument: null })
  function View({ context }: { context?: TemplateRenderDataContext }) {
    return <CanvasTemplateContext.Provider value={context}>
      <ReadOnlyNodeTree nodes={page.nodes} rootNodeId={page.rootNodeId} classes={site.styleRules} />
    </CanvasTemplateContext.Provider>
  }
  return { vc, page, site, View }
}

describe('required component argument preview', () => {
  it('reports pending without a real row, missing for a real empty row, and renders a valid row', () => {
    const { View } = fixture()
    const view = render(<View context={{ entryStack: [] }} />)
    expect(screen.getByRole('status').textContent).toContain('Preview waiting for URL')
    expect(screen.queryByRole('link')).toBeNull()
    view.rerender(<View context={{ entryStack: [{ id: 'empty', fields: { url: '' } }] }} />)
    expect(screen.getByRole('alert').textContent).toContain('has no value')
    view.rerender(<View context={{ entryStack: [{ id: 'real', fields: { url: '/actual' } }] }} />)
    expect(screen.getByRole('link').getAttribute('href')).toBe('/actual')
  })

  it('keeps draft values intact while an explicit override is missing', () => {
    const { page, View } = fixture('/default')
    page.nodes.ref.props.propOverrides = { url: '' }
    const view = render(<View />)
    expect(screen.getByRole('alert').textContent).toContain('URL')
    expect(page.nodes.ref.props.propOverrides).toEqual({ url: '' })
    page.nodes.ref = { ...page.nodes.ref, props: { ...page.nodes.ref.props, propOverrides: { url: '/authored' } } }
    view.rerender(<View />)
    expect(screen.getByRole('link').getAttribute('href')).toBe('/authored')
  })

  it('shows a concrete missing argument before a different argument waiting for data', () => {
    const { vc, page, View } = fixture('/default')
    vc.params.unshift({ id: 'title', name: 'Title', type: 'string', defaultValue: '{currentEntry.title}', required: true })
    page.nodes.ref.props.propOverrides = { url: '' }
    const view = render(<View context={{ entryStack: [] }} />)
    expect(screen.getByRole('alert').textContent).toContain('parameter "URL"')
    expect(screen.queryByRole('status')).toBeNull()
    page.nodes.ref.props.propOverrides = { url: '/authored' }
    view.rerender(<View context={{ entryStack: [] }} />)
    expect(screen.getByRole('status').textContent).toContain('Preview waiting for Title')
  })

  it('uses materialized slot nodes and each real loop context rather than the active document', () => {
    const { page, site, View } = fixture('{currentEntry.permalink}#{parentEntry.slug}')
    const wrapper = makeVC({ id: 'wrapper', name: 'Wrapper', params: [{
      id: 'content', name: 'children', type: 'slot', required: true, defaultValue: [],
    }], tree: makeVCTree('wrapper-body', [
      makeVCNode({ id: 'wrapper-body', moduleId: 'base.body', children: ['outlet'] }),
      makeVCNode({ id: 'outlet', moduleId: 'base.slot-outlet', props: { slotName: 'children' } }),
    ]) })
    site.visualComponents.push(wrapper)
    site.pages = [makePage({ id: 'a', slug: 'a' }), makePage({ id: 'b', slug: 'b' })]
    useEditorStore.setState({ site })
    page.nodes.root.children = ['loop']
    page.nodes.loop = makeNode({ id: 'loop', moduleId: 'base.loop', props: { sourceId: 'site.pages', orderBy: 'slug', direction: 'asc' }, children: ['wrapper-ref'] })
    page.nodes['wrapper-ref'] = makeNode({ id: 'wrapper-ref', moduleId: 'base.visual-component-ref', props: { componentId: wrapper.id }, children: ['fill'] })
    page.nodes.fill = makeNode({ id: 'fill', moduleId: 'base.slot-instance', props: { slotName: 'children' }, children: ['ref'] })
    const context = { entryStack: [{ id: 'parent', fields: { slug: 'parent' } }] }
    render(<View context={context} />)
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/a#parent', '/b#parent'])
    act(() => useEditorStore.setState({ site: { ...site, pages: [] } }))
    expect(screen.queryByRole('link')).toBeNull()
    expect(document.querySelector('[data-component-parameter]')).toBeNull()
  })
})
