import { describe, expect, it } from 'bun:test'
import { PreferenceToggleModule, PreferenceOutputModule } from '@modules/base/preference'
import { BodyModule } from '@modules/base/body'
import { TextModule } from '@modules/base/text'
import { ConditionModule } from '@modules/base/condition'
import { publishPage } from '@core/publisher'
import { DEFAULT_SITE_VISITOR_PREFERENCES } from '@core/visitor-preferences-schema'
import { makePage, makeSite, makeRegistry } from './helpers'

const registry = makeRegistry({ 'base.body': BodyModule, 'base.text': TextModule, 'base.condition': ConditionModule, 'base.preference-toggle': PreferenceToggleModule, 'base.preference-output': PreferenceOutputModule })
const on = { theme: 'alt', motion: 'reduced', media: 'reduced' }, off = { theme: 'default', motion: 'system', media: 'full' }

describe('preference profile publish boundary', () => {
  it('keeps static conditional branches transparent with generic boolean inversion', () => {
    for (const show of [true,false]) {
      const page = makePage({ root: { moduleId: 'base.body', children: ['direct','inverse'] }, direct: { moduleId: 'base.condition', props: { show }, children: ['yes'] }, inverse: { moduleId: 'base.condition', props: { show, invert: true }, children: ['no'] }, yes: { moduleId: 'base.text', props: { tag: 'h2', text: 'Direct branch' } }, no: { moduleId: 'base.text', props: { tag: 'h2', text: 'Inverse branch' } } })
      const html = publishPage(page, makeSite({ pages: [page] }), registry).html
      expect(html).toContain('<body>\n<h2>' + (show ? 'Direct branch' : 'Inverse branch') + '</h2>\n</body>')
      expect(html).not.toContain(show ? 'Inverse branch' : 'Direct branch')
    }
  })

  it('resolves all localized copy before emitting data attributes and preserves exact source tags', () => {
    const files = ['it','en'].map(language => ({ id: language, path: 'locales/'+language+'.json', type: 'config' as const, createdAt: 0, updatedAt: 0, content: JSON.stringify({ language, messages: { label: { on: language === 'it' ? 'Attivo & sicuro' : 'Active & safe', off: language === 'it' ? 'Standard <test>' : 'Standard <safe>' } } }) }))
    const page = makePage({ root: { moduleId: 'base.body', children: ['button','copy'] }, button: { moduleId: 'base.preference-toggle', props: { on, off, labelOn: '{site.translations.label.on}', labelOff: '{site.translations.label.off}', titleOn: '{site.translations.label.on}', titleOff: '{site.translations.label.off}', htmlAttributes: { 'data-instatic-preference-on': '{"theme":"untrusted"}', onclick: 'bad()', 'aria-pressed': 'true', title: 'Untrusted title', 'data-instatic-preference-title-on': 'Untrusted title' } } }, copy: { moduleId: 'base.preference-output', props: { when: on, tag: 'small', textOn: '{site.translations.label.on}', textOff: '{site.translations.label.off}' } } })
    page.language = 'en'
    const site = makeSite({ files, pages: [page], settings: { visitorPreferences: DEFAULT_SITE_VISITOR_PREFERENCES, shortcuts: {}, language: 'it', localization: { catalogues: files.map(file => ({ language: file.id, fileId: file.id })) } } })
    const html = publishPage(page, site, registry).html
    expect(html).toContain('data-instatic-preference-label-on="Active &amp; safe"')
    expect(html).toContain('data-instatic-preference-text-off="Standard &lt;safe&gt;"')
    expect(html).toContain('data-instatic-preference-title-on="Active &amp; safe"')
    expect(html).toContain('title="Standard &lt;safe&gt;"')
    expect(html).not.toContain('Untrusted title')
    expect(html).toContain('<small data-instatic-preference-output=')
    expect(html).not.toContain('{site.translations')
    expect(html).not.toContain('amp;amp;')
    expect(html).not.toContain('untrusted')
    expect(html).not.toContain('onclick=')
    expect(html).not.toContain('locales/')
  })

  it('rejects incomplete accessible labels and mismatched profiles', () => {
    const settings = { visitorPreferences: DEFAULT_SITE_VISITOR_PREFERENCES, shortcuts: {} }
    for (const props of [
      { on, off, labelOn: '', labelOff: '', ariaLabelOn: '', ariaLabelOff: '' },
      { on, off, ariaLabelOn: '   ' },
      { on, off: { theme: 'default' } }, { on, off: on },
      { on: {}, off }, { on: { theme: 'invalid' }, off },
    ]) {
      const page = makePage({ root: { moduleId: 'base.preference-toggle', props } })
      expect(() => publishPage(page, makeSite({ settings, pages: [page] }), registry)).toThrow()
    }
  })

  it('repairs an arbitrary output tag to span while preserving authored copy', () => {
    const settings = { visitorPreferences: DEFAULT_SITE_VISITOR_PREFERENCES, shortcuts: {} }
    const page = makePage({ root: { moduleId: 'base.preference-output', props: { tag: 'script', textOn: 'Authored active copy', textOff: 'Authored standard copy' } } })
    const html = publishPage(page, makeSite({ settings, pages: [page] }), registry).html
    expect(html).toContain('<span data-instatic-preference-output=')
    expect(html).toContain('data-instatic-preference-text-on="Authored active copy"')
    expect(html).toContain('>Authored standard copy</span>')
    expect(html).not.toContain('<script data-instatic-preference-output=')
  })
})
