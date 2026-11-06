import { describe, expect, it } from 'bun:test'
import * as Y from 'yjs'
import '@modules/base'
import { registry } from '@core/module-engine'
import { assertSiteTranslations, findDynamicNodeIds, publishPage } from '@core/publisher'
import { canonicalLanguage, LocalizationError, resolveSiteLanguage } from '@core/localization'
import { buildPageFrame, buildSiteFrame } from '@core/templates/contextFrames'
import { interpolateTokens } from '@core/templates/tokenInterpolation'
import { resolveDynamicProps } from '@core/templates/dynamicBindings'
import { composeTemplateChain } from '@core/templates'
import { pageFromRow, pageToCells } from '@core/data/pageFromRow'
import { DataRowSchema } from '@core/data/schemas'
import { Value } from '@core/utils/typeboxHelpers'
import { seedPageDoc, projectPageDoc, seedSiteDoc, projectSiteDoc } from '@core/collab'
import { validatePages, validateSite } from '@core/persistence/validate'
import { duplicatePage } from '@core/page-tree'
import { makeNode, makePage, makeSite, makeVC, makeVCTree } from '../fixtures'

export function languageFixture() {
  const files = ['it', 'en'].map((language) => ({
    id: language, path: `locales/${language}.json`, type: 'config' as const,
    content: JSON.stringify({ language, messages: { header: { contact: language === 'it' ? 'Contatti' : 'Contact & support' } } }),
    createdAt: 0, updatedAt: 0,
  }))
  const page = makePage({ language: 'en', nodes: {
    root: makeNode({ id: 'root', moduleId: 'base.body', children: ['ref'], props: { htmlAttributes: { 'data-language': '{site.language}' } } }),
    ref: makeNode({ id: 'ref', moduleId: 'base.visual-component-ref', props: { componentId: 'header' } }),
  } })
  const component = makeVC({ id: 'header', name: 'Header', tree: makeVCTree('vc-body', [
    makeNode({ id: 'vc-body', moduleId: 'base.body', children: ['label'] }),
    makeNode({ id: 'label', moduleId: 'base.text', props: { text: '{site.translations.header.contact}', tag: 'h2', htmlAttributes: { title: '{site.translations.header.contact}' } } }),
  ]) })
  const site = makeSite({ files, pages: [page], visualComponents: [component], settings: {
    shortcuts: {}, language: 'it', localization: { catalogues: files.map((file) => ({ language: file.id, fileId: file.id })) },
    metaTitle: '{site.translations.header.contact}', metaDescription: '{site.translations.header.contact}',
  } })
  return { site, page, component }
}

