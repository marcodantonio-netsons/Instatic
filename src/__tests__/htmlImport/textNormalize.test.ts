/**
 * textNormalize.test.ts — imported text/label props collapse the source HTML's
 * pretty-print whitespace (leading indentation, newlines) the way a browser
 * would, so editor text fields don't show stray leading spaces / line breaks.
 */

import { describe, it, expect } from 'bun:test'
import '@modules/base'
import { importHtml, normalizeImportedText } from '@core/htmlImport'
import { TextModule } from '@modules/base/text'

function singleProps(html: string): Record<string, unknown> {
  const r = importHtml(html)
  return r.nodes[r.rootIds[0]!]!.props
}

describe('normalizeImportedText', () => {
  it('collapses whitespace runs and trims', () => {
    expect(normalizeImportedText('\n      instatic  ')).toBe('instatic')
    expect(normalizeImportedText('The Club\n  is how\tit stays')).toBe('The Club is how it stays')
    expect(normalizeImportedText('   ')).toBe('')
    expect(normalizeImportedText('\t\n\f\r A\t\n\f\r B \t\n\f\r')).toBe('A B')
  })

  it('retains nonbreaking and other Unicode spaces, including text edges', () => {
    expect(normalizeImportedText(' \t\u00a0Progetti \u00a0 Lo studio\u00a0\r\n')).toBe('\u00a0Progetti \u00a0 Lo studio\u00a0')
    expect(normalizeImportedText('\u202f1\u202f234\u202f')).toBe('\u202f1\u202f234\u202f')
    expect(normalizeImportedText('\u2003Text\u2003')).toBe('\u2003Text\u2003')
  })
})

describe('imported text props are normalized', () => {
  it('paragraph text drops leading indentation + newlines', () => {
    const props = singleProps('<p>\n      The CMS is open source\n      and free.\n    </p>')
    expect(props.text).toBe('The CMS is open source and free.')
  })

  it('button label is trimmed', () => {
    const props = singleProps('<button>\n   Get Instatic   \n</button>')
    expect(props.label).toBe('Get Instatic')
  })

  it('text-only link text is trimmed', () => {
    const props = singleProps('<a href="/x">\n   Visit us \n</a>')
    expect(props.text).toBe('Visit us')
  })

  it('preserves authored nonbreaking separators in imported leaf text and labels', () => {
    expect(singleProps('<span>Progetti &nbsp; Lo studio &nbsp; Contatti</span>').text).toBe('Progetti \u00a0 Lo studio \u00a0 Contatti')
    expect(singleProps('<a href="/x"> &nbsp;Visita&nbsp; </a>').text).toBe('\u00a0Visita\u00a0')
    expect(singleProps('<button> &nbsp;Invia&#8239; </button>').label).toBe('\u00a0Invia\u202f')
    expect(singleProps('<span>&nbsp;</span>').text).toBe('\u00a0')
  })
})

describe('mixed imported text preserves nonbreaking content', () => {
  it('keeps nonbreaking parent edges and standalone separators in document order', () => {
    const result = importHtml('<div> \t&nbsp;<strong>A</strong>\n&nbsp;\n<em>B</em>&#8239; \t</div>')
    const root = result.nodes[result.rootIds[0]]
    const children = root.children.map(id => result.nodes[id])

    expect(children.map(node => node.props.text)).toEqual(['\u00a0', 'A', ' \u00a0 ', 'B', '\u202f'])
    const separator = children[2]
    expect(separator.props.tag).toBe('none')
    expect(TextModule.render(separator.props, []).html).toBe(' \u00a0 ')
  })

  it('keeps a top-level NBSP-only text node instead of dropping it as indentation', () => {
    const result = importHtml('&nbsp;')
    expect(result.rootIds).toHaveLength(1)
    const node = result.nodes[result.rootIds[0]]
    expect(node.props.tag).toBe('none')
    expect(node.props.text).toBe('\u00a0')
  })

  it('retains the significant spaces and line breaks of a preformatted text run', () => {
    const result = importHtml('<pre><code> \tA&nbsp;\n\t B&#8239; </code></pre>')
    const text = Object.values(result.nodes).filter(node => node.moduleId === 'base.text').map(node => node.props.text).join('')
    expect(text).toBe(' \tA\u00a0\n\t B\u202f ')
  })
})
