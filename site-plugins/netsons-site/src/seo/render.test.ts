import { describe, expect, it } from 'bun:test'
import { translate } from '../localization'
import { catalogueKeyIndexes } from '../localization/generatedCatalogues'
import { escapeHtml } from '../shared/htmlSafety'
import { renderSeoHtml } from './render'
import type { SeoRecord } from './schema'

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self'">`
const CSP_REPORT_ONLY = `<meta http-equiv="Content-Security-Policy-Report-Only" content="default-src 'none'; report-uri /csp-report">`
const RUNTIME = `<script src="/runtime.js" defer></script>`
const STYLES = `<link rel="stylesheet" href="/site.css"><style>body{color:#123}</style>`
const BASE_HTML = `<!doctype html><html lang="en"><head>${CSP}${CSP_REPORT_ONLY}<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Old &amp; title</title><title>Duplicate title</title><meta name="description" content="Old description"><meta name="description" content="Duplicate description"><meta property="og:title" content="Old social title"><link rel="canonical" href="/old"><link rel="canonical" href="/old-duplicate"><link rel="alternate" hreflang="en" href="/old-en"><link rel="alternate" hreflang="fr" href="/old-fr"><link rel="icon" href="/favicon.ico">${STYLES}${RUNTIME}<script type="application/ld+json">{"old":true}</script><script type="application/ld+json">{"old":false}</script></head><body><main>Keep this body &amp; entity.</main></body></html>`

function record(overrides: Partial<SeoRecord> = {}): SeoRecord {
  return {
    pageId: 'page-42',
    slug: '/en/products/example',
    language: 'en',
    alternates: [],
    meta: [],
    links: [],
    structuredData: [],
    ...overrides,
  }
}