describe('language-file static rendering', () => {
  it('renders one reusable native component in two languages without translation runtime or dictionary downloads', () => {
    const { site, page, component } = languageFixture()
    const before = structuredClone(component)
    const english = publishPage(page, site, registry).html
    const italian = publishPage({ ...page, language: 'it' }, site, registry).html
    expect(english).toContain('<html lang="en">')
    expect(english).toContain('<body data-language="en">')
    expect(english).toContain('<h2 title="Contact &amp; support">Contact &amp; support</h2>')
    expect(english).toContain('<title>Contact &amp; support</title>')
    expect(english).toContain('content="Contact &amp; support"')
    expect(italian).toContain('<html lang="it">')
    expect(italian).toContain('<h2 title="Contatti">Contatti</h2>')
    expect(english).not.toContain('locales/')
    expect(english).not.toContain('{site.translations')
    expect(english).not.toContain('<script')
    expect(component).toEqual(before)
    expect(findDynamicNodeIds(page, site, registry).size).toBe(0)
  })

  it('uses the same frame for canvas props and publication, including native VC params', () => {
    const { site, page, component } = languageFixture()
    const frame = buildSiteFrame(site, page.language)
    const canvas = resolveDynamicProps(component.tree.nodes.label.props, undefined, { entryStack: [], site: frame })
    expect(canvas.text).toBe('Contact & support')
    component.params = [{ id: 'label-param', name: 'Label', type: 'string', required: true, defaultValue: '{site.translations.header.contact}' }]
    component.tree.nodes.label.props.text = ''
    component.tree.nodes.label.propBindings = { text: { paramId: 'label-param' } }
    expect(publishPage(page, site, registry).html).toContain('Contact &amp; support</h2>')
    expect(buildPageFrame(page, site).language).toBe('en')
  })

  it('preflights and publishes only effective VC params and overrides on the static path', () => {
    const { site, page, component } = languageFixture()
    component.params = [
      { id: 'label-param', name: 'Label', type: 'string', required: false, defaultValue: '{site.translations.header.missing-default}' },
      { id: 'unused-param', name: 'Unused', type: 'string', required: false, defaultValue: '{site.translations.header.missing-unused-default}' },
    ]
    component.tree.nodes.label!.props.text = '{site.translations.header.missing-definition}'
    component.tree.nodes.label!.propBindings = { text: { paramId: 'label-param' } }
    page.nodes.ref!.props.propOverrides = {
      'label-param': 'Effective label',
      'unused-param': '{site.translations.header.missing-unused-override}',
    }

    expect(() => assertSiteTranslations(site)).not.toThrow()
    expect(findDynamicNodeIds(page, site, registry).size).toBe(0)
    const html = publishPage(page, site, registry).html
    expect(html).toContain('<h2 title="Contact &amp; support">Effective label</h2>')
    expect(html).not.toContain('<instatic-hole')
  })

  it('keeps terminal page language inside an outer template and preserves language on duplication', () => {
    const { site, page } = languageFixture()
    const template = makePage({ id: 'layout', language: 'it', nodes: {
      root: makeNode({ id: 'root', moduleId: 'base.body', children: ['outlet'] }),
      outlet: makeNode({ id: 'outlet', moduleId: 'base.outlet' }),
    }, template: { enabled: true, target: { kind: 'everywhere' }, priority: 0 } })
    const merged = composeTemplateChain([template], { kind: 'page', page })
    expect(merged.language).toBe('en')
    expect(publishPage(merged, site, registry).html).toContain('<html lang="en">')
    expect(duplicatePage(site, page.id, 'Copy').language).toBe('en')
  })

  it('observes immutable native file edits without stale cached translations', () => {
    const { site } = languageFixture()
    expect(resolveSiteLanguage(site, 'en').translations?.header).toEqual({ contact: 'Contact & support' })
    const changed = { ...site, files: site.files.map((file) => file.id === 'en' ? { ...file, content: JSON.stringify({ language: 'en', messages: { header: { contact: 'Speak to us' } } }) } : file) }
    expect(resolveSiteLanguage(changed, 'en').translations?.header).toEqual({ contact: 'Speak to us' })
  })

  it('keeps language files authoritative even when a caller supplies a different cached site frame', () => {
    const { site, page } = languageFixture()
    const html = publishPage(page, site, registry, { templateContext: {
      entryStack: [], site: { id: site.id, name: site.name, language: 'it', translations: { header: { contact: 'Stale copied text' } } },
    } }).html
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('Contact &amp; support</h2>')
    expect(html).not.toContain('Stale copied text')
  })
})

