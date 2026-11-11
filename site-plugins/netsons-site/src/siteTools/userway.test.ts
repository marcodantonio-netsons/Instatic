import { describe, expect, it } from 'bun:test'
import {
  augmentSiteToolsCsp,
  installUserwayRuntime,
  USERWAY_FRONTEND_ASSET,
} from './userway'

function policyDirectives(html: string): Map<string, string[]> {
  const content = /http-equiv="Content-Security-Policy" content="([^"]*)"/i.exec(html)?.[1]
  if (!content) throw new Error('CSP meta tag is missing')
  return new Map(content.replaceAll('&#x27;', "'").split(';').flatMap(chunk => {
    const [name, ...sources] = chunk.trim().split(/\s+/)
    return name ? [[name, sources]] : []
  }))
}

describe('site-owned UserWay integration', () => {
  it('declares a deferred body-end plugin asset', () => {
    expect(USERWAY_FRONTEND_ASSET).toEqual({
      kind: 'script',
      src: 'frontend/userway.js',
      placement: 'body-end',
      strategy: 'defer',
    })
  })

  it('preserves the authored trigger, account, loading state, and error behavior', () => {
    const triggerAttributes = new Map<string, string>()
    const scriptAttributes = new Map<string, string>()
    const listeners = new Map<string, EventListenerOrEventListenerObject>()
    const listenerOptions = new Map<string, boolean | AddEventListenerOptions | undefined>()
    const appended: unknown[] = []
    const trigger = {
      setAttribute: (name: string, value: string) => triggerAttributes.set(name, value),
    } as unknown as HTMLElement
    const script = {
      id: '',
      src: '',
      async: false,
      setAttribute: (name: string, value: string) => scriptAttributes.set(name, value),
      addEventListener: (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) => {
        listeners.set(type, listener)
        listenerOptions.set(type, options)
      },
    } as unknown as HTMLScriptElement
    const document = {
      getElementById: (id: string) => id === 'netsons-accessibility-trigger' ? trigger : null,
      createElement: () => script,
      head: { append: (element: unknown) => appended.push(element) },
    } as unknown as Document

    installUserwayRuntime(document)

    expect(script).toMatchObject({
      id: 'netsons-userway-script',
      src: 'https://cdn.userway.org/widget.js',
      async: true,
    })
    expect(scriptAttributes).toEqual(new Map([
      ['data-account', 'ivP7l9vdOQ'],
      ['data-trigger', 'netsons-accessibility-trigger'],
      ['data-mobile', 'true'],
      ['data-cookieconsent', 'ignore'],
    ]))
    expect(appended).toEqual([script])
    expect(listenerOptions.get('load')).toEqual({ once: true })
    expect(listenerOptions.get('error')).toEqual({ once: true })

    const load = listeners.get('load')
    if (typeof load !== 'function') throw new Error('UserWay load listener is missing')
    load(new Event('load'))
    expect(triggerAttributes).toEqual(new Map([
      ['aria-busy', 'false'],
      ['data-ready', 'true'],
    ]))
  })

  it('adds only the required provider origins and is idempotent', () => {
    const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; script-src-elem 'self'; frame-src 'none'; connect-src 'self'; style-src 'self' 'unsafe-inline';"></head><body></body></html>`
    const augmented = augmentSiteToolsCsp(html)
    const directives = policyDirectives(augmented)

    expect(directives.get('script-src')).toEqual(["'self'", 'https://cdn.userway.org'])
    expect(directives.get('script-src-elem')).toEqual(["'self'", 'https://cdn.userway.org'])
    expect(directives.get('frame-src')).toEqual(['https://cdn.userway.org'])
    expect(directives.get('connect-src')).toEqual(["'self'", 'https://api.userway.org', 'https://cdn.userway.org'])
    expect(directives.get('style-src')).toEqual(["'self'", "'unsafe-inline'", 'https://cdn.userway.org'])
    expect(augmented.match(/http-equiv="Content-Security-Policy"/gi)).toHaveLength(1)
    expect(augmentSiteToolsCsp(augmented)).toBe(augmented)
  })

  it('lifts only required none directives without broadening unrelated directives', () => {
    const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'none'; script-src-elem 'none'; frame-src 'none'; connect-src 'none'; style-src 'none'; img-src 'none';"></head><body></body></html>`
    const directives = policyDirectives(augmentSiteToolsCsp(html))

    expect(directives.get('script-src')).toEqual(['https://cdn.userway.org'])
    expect(directives.get('script-src-elem')).toEqual(['https://cdn.userway.org'])
    expect(directives.get('frame-src')).toEqual(['https://cdn.userway.org'])
    expect(directives.get('connect-src')).toEqual(['https://api.userway.org', 'https://cdn.userway.org'])
    expect(directives.get('style-src')).toEqual(['https://cdn.userway.org'])
    expect(directives.get('img-src')).toEqual(["'none'"])
  })

  it('fails closed when the published page has no CSP meta tag', () => {
    expect(() => augmentSiteToolsCsp('<html><head></head><body></body></html>')).toThrow(
      'Published page requires CSP sources but has no CSP meta tag',
    )
  })
})