describe('renderSeoHtml', () => {
  it('preserves embedded newlines in titles and metadata values', () => {
    const output = renderSeoHtml(BASE_HTML, record({
      title: 'First line.\nSecond line.',
      meta: [{ id: 'og-title', attribute: 'property', key: 'og:title', content: 'First line.\nSecond line.' }],
    }))
    expect(output).toContain('<title>First line.\nSecond line.</title>')
    expect(output).toContain('content="First line.\nSecond line."')
    expect(output).not.toContain('First line.\n  Second line.')
  })

  it('preserves repeated Open Graph properties with distinct locale values', () => {
    const output = renderSeoHtml(BASE_HTML, record({
      meta: [
        { id: 'locale-en', attribute: 'property', key: 'og:locale:alternate', content: 'en' },
        { id: 'locale-de', attribute: 'property', key: 'og:locale:alternate', content: 'de' },
      ],
    }))
    expect(output.match(/property="og:locale:alternate"/g)).toHaveLength(2)
    expect(output).toContain('content="en"')
    expect(output).toContain('content="de"')
  })

  it('replaces duplicate SEO fields and preserves unrelated head and document bytes', () => {
    const output = renderSeoHtml(BASE_HTML, record({
      language: 'it',
      title: `Titolo & <prodotto>`,
      description: `Descrizione "nuova" & utile`,
      canonical: '/it/prodotti/example?from=seo&lang=it',
      alternates: [
        { id: 'alt-it', language: 'it', href: '/it/prodotti/example' },
        { id: 'alt-fr', language: 'fr', href: '/fr/produits/example' },
      ],
      meta: [{ id: 'og-title', attribute: 'property', key: 'og:title', content: 'Nuovo & speciale' }],
    }))

    expect(output).toContain('<html lang="it">')
    expect(output).toContain('<title>Titolo &amp; &lt;prodotto&gt;</title>')
    expect(output).toContain('<meta name="description" content="Descrizione &quot;nuova&quot; &amp; utile">')
    expect(output).toContain('<link rel="canonical" href="/it/prodotti/example?from=seo&amp;lang=it">')
    expect(output).toContain('<link rel="alternate" hreflang="fr" href="/fr/produits/example">')
    expect(output).toContain('<meta property="og:title" content="Nuovo &amp; speciale">')
    expect(output).toContain('<link rel="icon" href="/favicon.ico">')
    expect(output).toContain(CSP)
    expect(output).toContain(CSP_REPORT_ONLY)
    expect(output).toContain(STYLES)
    expect(output).toContain(RUNTIME)
    expect(output).toContain('<main>Keep this body &amp; entity.</main>')
    expect(output.match(/<title\b/g)).toHaveLength(1)
    expect(output.match(/name="description"/g)).toHaveLength(1)
    expect(output.match(/rel="canonical"/g)).toHaveLength(1)
    expect(output.match(/type="application\/ld\+json"/g)).toBeNull()
    expect(output).not.toContain('Old social title')
    expect(output).not.toContain('old-duplicate')
  })

  it('clears canonical, custom metadata, passive SEO links, alternates, and JSON-LD for explicit empty values', () => {
    const output = renderSeoHtml(BASE_HTML, record())
    expect(output).toContain('<title>Old &amp; title</title>')
    expect(output).toContain('<meta name="description" content="Old description">')
    expect(output.match(/<title\b/g)).toHaveLength(1)
    expect(output.match(/name="description"/g)).toHaveLength(1)
    expect(output).not.toContain('rel="canonical"')
    expect(output).not.toContain('rel="alternate"')
    expect(output).not.toContain('og:title')
    expect(output).not.toContain('application/ld+json')
    expect(output).toContain('<meta charset="UTF-8">')
    expect(output).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
    expect(output).toContain('<link rel="icon" href="/favicon.ico">')
    expect(output).toContain(CSP)
    expect(renderSeoHtml(output, record())).toBe(output)
  })

  it('replaces authored icon links while keeping non-SEO resources intact', () => {
    const output = renderSeoHtml(BASE_HTML, record({
      links: [{ id: 'brand-icon', rel: 'icon', href: '/brand.ico', sizes: '32x32', type: 'image/x-icon' }],
    }))
    expect(output).not.toContain('/favicon.ico')
    expect(output).toContain('<link rel="icon" href="/brand.ico" type="image/x-icon" sizes="32x32">')
    expect(output).toContain('<link rel="stylesheet" href="/site.css">')
  })

  it('inserts the locale attribute when the source html element has none', () => {
    const source = BASE_HTML.replace('<html lang="en">', '<html class="site">')
    const output = renderSeoHtml(source, record({ language: 'fr', title: '', description: '' }))
    expect(output).toContain('<html class="site" lang="fr">')
    expect(output).toContain('<title>Old &amp; title</title>')
    expect(output).toContain('<meta name="description" content="Old description">')
  })

  it('rejects unsafe and malformed SEO URLs', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'mailto:person@example.test', 'https:/missing-host']) {
      expect(() => renderSeoHtml(BASE_HTML, record({ canonical: value }))).toThrow()
      expect(() => renderSeoHtml(BASE_HTML, record({
        alternates: [{ id: 'alt', language: 'fr', href: value }],
      }))).toThrow()
      expect(() => renderSeoHtml(BASE_HTML, record({
        links: [{ id: 'author', rel: 'author', href: value }],
      }))).toThrow()
    }
  })

  it('keeps JSON-LD data inert when text contains closing-script markup', () => {
    const marker = '</script><script>alert(1)</script>'
    const output = renderSeoHtml(BASE_HTML, record({
      structuredData: [{ '@type': 'Thing', description: marker }],
    }))

    expect(output).toContain('\\u003c/script>\\u003cscript>alert(1)\\u003c/script>')
    expect(output).not.toContain(`${marker}</script>`)
    const json = output.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1]
    expect(json).toBeDefined()
    expect(JSON.parse(json!)).toEqual({ '@type': 'Thing', description: marker })
  })

  it('validates JSON-LD values as finite JSON before rendering', () => {
    expect(() => renderSeoHtml(BASE_HTML, record({ structuredData: [{ score: Number.NaN }] }))).toThrow()
    expect(() => renderSeoHtml(BASE_HTML, record({ structuredData: [{ score: Number.POSITIVE_INFINITY }] }))).toThrow()
  })

  it('localizes the same authored title using the record language', () => {
    const key = Object.keys(catalogueKeyIndexes).find((candidate) => {
      try {
        const italian = translate('it', candidate)
        const french = translate('fr', candidate)
        return italian !== french && !/⟪native_value_\d+⟫/.test(italian) && !/⟪native_value_\d+⟫/.test(french)
      } catch {
        return false
      }
    })
    expect(key).toBeDefined()
    const tokenTitle = `{i18n.${key}}`
    const italian = renderSeoHtml(BASE_HTML, record({ language: 'it', title: tokenTitle }))
    const french = renderSeoHtml(BASE_HTML, record({ language: 'fr', title: tokenTitle }))
    expect(italian).toContain(`<title>${escapeHtml(translate('it', key!))}</title>`)
    expect(french).toContain(`<title>${escapeHtml(translate('fr', key!))}</title>`)
    expect(italian).not.toBe(french)
  })

  it('requires a source-editable document and rejects duplicate array IDs', () => {
    expect(() => renderSeoHtml('<main>fragment</main>', record())).toThrow('explicit <html><head>')
    expect(() => renderSeoHtml(BASE_HTML.replace('<html lang="en">', '<html lang="en" lang="it">'), record()))
      .toThrow('duplicate html lang')
    expect(() => renderSeoHtml(BASE_HTML, record({
      alternates: [
        { id: 'same', language: 'it', href: '/it' },
        { id: 'same', language: 'fr', href: '/fr' },
      ],
    }))).toThrow('item IDs must be unique')
    expect(() => renderSeoHtml(BASE_HTML, record({
      alternates: [
        { id: 'it-one', language: 'it', href: '/it' },
        { id: 'it-two', language: 'IT', href: '/it-two' },
      ],
    }))).toThrow('Duplicate SEO hreflang')
    const repeatedMetadata = renderSeoHtml(BASE_HTML, record({
      meta: [
        { id: 'robots-one', attribute: 'name', key: 'robots', content: 'index' },
        { id: 'robots-two', attribute: 'name', key: 'ROBOTS', content: 'noindex' },
      ],
    }))
    expect(repeatedMetadata).toContain('name="robots" content="index"')
    expect(repeatedMetadata).toContain('name="ROBOTS" content="noindex"')
  })
})