describe('language-file translation templates', () => {
  it('resolves nested translation templates against the active entry context', () => {
    const { site } = languageFixture()
    site.files = site.files.map((file) => file.id === 'en'
      ? { ...file, content: JSON.stringify({ language: 'en', messages: {
        header: { contact: '{site.translations.common.download}' },
        common: { download: 'Download {currentEntry.extension}' },
      } }) }
      : file)
    const context = {
      entryStack: [{ id: 'product-1', fields: { extension: '.zip' } }],
      site: buildSiteFrame(site, 'en'),
    }

    expect(interpolateTokens('{site.translations.header.contact}', context)).toBe('Download .zip')
  })

  it('throws typed errors with the translation path for cycles and excessive nesting', () => {
    const { site } = languageFixture()
    site.files = site.files.map((file) => file.id === 'en'
      ? { ...file, content: JSON.stringify({ language: 'en', messages: {
        header: { contact: '{site.translations.header.contact}' },
      } }) }
      : file)
    const cycleContext = { entryStack: [], site: buildSiteFrame(site, 'en') }
    let cycleError: unknown
    try {
      interpolateTokens('{site.translations.header.contact}', cycleContext)
    } catch (error) {
      cycleError = error
    }
    expect(cycleError).toBeInstanceOf(LocalizationError)
    expect((cycleError as LocalizationError).path).toBe('translations.header.contact')

    const messages: Record<string, { value: string }> = {}
    for (let level = 0; level <= 32; level++) {
      messages[`level${level}`] = {
        value: level === 32 ? 'end' : `{site.translations.level${level + 1}.value}`,
      }
    }
    site.files = site.files.map((file) => file.id === 'en'
      ? { ...file, content: JSON.stringify({ language: 'en', messages }) }
      : file)
    const depthContext = { entryStack: [], site: buildSiteFrame(site, 'en') }
    let depthError: unknown
    try {
      interpolateTokens('{site.translations.level0.value}', depthContext)
    } catch (error) {
      depthError = error
    }
    expect(depthError).toBeInstanceOf(LocalizationError)
    expect((depthError as LocalizationError).path).toBe('translations.level32.value')
  })

  it('keeps escaped tokens literal and inserts arbitrary entry strings only once', () => {
    const { site } = languageFixture()
    site.files = site.files.map((file) => file.id === 'en'
      ? { ...file, content: JSON.stringify({ language: 'en', messages: {
        header: { contact: 'Literal \\{currentEntry.extension}' },
      } }) }
      : file)
    const context = {
      entryStack: [{ id: 'product-1', fields: { extension: '.zip', description: 'Data {currentEntry.extension}' } }],
      site: buildSiteFrame(site, 'en'),
    }

    expect(interpolateTokens('{site.translations.header.contact}', context)).toBe('Literal {currentEntry.extension}')
    expect(interpolateTokens('{currentEntry.description}', context)).toBe('Data {currentEntry.extension}')
  })

  it('renders translation templates through nested attributes and SEO interpolation', () => {
    const { site, page } = languageFixture()
    site.files = site.files.map((file) => file.id === 'en'
      ? { ...file, content: JSON.stringify({ language: 'en', messages: {
        header: { contact: 'Download {currentEntry.extension}' },
      } }) }
      : file)
    page.nodes.root.props.htmlAttributes = {
      ...page.nodes.root.props.htmlAttributes,
      'data-label': '{site.translations.header.contact}',
    }
    site.settings.metaTitle = '{site.translations.header.contact}'
    const html = publishPage(page, site, registry, {
      dynamicNodes: 'inline',
      templateContext: { entryStack: [{ id: 'product-1', fields: { extension: '.zip' } }] },
    }).html

    expect(html).toContain('<body data-label="Download .zip" data-language="en">')
    expect(html).toContain('<h2 title="Download .zip">Download .zip</h2>')
    expect(html).toContain('<title>Download .zip</title>')
  })

  it('classifies translated route-query dependencies for VC overrides and structured Site bindings', () => {
    const { site, page, component } = languageFixture()
    site.files = site.files.map((file) => ({
      ...file,
      content: JSON.stringify({ language: file.id, messages: {
        header: { contact: file.id === 'en' ? 'Contact' : 'Contatti' },
        product: { download: file.id === 'en' ? 'Download {route.query.format}' : 'Scarica' },
      } }),
    }))
    component.params = [{ id: 'label', name: 'Label', type: 'string', required: false, defaultValue: '' }]
    component.tree.nodes.label.propBindings = { text: { paramId: 'label' } }
    page.nodes.ref.props.propOverrides = { label: '{site.translations.product.download}' }
    page.nodes.root.children.push('structured')
    page.nodes.structured = makeNode({ id: 'structured', moduleId: 'base.text', props: { text: '' }, dynamicBindings: {
      text: { source: 'site', field: 'translations.product.download' },
    } })

    page.language = 'it'
    const italianIds = findDynamicNodeIds(page, site, registry)
    expect(italianIds.has('ref')).toBe(false)
    expect(italianIds.has('structured')).toBe(false)

    page.language = 'en'
    const englishIds = findDynamicNodeIds(page, site, registry)
    expect(englishIds.has('ref')).toBe(true)
    expect(englishIds.has('structured')).toBe(true)

    page.language = 'it'
    page.template = { enabled: true, target: { kind: 'postTypes', tableSlugs: ['products'] }, priority: 1 }
    const entryTemplateIds = findDynamicNodeIds(page, site, registry)
    expect(entryTemplateIds.has('ref')).toBe(true)
    expect(entryTemplateIds.has('structured')).toBe(true)

    page.language = 'en'
    const staticHtml = publishPage(page, site, registry).html
    expect(staticHtml).toContain('<instatic-hole')
    expect(staticHtml).not.toContain('Download {route.query.format}')
    const requestHtml = publishPage(page, site, registry, {
      dynamicNodes: 'inline',
      templateContext: {
        entryStack: [],
        route: { path: '/it/listing?format=pdf', slug: 'listing', segments: ['it', 'listing'], query: { format: 'pdf' } },
      },
    }).html
    expect(requestHtml).toContain('<h2 title="Contact">Download pdf</h2>')
    expect(requestHtml).toContain('<p>Download pdf</p>')
  })

  it('classifies request dependencies inside number format language templates', () => {
    const { site, page } = languageFixture()
    site.files = site.files.map((file) => ({
      ...file,
      content: JSON.stringify({ language: file.id, messages: {
        header: { contact: file.id === 'en' ? 'Contact' : 'Contatti' },
        pricing: { monthly: file.id === 'en' ? '€{value} {route.query.currency}' : '{value} €' },
      } }),
    }))
    page.nodes.root.children.push('price')
    page.nodes.price = makeNode({
      id: 'price',
      moduleId: 'base.text',
      props: { text: '' },
      dynamicBindings: {
        text: {
          source: 'currentEntry',
          field: 'price',
          format: 'number',
          numberFormat: { templateKey: 'pricing.monthly' },
        },
      },
    })

    expect(findDynamicNodeIds(page, site, registry).has('price')).toBe(true)
    page.language = 'it'
    expect(findDynamicNodeIds(page, site, registry).has('price')).toBe(false)
  })
})

