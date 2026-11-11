import { describe, expect, it } from 'bun:test'
import { installServerRichtextSanitizer } from '../../../../server/richtextSanitizer'
import { escapeProps } from '@core/publisher/escapeProps'
import { SvgModule as NativeSvgModule } from '../../../../src/modules/base/svg'
import { escapeHtml } from '../shared/htmlSafety'
import { translate } from '../localization'
import { localizeSvgMarkup, SvgModule } from './index'

installServerRichtextSanitizer()

const languages = ['it', 'en', 'de', 'fr', 'es', 'pt', 'nl', 'pl', 'ro'] as const
const routeFor = (language: string) => language === 'it' ? '/shared/example' : `/${language}/shared/example`

function renderAtPublisherBoundary(svg: string, title: string, routePath = '/shared/example'): string {
  const child = NativeSvgModule.render(escapeProps({ svg, title: '' }, NativeSvgModule.schema) as never, []).html
  const escaped = escapeProps({ title }, SvgModule.schema)
  return SvgModule.render({ ...escaped, routePath }, [child]).html
}

describe('netsons.site.svg', () => {
  it('matches native base.svg output for the same sanitized markup and label', () => {
    const raw = {
      svg: '<svg viewBox="0 0 24 24"><path d="M1 1h22"/></svg>',
      title: 'Logo "mark" & icon',
    }
    const nativeProps = escapeProps(raw, NativeSvgModule.schema)
    const pluginHtml = renderAtPublisherBoundary(raw.svg, raw.title)

    expect(pluginHtml).toBe(NativeSvgModule.render(nativeProps as never, []).html)
  })

  it('uses a native child for the host SVG sanitizer without extending the plugin SDK', () => {
    expect(SvgModule.canHaveChildren).toBe(true)
    expect(SvgModule.schema).not.toHaveProperty('svg')
    const html = renderAtPublisherBoundary(
      '<svg onload="alert(1)"><script>alert(1)</script><foreignObject><p>x</p></foreignObject><path d="M0 0"/></svg>',
      'Safe logo',
    )

    expect(html).toContain('<svg')
    expect(html).toContain('<path')
    expect(html.toLowerCase()).not.toContain('<script')
    expect(html.toLowerCase()).not.toContain('onload')
    expect(html.toLowerCase()).not.toContain('foreignobject')
    expect(html).not.toContain('alert(1)')
  })

  it('keeps dollar replacement sequences literal in accessible labels', () => {
    const html = renderAtPublisherBoundary('<svg><path d="M0 0"/></svg>', 'Logo $& $\' $`')
    expect(html).toContain('aria-label="Logo $&amp; $&#x27; $`"')
    expect(html.match(/<svg/g)).toHaveLength(1)
  })

  it('localizes the SVG and accessible label for all nine canonical routes', () => {
    const key = 'visitorPreferences.statuses.saved'
    for (const language of languages) {
      const expected = escapeHtml(translate(language, key))
      const token = `{i18n.${key}}`
      const html = renderAtPublisherBoundary(
        `<svg viewBox="0 0 10 10"><text>${token}</text></svg>`,
        token,
        routeFor(language),
      )

      expect(html).toContain(`<text>${expected}</text>`)
      expect(html).toContain(`aria-label="${expected}"`)
      expect(html).not.toContain(token)
    }
  })

  it('escapes translation values before inserting them into SVG markup', () => {
    const payload = 'label "x"</text><script>alert(1)</script>'
    const html = localizeSvgMarkup(
      '<svg><text>{i18n.security.payload}</text></svg>',
      'it',
      () => payload,
    )

    expect(html).toContain('label &quot;x&quot;&lt;/text&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('</text></svg>')
  })

  it('keeps editor preview inert and uses the escaped accessible title', () => {
    const preview = SvgModule.preview?.({
      svg: '<svg><script>alert(1)</script></svg>',
      title: '" onmouseover="alert(1)',
    }, [])

    expect(preview?.html).toContain('<span')
    expect(preview?.html).toContain('aria-label="&quot; onmouseover=&quot;alert(1)"')
    expect(preview?.html).not.toContain('<svg')
    expect(preview?.html).not.toContain('<script>')
  })
})
