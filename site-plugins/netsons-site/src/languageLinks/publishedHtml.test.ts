import { describe, expect, it } from 'bun:test'
import { renderLanguageLinks } from './publishedHtml'

describe('CMS page language destinations', () => {
  it('resolves shared header and footer links against the consuming page, preserving authored HTML', () => {
    const html = '<html><head><script src="/runtime.js"></script></head><body><header><a class="nav" data-netsons-language-link="fr" target="_self">Français</a></header><footer><a href="/old" data-netsons-language-link="fr">FR</a></footer></body></html>'
    const result = renderLanguageLinks(html, [{ language: 'fr', path: '/fr/aide?x=1&y=2' }])
    expect(result).toContain('class="nav" href="/fr/aide?x=1&amp;y=2" target="_self">Français</a>')
    expect(result.match(/href="\/fr\/aide/g)).toHaveLength(2)
    expect(result).not.toContain('href="/old"')
    expect(result).not.toContain('data-netsons-language-link')
    expect(result).toContain('<script src="/runtime.js"></script>')
    expect(renderLanguageLinks(result, [{ language: 'fr', path: '/fr/aide' }])).toBe(result)
  })

  it('fails publication for missing, duplicate or non-local destinations', () => {
    const html = '<a data-netsons-language-link="en">English</a>'
    expect(() => renderLanguageLinks(html, [])).toThrow('Missing page language route')
    expect(() => renderLanguageLinks(html, [{ language: 'en', path: '/en' }, { language: 'en', path: '/other' }])).toThrow('Duplicate')
    for (const path of ['https://other.invalid/', '//other.invalid/', '/\\other.invalid/', 'javascript:alert(1)', '/bad\npath']) {
      expect(() => renderLanguageLinks(html, [{ language: 'en', path }])).toThrow()
    }
  })
})
