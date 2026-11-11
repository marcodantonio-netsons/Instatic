import { augmentCspSources } from '../forms/csp'

export const USERWAY_RUNTIME_ASSET_PATH = 'frontend/userway.js'

/** Declarative plugin asset for the site-owned accessibility trigger. */
export const USERWAY_FRONTEND_ASSET = {
  kind: 'script',
  src: USERWAY_RUNTIME_ASSET_PATH,
  placement: 'body-end',
  strategy: 'defer',
} as const

/** Installs the official provider loader without embedding vendor code. */
export function installUserwayRuntime(document: Document): void {
  const trigger = document.getElementById('netsons-accessibility-trigger')
  if (!trigger) throw new Error('[site-tools] Accessibility trigger is missing')
  const script = document.createElement('script')
  script.id = 'netsons-userway-script'
  script.src = 'https://cdn.userway.org/widget.js'
  script.async = true
  script.setAttribute('data-account', 'ivP7l9vdOQ')
  script.setAttribute('data-trigger', 'netsons-accessibility-trigger')
  script.setAttribute('data-mobile', 'true')
  script.setAttribute('data-cookieconsent', 'ignore')
  script.addEventListener('load', () => {
    trigger.setAttribute('aria-busy', 'false')
    trigger.setAttribute('data-ready', 'true')
  }, { once: true })
  script.addEventListener('error', () => {
    console.error('[site-tools] The accessibility provider could not be loaded')
  }, { once: true })
  document.head.append(script)
}

/** Plugin-bundled script body; the publisher injects it as a deferred asset. */
export const USERWAY_RUNTIME_JS = `(${installUserwayRuntime.toString()})(document);`

/** Add only the provider origins used by the existing site-owned loader. */
export function augmentSiteToolsCsp(html: string): string {
  return augmentCspSources(html, [
    { directive: 'script-src', sources: ['https://cdn.userway.org'], fallbackNames: ['default-src'] },
    { directive: 'script-src-elem', sources: ['https://cdn.userway.org'], fallbackNames: ['script-src'], onlyIfPresent: true },
    { directive: 'frame-src', sources: ['https://cdn.userway.org'], fallbackNames: ['child-src', 'default-src'] },
    { directive: 'connect-src', sources: ['https://api.userway.org', 'https://cdn.userway.org'], fallbackNames: ['default-src'] },
    { directive: 'style-src', sources: ['https://cdn.userway.org'], fallbackNames: ['default-src'] },
  ])
}
