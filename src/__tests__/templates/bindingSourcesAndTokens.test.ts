/**
 * Coverage for the multi-source render context + token interpolation
 * engine (Phases 1-3 of the binding system refactor).
 *
 * What we assert:
 *   - resolveDynamicProps dispatches on each source
 *     (page / site / route / currentEntry)
 *   - missing frames resolve to empty / static fallback
 *   - dotted field paths walk plain objects safely
 *   - parseTokenString round-trips text + tokens, including backslash escapes
 *   - interpolateTokens substitutes against the named frames
 *   - resolveDynamicProps applies tokens to string-typed props
 *
 * No publisher harness here — these are unit tests on the resolver
 * itself. End-to-end rendering is covered by dynamicRender.test.ts.
 */

import { describe, expect, it } from 'bun:test'
import { resolveDynamicProps, type TemplateRenderDataContext } from '@core/templates/dynamicBindings'
import {
  containsTokens,
  interpolateTokens,
  parseTokenString,
} from '@core/templates/tokenInterpolation'
import {
  buildPageFrame,
  buildSiteFrame,
  buildRouteFrame,
} from '@core/templates/contextFrames'
import { makeSite } from "../fixtures"
import {
  DynamicBindingConfigurationError,
  PageNodeSchema,
  parsePageNode,
  type Page,
  type SiteDocument,
} from '@core/page-tree'
import { compiledCheck } from '@core/utils/typeboxCompiler'
import { DynamicBindingNumberFormatError } from '@core/templates'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function ctx(overrides: Partial<TemplateRenderDataContext> = {}): TemplateRenderDataContext {
  const fakePage = {
    id: 'page_1',
    slug: 'about',
    title: 'About Us',
    template: undefined,
  } as unknown as Page
  const fakeSite = { id: 'site_1', name: 'Acme', settings: { shortcuts: {} } } as SiteDocument

  return {
    entryStack: [],
    page: buildPageFrame(fakePage, fakeSite),
    site: buildSiteFrame(fakeSite),
    route: buildRouteFrame('/about'),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// resolveDynamicProps — new sources
// ---------------------------------------------------------------------------

describe('resolveDynamicProps — system sources', () => {
  it('resolves page.title against the page frame', () => {
    const props = resolveDynamicProps(
      { text: 'Static fallback' },
      { text: { source: 'page', field: 'title' } },
      ctx(),
    )
    expect(props.text).toBe('About Us')
  })

  it('resolves site.name against the site frame', () => {
    const props = resolveDynamicProps(
      { text: 'Static' },
      { text: { source: 'site', field: 'name' } },
      ctx(),
    )
    expect(props.text).toBe('Acme')
  })

  it('resolves route.path against the route frame', () => {
    const props = resolveDynamicProps(
      { text: 'Static' },
      { text: { source: 'route', field: 'path' } },
      ctx(),
    )
    expect(props.text).toBe('/about')
  })

  it('resolves route.query tokens against the route frame', () => {
    const props = resolveDynamicProps(
      { text: 'Search: {route.query.q}' },
      undefined,
      ctx({ route: buildRouteFrame('/search?q=dynamic') }),
    )
    expect(props.text).toBe('Search: dynamic')
  })

  it('keeps the static fallback when currentEntry frame is missing and fallback is not set', () => {
    // Outside a loop, the entryStack is empty so `currentEntry.*` has no frame.
    const props = resolveDynamicProps(
      { text: 'Untitled' },
      { text: { source: 'currentEntry', field: 'title' } },
      ctx({ entryStack: [] }),
    )
    expect(props.text).toBe('Untitled')
  })

  it('substitutes empty when currentEntry frame is missing and fallback is empty', () => {
    const props = resolveDynamicProps(
      { text: 'Untitled' },
      { text: { source: 'currentEntry', field: 'title', fallback: 'empty' } },
      ctx({ entryStack: [] }),
    )
    expect(props.text).toBe('')
  })

  it('resolves currentEntry.title when an entry is on the stack', () => {
    const props = resolveDynamicProps(
      { text: 'Untitled' },
      { text: { source: 'currentEntry', field: 'title' } },
      ctx({
        entryStack: [{ id: 'r1', fields: { title: 'Hello world' } }],
      }),
    )
    expect(props.text).toBe('Hello world')
  })

  it('supports dotted field paths (no relation traversal, just plain object dive)', () => {
    // Synthetic frame with a nested object value to prove the walker.
    const props = resolveDynamicProps(
      { text: '-' },
      { text: { source: 'currentEntry', field: 'nested.deep' } },
      ctx({
        entryStack: [
          { id: 'r1', fields: { nested: { deep: 'OK' } } },
        ],
      }),
    )
    expect(props.text).toBe('OK')
  })

  it('resolves repeater records by stable item ID for tokens and structured bindings', () => {
    const product = {
      id: 'product-1',
      fields: {
        matrix: [
          { id: 'feature-1', cells: { initialValue: 'Basic' } },
          { id: 'feature-2', cells: { initialValue: 'Premium' } },
        ],
      },
    }
    const context = ctx({ entryStack: [product] })
    const path = 'matrix.feature-2.cells.initialValue'

    expect(interpolateTokens(`{currentEntry.${path}}`, context)).toBe('Premium')
    expect(resolveDynamicProps(
      { text: 'Static' },
      { text: { source: 'currentEntry', field: path } },
      context,
    ).text).toBe('Premium')

    product.fields.matrix.reverse()
    expect(interpolateTokens(`{currentEntry.${path}}`, context)).toBe('Premium')
    expect(resolveDynamicProps(
      { text: 'Static' },
      { text: { source: 'currentEntry', field: path } },
      context,
    ).text).toBe('Premium')
  })

  it('resolves parentEntry repeater records from the frame below currentEntry', () => {
    const context = ctx({ entryStack: [
      { id: 'parent', fields: { matrix: [{ id: 'feature-2', cells: { initialValue: 'Parent value' } }] } },
      { id: 'child', fields: { matrix: [{ id: 'feature-2', cells: { initialValue: 'Child value' } }] } },
    ] })
    const path = 'matrix.feature-2.cells.initialValue'

    expect(interpolateTokens(`{parentEntry.${path}}`, context)).toBe('Parent value')
    expect(resolveDynamicProps(
      { text: 'Static' },
      { text: { source: 'parentEntry', field: path } },
      context,
    ).text).toBe('Parent value')
  })

  it('returns undefined for missing item IDs and does not treat numeric segments as positions', () => {
    const context = ctx({ entryStack: [{ id: 'r1', fields: {
      matrix: [
        { id: 'feature-2', cells: { initialValue: 'Premium' } },
        { cells: { initialValue: 'No stable ID' } },
      ],
      nullableMatrix: null,
    } }] })
    const missingPath = 'matrix.missing.cells.initialValue'
    const numericPath = 'matrix.0.cells.initialValue'
    const nullPath = 'nullableMatrix.feature-2.cells.initialValue'

    expect(interpolateTokens(`{currentEntry.${missingPath}}`, context)).toBe('')
    expect(interpolateTokens(`{currentEntry.${numericPath}}`, context)).toBe('')
    expect(interpolateTokens(`{currentEntry.${nullPath}}`, context)).toBe('')
    expect(resolveDynamicProps(
      { text: 'Static fallback' },
      { text: { source: 'currentEntry', field: missingPath } },
      context,
    ).text).toBe('Static fallback')
    expect(resolveDynamicProps(
      { text: 'Static fallback' },
      { text: { source: 'currentEntry', field: numericPath } },
      context,
    ).text).toBe('Static fallback')
    expect(resolveDynamicProps(
      { text: 'Static fallback' },
      { text: { source: 'currentEntry', field: nullPath } },
      context,
    ).text).toBe('Static fallback')
  })

  it('accepts a numeric-looking segment only when it matches an actual item ID', () => {
    const context = ctx({ entryStack: [{ id: 'r1', fields: {
      matrix: [{ id: '0', cells: { initialValue: 'Stable ID zero' } }],
    } }] })

    expect(interpolateTokens('{currentEntry.matrix.0.cells.initialValue}', context)).toBe('Stable ID zero')
    expect(resolveDynamicProps(
      { text: 'Static' },
      { text: { source: 'currentEntry', field: 'matrix.0.cells.initialValue' } },
      context,
    ).text).toBe('Stable ID zero')
  })

  it('does not traverse primitive arrays by position or by value', () => {
    const props = resolveDynamicProps(
      { text: 'Static' },
      { text: { source: 'currentEntry', field: 'tags.0' } },
      ctx({
        entryStack: [
          { id: 'r1', fields: { tags: ['a', 'b'] } },
        ],
      }),
    )
    expect(props.text).toBe('Static')

    const context = ctx({ entryStack: [{ id: 'r1', fields: { tags: ['a', 'b'] } }] })
    expect(interpolateTokens('{currentEntry.tags.0}', context)).toBe('')
    expect(interpolateTokens('{currentEntry.tags.a}', context)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Token interpolation engine
// ---------------------------------------------------------------------------

describe('containsTokens', () => {
  it('returns false for empty strings and plain text', () => {
    expect(containsTokens('')).toBe(false)
    expect(containsTokens('plain text')).toBe(false)
  })

  it('returns true when an unescaped { is present', () => {
    expect(containsTokens('Hello {site.name}')).toBe(true)
  })

  it('returns true even for escaped { (the parser resolves it to a literal)', () => {
    // Cheap check is conservative — an escaped `\{` still needs a parse so
    // the backslash is stripped; a false positive only costs one parse.
    expect(containsTokens('Literal \\{not-a-token}')).toBe(true)
  })
})

describe('parseTokenString', () => {
  it('parses pure text as a single text segment', () => {
    const segs = parseTokenString('just plain text')
    expect(segs).toEqual([{ kind: 'text', value: 'just plain text' }])
  })

  it('parses a single token surrounded by text', () => {
    const segs = parseTokenString('Hello {site.name}!')
    expect(segs).toEqual([
      { kind: 'text', value: 'Hello ' },
      { kind: 'token', source: 'site', field: 'name', raw: '{site.name}' },
      { kind: 'text', value: '!' },
    ])
  })

  it('honors backslash escape — \\{ emits a literal {', () => {
    const segs = parseTokenString('Literal \\{not-a-token}')
    expect(segs).toEqual([{ kind: 'text', value: 'Literal {not-a-token}' }])
  })

  it('emits malformed tokens verbatim (unknown source)', () => {
    const segs = parseTokenString('{unknown.field} stays as text')
    expect(segs[0]).toEqual({ kind: 'text', value: '{unknown.field} stays as text' })
  })

  it('handles unterminated { gracefully', () => {
    const segs = parseTokenString('Hello {site.name')
    expect(segs).toEqual([{ kind: 'text', value: 'Hello {site.name' }])
  })

  it('parses dotted field paths', () => {
    const segs = parseTokenString('{currentEntry.author.name}')
    expect(segs).toEqual([
      { kind: 'token', source: 'currentEntry', field: 'author.name', raw: '{currentEntry.author.name}' },
    ])
  })

  it('parses a fallback after the path with `|`', () => {
    const segs = parseTokenString('{site.name|My Site}')
    expect(segs).toEqual([
      {
        kind: 'token',
        source: 'site',
        field: 'name',
        fallback: 'My Site',
        raw: '{site.name|My Site}',
      },
    ])
  })

  it('preserves additional `|` characters inside the fallback verbatim', () => {
    const segs = parseTokenString('{currentEntry.title|Anonymous | Visitor}')
    expect(segs).toEqual([
      {
        kind: 'token',
        source: 'currentEntry',
        field: 'title',
        fallback: 'Anonymous | Visitor',
        raw: '{currentEntry.title|Anonymous | Visitor}',
      },
    ])
  })

  it('treats an empty fallback (`|` immediately before `}`) as an empty string fallback, not undefined', () => {
    const segs = parseTokenString('{site.name|}')
    expect(segs).toEqual([
      {
        kind: 'token',
        source: 'site',
        field: 'name',
        fallback: '',
        raw: '{site.name|}',
      },
    ])
  })
})

describe('interpolateTokens', () => {
  it('substitutes a single token', () => {
    const out = interpolateTokens('Hello {site.name}', ctx())
    expect(out).toBe('Hello Acme')
  })

  it('substitutes multiple tokens in one string', () => {
    const out = interpolateTokens('{site.name} — {page.title}', ctx())
    expect(out).toBe('Acme — About Us')
  })

  it('omits unknown values silently (empty substitution)', () => {
    const out = interpolateTokens('Before [{site.missing}] After', ctx())
    expect(out).toBe('Before [] After')
  })

  it('omits unresolved `currentEntry.*` outside a loop silently', () => {
    const out = interpolateTokens('Hi {currentEntry.title}!', ctx({ entryStack: [] }))
    expect(out).toBe('Hi !')
  })

  it('handles booleans and numbers via String()', () => {
    const c = ctx({
      entryStack: [{ id: 'r1', fields: { count: 42, isOn: true } }],
    })
    expect(interpolateTokens('count={currentEntry.count} on={currentEntry.isOn}', c)).toBe(
      'count=42 on=true',
    )
  })

  it('emits the fallback when the value is missing', () => {
    const c = ctx({ entryStack: [] })
    expect(interpolateTokens('Welcome, {currentEntry.title|guest}!', c)).toBe(
      'Welcome, guest!',
    )
  })

  it('emits the fallback when the value resolves to an empty string', () => {
    const c = ctx({
      entryStack: [{ id: 'r1', fields: { title: '' } }],
    })
    expect(interpolateTokens('{currentEntry.title|Untitled}', c)).toBe('Untitled')
  })

  it('prefers the real value over the fallback when present', () => {
    const c = ctx({
      entryStack: [{ id: 'r1', fields: { title: 'Hello' } }],
    })
    expect(interpolateTokens('{currentEntry.title|Untitled}', c)).toBe('Hello')
  })

  it('emits empty when the value is missing and there is no fallback', () => {
    const c = ctx({ entryStack: [] })
    expect(interpolateTokens('Welcome, {currentEntry.title}!', c)).toBe('Welcome, !')
  })

  it('strips the backslash of an escaped `\\{` and emits a literal `{`', () => {
    expect(interpolateTokens('Literal \\{not-a-token}', ctx())).toBe('Literal {not-a-token}')
  })

  it('strips the escape even when the string carries no real token', () => {
    expect(interpolateTokens('\\{just-braces}', ctx())).toBe('{just-braces}')
  })
})

// ---------------------------------------------------------------------------
// resolveDynamicProps — token interpolation applies to string props
// ---------------------------------------------------------------------------

describe('resolveDynamicProps — token interpolation', () => {
  it('substitutes tokens embedded in static string props', () => {
    const props = resolveDynamicProps(
      { text: 'Welcome to {site.name} — {page.title}!' },
      undefined,
      ctx(),
    )
    expect(props.text).toBe('Welcome to Acme — About Us!')
  })

  it('leaves non-string props untouched', () => {
    const props = resolveDynamicProps(
      { text: 'Hello {site.name}', count: 7 },
      undefined,
      ctx(),
    )
    expect(props.text).toBe('Hello Acme')
    expect(props.count).toBe(7)
  })

  it('skips strings that contain no tokens without allocating', () => {
    const input = { text: 'static text', label: 'No braces here' }
    const props = resolveDynamicProps(input, undefined, ctx())
    // Same reference back since no mutation happened.
    expect(props).toBe(input)
  })

  it('combines structured binding and token paths', () => {
    const props = resolveDynamicProps(
      {
        text: 'static fallback',
        // This prop value contains tokens AND has a structured binding —
        // the binding wins, then tokens apply to the result.
        heading: 'Welcome to {site.name}',
      },
      { text: { source: 'page', field: 'title' } },
      ctx(),
    )
    expect(props.text).toBe('About Us')
    expect(props.heading).toBe('Welcome to Acme')
  })
})

// ---------------------------------------------------------------------------
// Frame builders
// ---------------------------------------------------------------------------

describe('frame builders', () => {
  it('buildPageFrame derives permalink with index normalisation', () => {
    const home = buildPageFrame({ id: 'p_index', slug: '/index', title: 'Home' } as unknown as Page, makeSite())
    expect(home.permalink).toBe('/')
    const inner = buildPageFrame({ id: 'p_about', slug: 'about', title: 'About' } as unknown as Page, makeSite())
    expect(inner.permalink).toBe('/about')
  })

  it('buildRouteFrame derives slug and segments', () => {
    const route = buildRouteFrame('/posts/hello-world')
    expect(route.slug).toBe('hello-world')
    expect(route.segments).toEqual(['posts', 'hello-world'])
    expect(route.path).toBe('/posts/hello-world')
  })

  it('buildRouteFrame preserves query params for route.query bindings', () => {
    const route = buildRouteFrame('/search?q=dynamic&page=2')
    expect(route.query).toEqual({ q: 'dynamic', page: '2' })
  })

  it('buildRouteFrame handles a root URL', () => {
    const route = buildRouteFrame('/')
    expect(route.slug).toBe(null)
    expect(route.segments).toEqual([])
    expect(route.path).toBe('/')
  })
})

// ---------------------------------------------------------------------------
// Tokens inside htmlAttributes
// ---------------------------------------------------------------------------

describe('resolveDynamicProps — tokens in htmlAttributes', () => {
  const entry = { id: 'r1', fields: { 'video-link': 'https://cdn.example.com/hover.mp4', title: 'Peak' } }

  it('interpolates a token written on an author-set attribute', () => {
    // The case this exists for: a custom `<source>` tag whose `src` is bound
    // per loop item. `href` on a link already worked because it is a
    // first-class string prop; an attribute is one level down and was skipped,
    // so the token shipped to the browser as literal text.
    const props = resolveDynamicProps(
      { tag: 'custom', customTag: 'source', htmlAttributes: { src: '{currentEntry.video-link}' } },
      undefined,
      ctx({ entryStack: [entry] }),
    )
    expect(props.htmlAttributes).toEqual({ src: 'https://cdn.example.com/hover.mp4' })
  })

  it('leaves attributes without tokens untouched, and does not copy needlessly', () => {
    const staticProps = { htmlAttributes: { 'data-w-id': 'abc-123', loading: 'lazy' } }
    const props = resolveDynamicProps(staticProps, undefined, ctx({ entryStack: [entry] }))
    expect(props).toBe(staticProps)
  })

  it('interpolates only the attributes that carry tokens', () => {
    const props = resolveDynamicProps(
      { htmlAttributes: { src: '{currentEntry.video-link}', 'data-w-id': 'abc-123' } },
      undefined,
      ctx({ entryStack: [entry] }),
    )
    expect(props.htmlAttributes).toEqual({
      src: 'https://cdn.example.com/hover.mp4',
      'data-w-id': 'abc-123',
    })
  })

  it('does not mutate the caller’s props object', () => {
    const staticProps = { htmlAttributes: { src: '{currentEntry.video-link}' } }
    resolveDynamicProps(staticProps, undefined, ctx({ entryStack: [entry] }))
    expect(staticProps.htmlAttributes.src).toBe('{currentEntry.video-link}')
  })

  it('an unresolvable token becomes empty rather than shipping the literal', () => {
    const props = resolveDynamicProps(
      { htmlAttributes: { src: '{currentEntry.nope}' } },
      undefined,
      ctx({ entryStack: [entry] }),
    )
    expect(String((props.htmlAttributes as Record<string, string>).src)).not.toContain('{currentEntry')
  })

  it('never markdown-renders an attribute value', () => {
    // `isRichtextPropKey` must not reach attribute values — an attribute is a
    // value, not a body, and wrapping it in <p> would corrupt the URL.
    const props = resolveDynamicProps(
      { htmlAttributes: { html: '{currentEntry.title}' } },
      undefined,
      ctx({ entryStack: [entry] }),
    )
    expect((props.htmlAttributes as Record<string, string>).html).toBe('Peak')
  })

  it('ignores a malformed htmlAttributes bag instead of throwing', () => {
    const props = resolveDynamicProps(
      { htmlAttributes: { nested: { deep: 'x' } } as unknown as Record<string, string> },
      undefined,
      ctx({ entryStack: [entry] }),
    )
    expect(props.htmlAttributes).toEqual({ nested: { deep: 'x' } })
  })
})

// ---------------------------------------------------------------------------
// Numeric structured bindings
// ---------------------------------------------------------------------------

describe('resolveDynamicProps — numeric bindings', () => {
  it('formats numeric strings using the active site language and Intl decimal defaults', () => {
    const props = resolveDynamicProps(
      { text: '€' },
      { text: { source: 'currentEntry', field: 'price', format: 'number' } },
      ctx({
        entryStack: [{ id: 'product-1', fields: { price: '1234.5678' } }],
        site: { id: 'site_1', name: 'Acme', language: 'it-IT' },
      }),
    )

    expect(props.text).toBe('1234,568')
  })

  it('uses explicit decimal options and locale override without currency formatting', () => {
    const props = resolveDynamicProps(
      { text: 'Static' },
      {
        text: {
          source: 'currentEntry',
          field: 'price',
          format: 'number',
          numberFormat: {
            locale: 'en-US',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
            useGrouping: false,
          },
        },
      },
      ctx({ entryStack: [{ id: 'product-1', fields: { price: 1234.5 } }] }),
    )

    expect(props.text).toBe('1234.50')
  })

  it('uses the active page language catalogue for locale-specific number affixes', () => {
    const binding = {
      text: {
        source: 'currentEntry' as const,
        field: 'price',
        format: 'number' as const,
        numberFormat: { templateKey: 'pricing.monthly' },
      },
    }
    const entryStack = [{ id: 'product-1', fields: { price: 12345.5 } }]
    const english = resolveDynamicProps(
      { text: 'Static' },
      binding,
      ctx({ entryStack, site: {
        id: 'site_1', name: 'Acme', language: 'en',
        translations: { pricing: { monthly: '€{value}' } },
      } }),
    )
    const italian = resolveDynamicProps(
      { text: 'Static' },
      binding,
      ctx({ entryStack, site: {
        id: 'site_1', name: 'Acme', language: 'it',
        translations: { pricing: { monthly: '{value} €' } },
      } }),
    )

    expect(english.text).toBe('€12,345.5')
    expect(italian.text).toBe('12.345,5 €')
  })

  it('keeps the page catalogue language independent from the numeric locale override', () => {
    const props = resolveDynamicProps(
      { text: 'Static' },
      { text: {
        source: 'currentEntry',
        field: 'price',
        format: 'number',
        numberFormat: { locale: 'it-IT', templateKey: 'pricing.monthly' },
      } },
      ctx({
        entryStack: [{ id: 'product-1', fields: { price: 12345.5 } }],
        site: {
          id: 'site_1', name: 'Acme', language: 'en',
          translations: { pricing: { monthly: '€ {value}' } },
        },
      }),
    )

    expect(props.text).toBe('€ 12.345,5')
  })

  it('throws a typed path error for missing or malformed number language templates', () => {
    const binding = {
      text: {
        source: 'currentEntry' as const,
        field: 'price',
        format: 'number' as const,
        numberFormat: { templateKey: 'pricing.monthly' },
      },
    }
    const entryStack = [{ id: 'product-1', fields: { price: 12.5 } }]
    const contextFor = (pattern?: string) => ctx({
      entryStack,
      site: {
        id: 'site_1', name: 'Acme', language: 'en',
        translations: pattern === undefined ? {} : { pricing: { monthly: pattern } },
      },
    })

    for (const [pattern, code] of [
      ['Currency only', 'invalid-template'],
      ['{value} and {value}', 'invalid-template'],
      [undefined, 'invalid-template'],
    ] as const) {
      let error: unknown
      try {
        resolveDynamicProps({ text: 'Static' }, binding, contextFor(pattern))
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(DynamicBindingNumberFormatError)
      expect(error).toMatchObject({
        code,
        path: 'dynamicBindings.text.numberFormat.templateKey',
      })
    }

    let emptyKeyError: unknown
    try {
      resolveDynamicProps({ text: 'Static' }, {
        text: { ...binding.text, numberFormat: { templateKey: '' } },
      }, contextFor('€{value}'))
    } catch (caught) {
      emptyKeyError = caught
    }
    expect(emptyKeyError).toBeInstanceOf(DynamicBindingNumberFormatError)
    expect(emptyKeyError).toMatchObject({
      code: 'invalid-template',
      path: 'dynamicBindings.text.numberFormat.templateKey',
    })

    let noLanguageError: unknown
    try {
      resolveDynamicProps({ text: 'Static' }, {
        text: {
          ...binding.text,
          numberFormat: { locale: 'it-IT', templateKey: 'pricing.monthly' },
        },
      }, ctx({
        entryStack,
        site: { id: 'site_1', name: 'Acme', translations: { pricing: { monthly: '€{value}' } } },
      }))
    } catch (caught) {
      noLanguageError = caught
    }
    expect(noLanguageError).toBeInstanceOf(DynamicBindingNumberFormatError)
    expect(noLanguageError).toMatchObject({
      code: 'invalid-template',
      path: 'dynamicBindings.text.numberFormat.templateKey',
    })
  })

  it('leaves unformatted bindings raw and preserves the static fallback for missing values', () => {
    const raw = resolveDynamicProps(
      { text: 'Static' },
      { text: { source: 'currentEntry', field: 'price' } },
      ctx({ entryStack: [{ id: 'product-1', fields: { price: '1234.50' } }] }),
    )
    const missing = resolveDynamicProps(
      { text: 'Static' },
      { text: { source: 'currentEntry', field: 'price', format: 'number' } },
      ctx({ entryStack: [{ id: 'product-1', fields: {} }] }),
    )

    expect(raw.text).toBe('1234.50')
    expect(missing.text).toBe('Static')
  })

  it('throws a typed error for non-finite or non-numeric values', () => {
    for (const price of [Number.POSITIVE_INFINITY, Number.NaN, 'not-a-price', '']) {
      expect(() => resolveDynamicProps(
        { text: 'Static' },
        { text: { source: 'currentEntry', field: 'price', format: 'number' } },
        ctx({ entryStack: [{ id: 'product-1', fields: { price } }] }),
      )).toThrow(DynamicBindingNumberFormatError)
    }
  })

  it('throws a typed error for invalid fraction ranges and locale tags', () => {
    const binding = { source: 'currentEntry' as const, field: 'price', format: 'number' as const }
    const context = ctx({ entryStack: [{ id: 'product-1', fields: { price: 12.5 } }] })

    expect(() => resolveDynamicProps(
      { text: 'Static' },
      { text: { ...binding, numberFormat: { minimumFractionDigits: 3, maximumFractionDigits: 2 } } },
      context,
    )).toThrow(DynamicBindingNumberFormatError)
    expect(() => resolveDynamicProps(
      { text: 'Static' },
      { text: { ...binding, numberFormat: { locale: 'not a locale' } } },
      context,
    )).toThrow(DynamicBindingNumberFormatError)
  })

  it('uses a typed path error when the number format context has no locale', () => {
    const context = ctx({
      entryStack: [{ id: 'product-1', fields: { price: 12.5 } }],
      site: { id: 'site_1', name: 'Acme' },
    })

    let error: unknown
    try {
      resolveDynamicProps(
      { text: 'Static' },
      { text: { source: 'currentEntry', field: 'price', format: 'number' } },
      context,
      )
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(DynamicBindingNumberFormatError)
    expect(error).toMatchObject({
      code: 'invalid-options',
      path: 'dynamicBindings.text',
    })
  })

  it('round-trips authored number format options through the page-node parser and schema', () => {
    const raw = {
      id: 'price-node',
      moduleId: 'base.text',
      children: [],
      props: { text: '€' },
      dynamicBindings: {
        text: {
          source: 'currentEntry',
          field: 'price',
          format: 'number',
          numberFormat: { locale: 'it-IT', templateKey: 'pricing.monthly', minimumFractionDigits: 2, maximumFractionDigits: 2 },
        },
      },
    }
    const parsed = parsePageNode(raw, 'nodes.price-node')

    expect(parsed.dynamicBindings?.text).toEqual(raw.dynamicBindings.text)
    expect(compiledCheck(PageNodeSchema, parsed)).toBe(true)
    expect(compiledCheck(PageNodeSchema, {
      ...parsed,
      dynamicBindings: { text: { ...raw.dynamicBindings.text, numberFormat: { maximumFractionDigits: 21 } } },
    })).toBe(false)
    expect(compiledCheck(PageNodeSchema, {
      ...parsed,
      dynamicBindings: { text: { ...raw.dynamicBindings.text, numberFormat: { ...raw.dynamicBindings.text.numberFormat, templateKey: '' } } },
    })).toBe(false)
    let configError: unknown
    try {
      parsePageNode({
        ...raw,
        dynamicBindings: { text: { ...raw.dynamicBindings.text, numberFormat: { minimumFractionDigits: '2' } } },
      }, 'nodes.price-node')
    } catch (error) {
      configError = error
    }
    expect(configError).toBeInstanceOf(DynamicBindingConfigurationError)
    expect(configError).toMatchObject({
      path: 'dynamicBindings.text.numberFormat',
      code: 'invalid-number-format',
    })

    for (const templateKey of ['', '   ']) {
      let templateKeyError: unknown
      try {
        parsePageNode({
          ...raw,
          dynamicBindings: {
            text: { ...raw.dynamicBindings.text, numberFormat: { ...raw.dynamicBindings.text.numberFormat, templateKey } },
          },
        }, 'nodes.price-node')
      } catch (error) {
        templateKeyError = error
      }
      expect(templateKeyError).toBeInstanceOf(DynamicBindingConfigurationError)
      expect(templateKeyError).toMatchObject({
        path: 'dynamicBindings.text.numberFormat.templateKey',
        code: 'invalid-number-format',
      })
    }

    for (const numberFormat of [
      { minimumFractionDigits: 3, maximumFractionDigits: 2 },
      { locale: '' },
      { locale: 'not a locale' },
    ]) {
      let crossFieldError: unknown
      try {
        parsePageNode({
          ...raw,
          dynamicBindings: {
            text: { ...raw.dynamicBindings.text, numberFormat },
          },
        }, 'nodes.price-node')
      } catch (error) {
        crossFieldError = error
      }
      expect(crossFieldError).toBeInstanceOf(DynamicBindingConfigurationError)
      expect(crossFieldError).toMatchObject({
        path: 'dynamicBindings.text.numberFormat',
        code: 'invalid-number-format',
      })
    }

    const canonicalLocale = parsePageNode({
      ...raw,
      dynamicBindings: {
        text: { ...raw.dynamicBindings.text, numberFormat: { locale: ' it-it ' } },
      },
    }, 'nodes.price-node')
    expect(canonicalLocale.dynamicBindings?.text.numberFormat?.locale).toBe('it-IT')
  })
})
