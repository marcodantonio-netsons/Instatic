import { describe, expect, it } from 'bun:test'
import '@modules/base'
import { registry } from '@core/module-engine'
import { classNamesForClassIds, StyleRuleSchema, type PageNode } from '@core/page-tree'
import { publishPage } from '@core/publisher'
import { normalizeHtmlAttributes } from '@core/htmlAttributes'
import { Type, parseValue } from '@core/utils/typeboxHelpers'
import { applyIframeBodyPresentation } from '@site/canvas/iframeBodyPresentation'
import { composeDocumentBody, composeTemplateChain, resolveDynamicProps } from '@core/templates'
import { makeNode, makePage, makeSite } from '../fixtures'

const body = (id: string, props: PageNode['props'] = {}, extra: Partial<PageNode> = {}): PageNode => ({ ...makeNode({ id, moduleId: 'base.body', props }), ...extra })
function template(id: string, root: PageNode) {
  return makePage({ id, slug: id, rootNodeId: root.id, nodes: {
    [root.id]: { ...root, children: [id + '-outlet'] },
    [id + '-outlet']: makeNode({ id: id + '-outlet', moduleId: 'base.outlet' }),
  }, template: { enabled: true, target: { kind: 'everywhere' }, priority: 0 } })
}

describe('document body composition', () => {
  it('merges nested document presentation while preserving one outer structural identity', () => {
    const outer = body('outer', { htmlAttributes: { ID: 'shell', DIR: 'ltr', 'data-layout': 'global' }, background: 'white' }, {
      children: ['outer-child'], classIds: ['shell', 'shared'], inlineStyles: { color: 'black', backgroundColor: 'white' },
      breakpointOverrides: { mobile: { width: '100%', htmlAttributes: { title: 'outer' } } },
    })
    const inner = body('inner', { htmlAttributes: { id: 'section', 'data-section': 'news' } }, {
      classIds: ['shared', 'section'], inlineStyles: { color: 'navy' },
      breakpointOverrides: { mobile: { height: 'auto', htmlAttributes: { lang: 'de' } } },
    })
    const page = body('page', { htmlAttributes: { id: 'article', lang: 'ar', dir: 'rtl' }, background: 'blue' }, {
      classIds: ['article', 'shell'], inlineStyles: { backgroundColor: 'blue' },
      breakpointOverrides: { mobile: { width: '80%', htmlAttributes: { title: 'page' } } },
    })
    const before = structuredClone([outer, inner, page])
    const merged = composeDocumentBody([outer, inner, page])
    expect(merged.id).toBe('outer')
    expect(merged.moduleId).toBe('base.body')
    expect(merged.children).toEqual(['outer-child'])
    expect(merged.classIds).toEqual(['shell', 'shared', 'section', 'article'])
    expect(merged.inlineStyles).toEqual({ color: 'navy', backgroundColor: 'blue' })
    expect(merged.props).toEqual({ background: 'blue', htmlAttributes: { id: 'article', lang: 'ar', dir: 'rtl', 'data-layout': 'global', 'data-section': 'news' } })
    expect(merged.breakpointOverrides.mobile).toEqual({ width: '80%', height: 'auto', htmlAttributes: { title: 'page', lang: 'de' } })
    expect([outer, inner, page]).toEqual(before)
  })

  it('keeps class-only bodies and splices nested Everywhere content without wrapper elements', () => {
    const outer = template('outer', body('outer-body', {}, { classIds: ['shell'] }))
    const inner = template('inner', body('inner-body', {}, { classIds: ['section', 'shell'] }))
    const page = makePage({ id: 'article', nodes: {
      root: body('root', {}, { classIds: ['article'], children: ['content'] }),
      content: makeNode({ id: 'content', moduleId: 'base.text', props: { tag: 'h1', text: 'Article' } }),
    } })
    const before = structuredClone([outer, inner, page])
    const merged = composeTemplateChain([outer, inner], { kind: 'page', page })
    expect(merged.nodes[merged.rootNodeId].classIds).toEqual(['shell', 'section', 'article'])
    expect(Object.values(merged.nodes).map(node => node.moduleId).sort()).toEqual(['base.body', 'base.text'])
    expect(Object.keys(merged.nodes).some(id => id.endsWith('bodyprops'))).toBe(false)
    expect([outer, inner, page]).toEqual(before)
  })

  it('uses the innermost entry template presentation when there is no terminal Page', () => {
    const outer = template('outer', body('outer-body', { htmlAttributes: { lang: 'it', 'data-layout': 'global' } }, { classIds: ['shell'] }))
    const inner = template('inner', body('inner-body', { htmlAttributes: { lang: 'en' } }, { classIds: ['entry'] }))
    const merged = composeTemplateChain([outer, inner], { kind: 'entry' })
    expect(merged.nodes[merged.rootNodeId].props.htmlAttributes).toEqual({ lang: 'en', 'data-layout': 'global' })
    expect(merged.nodes[merged.rootNodeId].classIds).toEqual(['shell', 'entry'])
    expect(Object.values(merged.nodes).filter(node => node.moduleId === 'base.outlet')).toHaveLength(1)
    expect(Object.values(merged.nodes).filter(node => node.moduleId === 'base.body')).toHaveLength(1)
  })

  it('lets authored inner fields replace outer whole-prop bindings and retains unrelated bindings', () => {
    const outer = body('outer', { htmlAttributes: { lang: 'it' }, title: 'default' }, { dynamicBindings: {
      htmlAttributes: { source: 'site', field: 'settings.bodyAttributes' }, title: { source: 'page', field: 'title' },
    } })
    const inner = body('inner', { htmlAttributes: { lang: '{page.language}' } }, { dynamicBindings: {
      role: { source: 'page', field: 'slug' },
    } })
    const merged = composeDocumentBody([outer, inner])
    expect(merged.dynamicBindings?.htmlAttributes).toBeUndefined()
    expect(merged.dynamicBindings?.title).toEqual(outer.dynamicBindings?.title)
    const resolved = resolveDynamicProps(merged.props, merged.dynamicBindings, { entryStack: [], page: { id: 'p', title: 'Article', slug: 'article', permalink: '/article', language: 'en', isTemplate: false, templateTableSlug: null, parentSlug: null } })
    expect(resolved.htmlAttributes).toEqual({ lang: 'en' })
    expect(resolved.title).toBe('Article')
    expect(resolved.role).toBe('article')
  })

  it('puts the same merged class/style/locale attributes on published and canvas bodies', () => {
    const shell = template('chrome', body('chrome-body', { htmlAttributes: { dir: 'ltr', 'data-shell': 'global' } }, { classIds: ['shell'], inlineStyles: { color: 'black' } }))
    const page = makePage({ id: 'page', language: 'en', nodes: {
      root: body('root', { htmlAttributes: { lang: '{site.language}', id: 'article', dir: 'rtl' } }, { classIds: ['team'], inlineStyles: { color: 'navy' }, children: ['main'] }),
      main: makeNode({ id: 'main', moduleId: 'base.container', props: { tag: 'main' }, children: ['text'] }),
      text: makeNode({ id: 'text', moduleId: 'base.text', props: { tag: 'h1', text: 'Team' } }),
    } })
    const rule = (id: string) => parseValue(StyleRuleSchema, { id, name: id, kind: 'class', selector: '.' + id, styles: {}, contextStyles: {}, order: 0, createdAt: 0, updatedAt: 0 })
    const site = makeSite({ pages: [page, shell], styleRules: { shell: rule('shell'), team: rule('team') } })
    const composed = composeTemplateChain([shell], { kind: 'page', page })
    const html = publishPage(composed, site, registry).html
    const published = new DOMParser().parseFromString(html, 'text/html')
    expect(published.querySelectorAll('body')).toHaveLength(1)
    expect(published.querySelector('body > main > h1')?.textContent).toBe('Team')
    expect(published.body.className).toBe('shell team')
    const canvasBody = composeDocumentBody([shell.nodes[shell.rootNodeId], page.nodes[page.rootNodeId]])
    const props = resolveDynamicProps(canvasBody.props, canvasBody.dynamicBindings, { entryStack: [], site: { id: site.id, name: site.name, language: 'en' } })
    const canvas = document.implementation.createHTMLDocument('Canvas')
    const restore = applyIframeBodyPresentation(canvas.body, {
      className: classNamesForClassIds(site.styleRules, canvasBody.classIds).join(' '),
      style: parseValue(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()])), canvasBody.inlineStyles),
      attributes: normalizeHtmlAttributes(props.htmlAttributes),
    })
    for (const attribute of ['class', 'id', 'lang', 'dir', 'data-shell']) expect(canvas.body.getAttribute(attribute)).toBe(published.body.getAttribute(attribute))
    expect(canvas.body.style.color).toBe(published.body.style.color)
    restore()
    expect(canvas.body.className).toBe('')
    expect(canvas.body.getAttribute('lang')).toBeNull()
  })
})
