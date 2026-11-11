import { describe, expect, it } from 'bun:test'
import { renderPageMetadata } from './index'

const context = { siteId: 'netsons', pageId: 'about-en', slug: 'en/about' }
const entry = {
  id: 'seo-about-en', tableSlug: 'netsons-pages',
  cells: {
    pageId: context.pageId, slug: context.slug, language: 'en',
    title: 'About & services', description: 'Hosting < Cloud', canonical: 'https://www.netsons.com/en/about',
    groupId: 'about',
    meta: [], links: [], structuredData: '[{"@type":"WebPage","name":"A < B"}]',
  },
}
const group = {
  id: 'seo-group-about', tableSlug: 'netsons-page-groups',
  cells: {
    groupId: 'about',
    alternates: [{ id: 'it', cells: { language: 'it', href: 'https://www.netsons.com/azienda' } }],
    languageRoutes: [{ id: 'it', cells: { language: 'it', path: '/azienda' } }],
  },
}

describe('CMS metadata publication boundary', () => {
  it('combines CMS metadata and language routes without changing body content or runtime assets', () => {
    const html = '<!DOCTYPE html><html lang="it"><head><title>Native title</title><meta name="description" content="Native description"><script src="/runtime.js"></script></head><body><h1>Page content</h1><a data-netsons-language-link="it">Italiano</a></body></html>'
    const result = renderPageMetadata(html, entry, group, context)
    expect(result).toContain('<html lang="en">')
    expect(result).toContain('<title>About &amp; services</title>')
    expect(result).toContain('content="Hosting &lt; Cloud"')
    expect(result).toContain('href="/azienda"')
    expect(result).toContain('<script src="/runtime.js"></script>')
    expect(result).toContain('<h1>Page content</h1>')
    expect(result).toContain('"name":"A \\u003c B"')
  })

  it('rejects missing records, foreign tables and mismatched page identities', () => {
    expect(() => renderPageMetadata('', null, group, context)).toThrow('metadata')
    expect(() => renderPageMetadata('', { ...entry, tableSlug: 'pages' }, group, context)).toThrow('metadata')
    expect(() => renderPageMetadata('', entry, group, { ...context, pageId: 'other' })).toThrow('match')
    expect(() => renderPageMetadata('', entry, group, { ...context, slug: 'wrong/path' })).toThrow('match')
    expect(() => renderPageMetadata('', entry, null, context)).toThrow('language group')
    expect(() => renderPageMetadata('', entry, { ...group, cells: { ...group.cells, groupId: 'wrong' } }, context)).toThrow('match')
  })

  it('rejects malformed and non-object JSON-LD instead of publishing incomplete metadata', () => {
    for (const structuredData of ['{', '[null]', '[42]']) {
      expect(() => renderPageMetadata('', { ...entry, cells: { ...entry.cells, structuredData } }, group, context)).toThrow('JSON-LD')
    }
  })
})
