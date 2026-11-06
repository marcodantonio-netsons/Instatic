/**
 * dynamicBindingControl.test.tsx
 *
 * Integration tests for DynamicBindingControl via PropertiesPanel.
 * Uses globalThis.fetch to mock the DataMeta endpoint so the picker dialog
 * can load the table/field catalog.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PropertiesPanel } from '@site/panels/PropertiesPanel/PropertiesPanel'
import { DynamicBindingControl } from '@site/property-controls/DynamicBindingControl'
import { clearDataMetaCache } from '@admin/shared/DataBindingPicker/cache'
import { useEditorStore } from '@site/store/store'
import { LoopModule } from '@modules/base/loop'
import { makeNode, makePage, makeSite, makeVC, makeVCNode, makeVCTree } from '../fixtures'
import type { DynamicPropBinding } from '@core/page-tree'
import '@modules/base/index'

// ---------------------------------------------------------------------------
// Fixture DataMeta
// ---------------------------------------------------------------------------

const postsTable = {
  id: 'posts-id',
  slug: 'posts',
  name: 'Posts',
  kind: 'postType',
  singularLabel: 'Post',
  pluralLabel: 'Posts',
  primaryFieldId: 'title',
  routable: true,
  versioned: true,
  fields: [
    { id: 'title', label: 'Title', type: 'text' },
    { id: 'price', label: 'Price', type: 'number' },
    { id: 'authorName', label: 'Author name', type: 'text' },
    { id: 'slug', label: 'Slug', type: 'text' },
    { id: 'body', label: 'Body', type: 'richText' },
    { id: 'featuredMedia', label: 'Featured media', type: 'media', mediaKind: 'image' },
    { id: 'firstImage', label: 'First image', type: 'media', mediaKind: 'image' },
    { id: 'seoTitle', label: 'SEO title', type: 'text' },
    { id: 'seoDescription', label: 'SEO description', type: 'longText' },
  ],
}

const productsTable = {
  id: 'products-id',
  slug: 'products',
  name: 'Products',
  kind: 'data',
  singularLabel: 'Product',
  pluralLabel: 'Products',
  primaryFieldId: 'name',
  routable: false,
  versioned: false,
  fields: [
    { id: 'name', label: 'Name', type: 'text' },
    { id: 'price', label: 'Price', type: 'number' },
  ],
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch

function resetStore() {
  localStorage.clear()
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeBreakpointId: 'desktop',
    activeClassId: null,
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 360 },
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

function loadTemplateWithTextNode() {
  const root = makeNode({ id: 'root', moduleId: 'base.body', children: ['text-1'] })
  const text = makeNode({
    id: 'text-1',
    moduleId: 'base.text',
    props: { text: 'Static fallback', tag: 'p' },
  })
  const page = makePage({
    id: 'page-template',
    title: 'Post Template',
    slug: 'post-template',
    rootNodeId: 'root',
    nodes: { root, 'text-1': text },
    template: {
      enabled: true,
      target: { kind: 'postTypes', tableSlugs: ['posts'] },
      priority: 100,
    },
  })

  useEditorStore.setState({
    site: makeSite({ pages: [page] }),
    activePageId: page.id,
    selectedNodeId: 'text-1',
  } as Parameters<typeof useEditorStore.setState>[0])
}

function loadVisualComponentLoopWithTextNode() {
  const text = makeVCNode({
    id: 'vc-price',
    moduleId: 'base.text',
    props: { text: '€', tag: 'span' },
  })
  const loop = makeVCNode({
    id: 'vc-loop',
    moduleId: 'base.loop',
    props: { ...LoopModule.defaults, sourceId: 'data.rows', filters: { tableId: 'products-id' } },
    children: ['vc-price'],
  })
  const root = makeVCNode({ id: 'vc-root', moduleId: 'base.container', children: ['vc-loop'] })
  const visualComponent = makeVC({
    id: 'price-card',
    name: 'Price card',
    tree: makeVCTree('vc-root', [root, loop, text]),
  })
  const hostPage = makePage({ id: 'host-page', slug: 'products' })
  useEditorStore.setState({
    site: makeSite({ pages: [hostPage], visualComponents: [visualComponent] }),
    activePageId: hostPage.id,
    activeDocument: { kind: 'visualComponent', vcId: visualComponent.id },
    selectedNodeId: 'vc-price',
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(() => {
  clearDataMetaCache()
  resetStore()
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes('/data/_meta')) {
      return new Response(
        JSON.stringify({ meta: { tables: [postsTable, productsTable] } }),
        { status: 200 },
      )
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
  }) as typeof fetch
})

afterEach(() => {
  cleanup()
  clearDataMetaCache()
  globalThis.fetch = originalFetch
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dynamic binding controls', () => {
  it('inserts a {currentEntry.field} token into the text prop value on a single click', async () => {
    loadTemplateWithTextNode()
    render(<PropertiesPanel />)

    // String-typed controls (text) use insert mode — the affordance
    // button's aria-label reads "Insert binding for …".
    fireEvent.click(screen.getByRole('button', { name: /insert binding for text/i }))
    await waitFor(() => expect(screen.getByRole('menu', { name: /insert binding for text/i })).toBeDefined())

    // Auto-scoped to Posts — fields shown directly.
    await waitFor(() => expect(screen.getByText('Author name')).toBeDefined())

    // Click "Author name" — the token is inserted on a single click. The
    // popover stays open so multiple tokens can be inserted in one
    // session (no Confirm step).
    const authorNameBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Author name'),
    )
    expect(authorNameBtn).toBeDefined()
    fireEvent.click(authorNameBtn!)

    // The prop's text value now contains a token appended to the
    // original static text. No structured binding is written.
    const node = useEditorStore.getState().site?.pages[0].nodes['text-1']
    expect(node?.props.text).toBe('Static fallback {currentEntry.authorName}')
    expect(node?.dynamicBindings?.text).toBeUndefined()
  })

  it('inserts multiple tokens on successive clicks without re-opening the popover', async () => {
    loadTemplateWithTextNode()
    render(<PropertiesPanel />)

    fireEvent.click(screen.getByRole('button', { name: /insert binding for text/i }))
    await waitFor(() => expect(screen.getByRole('menu', { name: /insert binding for text/i })).toBeDefined())
    await waitFor(() => expect(screen.getByText('Title')).toBeDefined())

    // Click Title — first token inserted, popover stays open.
    const titleBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Title') && !b.textContent?.includes('SEO'),
    )
    fireEvent.click(titleBtn!)

    // Popover is still open — click another field without re-opening.
    expect(screen.getByRole('menu', { name: /insert binding for text/i })).toBeDefined()
    const slugBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.trim() === 'Slug' || b.textContent?.startsWith('Slug'),
    )
    fireEvent.click(slugBtn!)

    // Both tokens were inserted in sequence.
    const node = useEditorStore.getState().site?.pages[0].nodes['text-1']
    expect(node?.props.text).toContain('{currentEntry.title}')
    expect(node?.props.text).toContain('{currentEntry.slug}')
  })

  it('binds a numeric field on a text control and keeps invalid locale drafts out of saved state', async () => {
    loadTemplateWithTextNode()
    render(<PropertiesPanel />)

    fireEvent.click(screen.getByRole('button', { name: /insert binding for text/i }))
    await waitFor(() => expect(screen.getByRole('menu', { name: /insert binding for text/i })).toBeDefined())
    await waitFor(() => expect(screen.getByText('Price')).toBeDefined())
    fireEvent.change(screen.getByRole('combobox', { name: 'Field selection action' }), {
      target: { value: 'binding' },
    })
    await waitFor(() => expect(screen.getByRole('menu', { name: /bind text/i })).toBeDefined())
    const priceField = screen.getAllByRole('button').find((button) => button.textContent?.includes('Price'))
    expect(priceField).toBeDefined()
    fireEvent.click(priceField!)

    expect(screen.queryByLabelText('Minimum fraction digits')).toBeNull()
    fireEvent.change(screen.getByLabelText('Value format'), { target: { value: 'number' } })
    await waitFor(() => expect(
      useEditorStore.getState().site?.pages[0]?.nodes['text-1'].dynamicBindings?.text,
    ).toMatchObject({ source: 'currentEntry', field: 'price', format: 'number' }))
    fireEvent.change(await screen.findByLabelText('Minimum fraction digits'), { target: { value: '2' } })
    fireEvent.change(await screen.findByLabelText('Maximum fraction digits'), { target: { value: '2' } })

    const localeInput = await screen.findByLabelText('Number format locale override')
    fireEvent.change(localeInput, { target: { value: 'en-' } })
    fireEvent.blur(localeInput)
    expect(screen.getByText('Enter a valid BCP 47 locale.')).toBeDefined()
    expect(useEditorStore.getState().site?.pages[0]?.nodes['text-1'].dynamicBindings?.text?.numberFormat?.locale).toBeUndefined()

    fireEvent.change(localeInput, { target: { value: 'it-IT' } })
    fireEvent.blur(localeInput)
    await waitFor(() => expect(
      useEditorStore.getState().site?.pages[0]?.nodes['text-1'].dynamicBindings?.text?.numberFormat,
    ).toMatchObject({ minimumFractionDigits: 2, maximumFractionDigits: 2, locale: 'it-IT' }))

    const templateKeyInput = screen.getByLabelText('Number format language template key')
    fireEvent.change(templateKeyInput, { target: { value: 'pricing.monthly' } })
    fireEvent.blur(templateKeyInput)
    await waitFor(() => expect(
      useEditorStore.getState().site?.pages[0]?.nodes['text-1'].dynamicBindings?.text?.numberFormat,
    ).toMatchObject({ templateKey: 'pricing.monthly' }))
  })

  it('authors a scoped numeric binding inside a VC-owned data loop', async () => {
    loadVisualComponentLoopWithTextNode()
    render(<PropertiesPanel />)

    fireEvent.click(screen.getByRole('button', { name: /insert binding for text/i }))
    await waitFor(() => expect(screen.getByRole('menu', { name: /insert binding for text/i })).toBeDefined())
    await waitFor(() => expect(screen.getByText(/Products fields/i)).toBeDefined())
    fireEvent.change(screen.getByRole('combobox', { name: 'Field selection action' }), {
      target: { value: 'binding' },
    })
    await waitFor(() => expect(screen.getByRole('menu', { name: /bind text/i })).toBeDefined())
    const priceField = screen.getAllByRole('button').find((button) => button.textContent?.includes('Price'))
    expect(priceField).toBeDefined()
    fireEvent.click(priceField!)

    fireEvent.change(screen.getByLabelText('Value format'), { target: { value: 'number' } })
    await waitFor(() => expect(
      useEditorStore.getState().site?.visualComponents[0]?.tree.nodes['vc-price'].dynamicBindings?.text,
    ).toMatchObject({ source: 'currentEntry', field: 'price', format: 'number' }))
    fireEvent.change(await screen.findByLabelText('Maximum fraction digits'), { target: { value: '2' } })
    await waitFor(() => expect(
      useEditorStore.getState().site?.visualComponents[0]?.tree.nodes['vc-price'].dynamicBindings?.text?.numberFormat,
    ).toMatchObject({ maximumFractionDigits: 2 }))
  })

  it('shows only compatible media fields for an image control', async () => {
    // Auto-scope via a posts template page — the picker leads with the
    // table's fields directly. The unscoped popover no longer offers
    // tables, so this test requires a real currentEntry scope.
    loadTemplateWithTextNode()
    let selectedBinding: DynamicPropBinding | undefined
    render(
      <DynamicBindingControl
        propKey="src"
        label="Image"
        control={{ type: 'image', label: 'Image' }}
        onSet={(binding) => { selectedBinding = binding }}
        onClear={() => {}}
      >
        <input aria-label="Image" />
      </DynamicBindingControl>,
    )

    fireEvent.click(screen.getByRole('button', { name: /bind image/i }))
    await waitFor(() => expect(screen.getByRole('menu', { name: /bind image/i })).toBeDefined())

    // Auto-scoped — fields appear directly without picking a table.
    await waitFor(() => expect(screen.getByText('Featured media')).toBeDefined())

    // Text fields are not valid image sources, so they are not shown.
    expect(screen.queryByText('Title')).toBeNull()

    // Featured media (mediaKind: 'image') should be visible and enabled.
    const featuredBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.includes('Featured media'),
    )
    expect(featuredBtn?.getAttribute('aria-disabled')).not.toBe('true')

    // Click featured media — bind mode commits the binding on a single
    // click. No Confirm step.
    fireEvent.click(featuredBtn!)

    expect(selectedBinding).toMatchObject({
      source: 'currentEntry',
      field: 'featuredMedia',
      format: 'media',
    })
  })
})