describe('language catalogue validation', () => {
  it('preflights used number templates and ignores unused component defaults', () => {
    const { site, page, component } = languageFixture()
    site.files = site.files.map((file) => ({
      ...file,
      content: JSON.stringify({ language: file.id, messages: {
        header: { contact: file.id === 'en' ? 'Contact' : 'Contatti' },
        pricing: { monthly: file.id === 'en' ? '€{value}{site.translations.common.suffix}' : '{value} €' },
        common: { suffix: file.id === 'en' ? ' / month' : ' al mese' },
      } }),
    }))
    component.tree.nodes.label.dynamicBindings = {
      text: {
        source: 'currentEntry',
        field: 'price',
        format: 'number',
        numberFormat: { templateKey: 'pricing.monthly' },
      },
    }
    site.visualComponents.push(makeVC({
      id: 'unused-price-card',
      name: 'Unused price card',
      tree: makeVCTree('unused-price', [makeNode({
        id: 'unused-price',
        moduleId: 'base.text',
        props: { text: '' },
        dynamicBindings: {
          text: {
            source: 'currentEntry',
            field: 'price',
            format: 'number',
            numberFormat: { templateKey: 'pricing.unused' },
          },
        },
      })]),
    }))

    expect(() => assertSiteTranslations(site)).not.toThrow()

    site.files = site.files.map((file) => file.id === 'en'
      ? { ...file, content: JSON.stringify({ language: 'en', messages: {
        header: { contact: 'Contact' },
        pricing: { monthly: '€{value}{site.translations.common.suffix}' },
      } }) }
      : file)
    let error: unknown
    try {
      assertSiteTranslations(site)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(LocalizationError)
    expect((error as LocalizationError).path).toBe('translations.common.suffix')

    site.files = site.files.map((file) => file.id === 'en'
      ? { ...file, content: JSON.stringify({ language: 'en', messages: { header: { contact: 'Contact' } } }) }
      : file)
    let missingKeyError: unknown
    try {
      assertSiteTranslations(site)
    } catch (caught) {
      missingKeyError = caught
    }
    expect(missingKeyError).toBeInstanceOf(LocalizationError)
    expect((missingKeyError as LocalizationError).path).toBe('translations.pricing.monthly')
  })

  it('preflights shared defaults, instance params, attributes, structured bindings and SEO using native token syntax', () => {
    const { site, page, component } = languageFixture()
    expect(() => assertSiteTranslations(site)).not.toThrow()
    component.params = [{ id: 'param', name: 'Text', type: 'string', required: true, defaultValue: '{site.translations.header.missing}' }]
    component.tree.nodes.label.propBindings = { text: { paramId: 'param' } }
    expect(() => assertSiteTranslations(site)).toThrow('translations.header.missing')
    component.params = [{ id: 'Text', name: 'Text', type: 'string', required: false, defaultValue: 'safe default' }]
    component.tree.nodes.label.propBindings = { text: { paramId: 'Text' } }
    page.nodes.ref.props.propOverrides = { Text: '{site.translations.header.missing}' }
    expect(() => assertSiteTranslations(site)).toThrow('translations.header.missing')
    delete page.nodes.ref.props.propOverrides
    page.nodes.root.props.htmlAttributes = { title: '{site.translations.header.missing}' }
    expect(() => assertSiteTranslations(site)).toThrow('translations.header.missing')
    page.nodes.root.props.htmlAttributes = {}
    page.nodes.root.dynamicBindings = { title: { source: 'site', field: 'translations.header.missing' } }
    expect(() => assertSiteTranslations(site)).toThrow('translations.header.missing')
    delete page.nodes.root.dynamicBindings
    site.settings.metaTitle = '{site.translations.header.missing}'
    expect(() => assertSiteTranslations(site)).toThrow('translations.header.missing')
    site.settings.metaTitle = '\\{site.translations.header.missing}'
    expect(() => assertSiteTranslations(site)).not.toThrow()
  })

  it('rejects missing keys even when a token or structured binding asks for fallback text', () => {
    const { site } = languageFixture()
    const context = { entryStack: [], site: buildSiteFrame(site, 'en') }
    expect(() => interpolateTokens('{site.translations.header.missing|Fallback}', context)).toThrow(LocalizationError)
    expect(() => resolveDynamicProps({ text: 'Fallback' }, { text: { source: 'site', field: 'translations.header.missing', fallback: 'static' } }, context)).toThrow(LocalizationError)
  })

  it('preflights nested translation keys before publication work begins', () => {
    const { site } = languageFixture()
    site.files = site.files.map((file) => file.id === 'en'
      ? { ...file, content: JSON.stringify({ language: 'en', messages: {
        header: { contact: '{site.translations.product.download}' },
      } }) }
      : file)

    let error: unknown
    try {
      assertSiteTranslations(site)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(LocalizationError)
    expect((error as LocalizationError).path).toBe('translations.product.download')

    site.files = site.files.map((file) => file.id === 'en'
      ? { ...file, content: JSON.stringify({ language: 'en', messages: {
        header: { contact: '{site.translations.header.contact}' },
      } }) }
      : file)
    let cycleError: unknown
    try {
      assertSiteTranslations(site)
    } catch (caught) {
      cycleError = caught
    }
    expect(cycleError).toBeInstanceOf(LocalizationError)
    expect((cycleError as LocalizationError).path).toBe('translations.header.contact')
  })

  it('checks language-specific slot fills without inventing absent paragraphs', () => {
    const { site, page, component } = languageFixture()
    component.tree = makeVCTree('answer', [
      makeNode({ id: 'answer', moduleId: 'base.container', children: ['outlet'] }),
      makeNode({ id: 'outlet', moduleId: 'base.slot-outlet', props: { slotName: 'answer' } }),
    ])
    page.nodes.ref.children = ['slot']
    page.nodes.slot = makeNode({ id: 'slot', moduleId: 'base.slot-instance', props: { slotName: 'answer' }, children: ['first'] })
    page.nodes.first = makeNode({ id: 'first', moduleId: 'base.text', props: { tag: 'p', text: '{site.translations.header.contact}' } })
    const italian = structuredClone(page)
    italian.id = 'italian'
    italian.slug = 'it'
    italian.language = 'it'
    italian.nodes.slot.children.push('second')
    italian.nodes.second = makeNode({ id: 'second', moduleId: 'base.text', props: { tag: 'p', text: '{site.translations.answer.second}' } })
    site.pages.push(italian)
    site.files = site.files.map((file) => file.id === 'it' ? { ...file, content: JSON.stringify({ language: 'it', messages: { header: { contact: 'Contatti' }, answer: { second: 'Secondo paragrafo' } } }) } : file)
    expect(() => assertSiteTranslations(site)).not.toThrow()
    expect(publishPage(italian, site, registry).html).toContain('<p>Secondo paragrafo</p>')
    expect(publishPage(page, site, registry).html).not.toContain('Secondo paragrafo')
    page.nodes.slot.children.push('second')
    page.nodes.second = structuredClone(italian.nodes.second)
    expect(() => assertSiteTranslations(site)).toThrow('Missing translation for "en"')
  })

  it('preflights shared components against the page language', () => {
    const { site } = languageFixture()
    site.files = site.files.map((file) => file.id === 'en' ? { ...file, content: JSON.stringify({ language: 'en', messages: { other: 'Text' } }) } : file)
    expect(() => assertSiteTranslations(site)).toThrow('Missing translation for "en"')
  })

  it('ignores hidden and orphaned translation references while validating reachable nodes', () => {
    const { site, page } = languageFixture()
    page.nodes.root.children.push('hidden')
    page.nodes.hidden = makeNode({ id: 'hidden', moduleId: 'base.text', hidden: true, props: { text: '{site.translations.absent}' } })
    page.nodes.orphan = makeNode({ id: 'orphan', moduleId: 'base.text', props: { text: '{site.translations.absent}' } })
    expect(() => assertSiteTranslations(site)).not.toThrow()
    page.nodes.hidden.hidden = false
    expect(() => assertSiteTranslations(site)).toThrow('translations.absent')
  })

  it('checks template definitions against every configured language', () => {
    const { site, page } = languageFixture()
    site.pages = [{ ...page, language: 'it', template: { enabled: true, target: { kind: 'everywhere' }, priority: 0 } }]
    site.files = site.files.map((file) => file.id === 'en' ? { ...file, content: JSON.stringify({ language: 'en', messages: { other: 'Text' } }) } : file)
    expect(() => assertSiteTranslations(site)).toThrow('Missing translation for "en"')
  })

  for (const [name, content] of Object.entries({
    malformed: '{',
    array: JSON.stringify({ language: 'en', messages: { header: [] } }),
    number: JSON.stringify({ language: 'en', messages: { header: { contact: 3 } } }),
    extraProperty: JSON.stringify({ language: 'en', messages: { header: { contact: 'Text' } }, extra: true }),
    reserved: '{"language":"en","messages":{"header":{"constructor":"Text"}}}',
    empty: JSON.stringify({ language: 'en', messages: { header: { contact: ' ' } } }),
    wrongLanguage: JSON.stringify({ language: 'fr', messages: { header: { contact: 'Text' } } }),
    missingKey: JSON.stringify({ language: 'en', messages: { header: { different: 'Text' } } }),
  })) {
    it(`blocks publication for ${name} language data`, () => {
      const { site, page } = languageFixture()
      site.files = site.files.map((file) => file.id === 'en' ? { ...file, content } : file)
      expect(() => publishPage(page, site, registry)).toThrow(LocalizationError)
    })
  }

  it('rejects unconfigured and duplicate language tags, and accepts canonical BCP-47 tags', () => {
    const { site } = languageFixture()
    expect(() => resolveSiteLanguage(site, 'fr')).toThrow('No language catalogue')
    site.settings.localization!.catalogues.push({ language: 'EN', fileId: 'en' })
    expect(() => resolveSiteLanguage(site, 'en')).toThrow('Duplicate language')
    expect(canonicalLanguage('pt-br')).toBe('pt-BR')
    expect(() => canonicalLanguage('en_US')).toThrow(LocalizationError)
  })

  it('preserves unconfigured sites, including escaped document language values', () => {
    const site = makeSite({ settings: { shortcuts: {}, language: 'en" unsafe' } })
    const page = makePage()
    expect(publishPage(page, site, registry).html).toContain('lang="en&quot; unsafe"')
    expect(resolveSiteLanguage(site).translations).toBeUndefined()
  })

  it('escapes plain translation text at publication rather than inserting translated HTML', () => {
    const { site, page } = languageFixture()
    site.files = site.files.map((file) => ({ ...file, content: JSON.stringify({ language: file.id, messages: { header: { contact: '<script>alert(1)</script>' } } }) }))
    const html = publishPage(page, site, registry).html
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})

describe('language native storage and co-editing', () => {
  it('round-trips explicit language through page cells and collaboration metadata', () => {
    const { page, site } = languageFixture()
    const row = { ...Value.Create(DataRowSchema), id: page.id, tableId: 'pages', slug: page.slug, cells: pageToCells(page) }
    expect(pageFromRow(row).language).toBe('en')
    const doc = new Y.Doc()
    seedPageDoc(doc, page)
    expect(projectPageDoc(doc, page.id).language).toBe('en')
    const shell = new Y.Doc()
    seedSiteDoc(shell, site)
    const projected = projectSiteDoc(shell)
    expect(projected.shell.settings).toEqual(site.settings)
    expect(validatePages(validateSite(site), site.pages, site.visualComponents)[0].language).toBe('en')
  })
})
