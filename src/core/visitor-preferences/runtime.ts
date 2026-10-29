import type {
  VisitorPreferenceName,
  VisitorPreferenceOverrides,
  VisitorPreferencesRuntimeConfig,
} from '@core/visitor-preferences-schema'
import type { ResolvedVisitorPreferences, resolveVisitorPreferences } from './resolve'

export type VisitorPreferenceStatus = 'default' | 'saved' | 'session' | 'reset' | 'unavailable' | 'preview' | 'invalid'
export type VisitorPreferencesValidators = {
  config: (value: unknown) => value is VisitorPreferencesRuntimeConfig
  overrides: (value: unknown) => value is VisitorPreferenceOverrides
  name: (value: unknown) => value is VisitorPreferenceName
  patch: (value: unknown) => value is VisitorPreferenceOverrides
}
export type VisitorPreferencesState = ResolvedVisitorPreferences & { status: VisitorPreferenceStatus }
export type VisitorPreferencesChangeEvent = CustomEvent<VisitorPreferencesState>
export type VisitorPreferencesOwner = {
  getState: () => VisitorPreferencesState
  set: (patch: VisitorPreferenceOverrides, origin?: Element) => void
  updateConfig: (value: VisitorPreferencesRuntimeConfig) => void
  subscribe: (listener: () => void) => () => void
}

/**
 * One typed installer for published documents and canvas documents. All
 * dependencies are explicit so its compiled function is a static browser asset.
 */
export function installVisitorPreferences(
  document: Document,
  rawConfig: unknown,
  validators: VisitorPreferencesValidators,
  resolve: typeof resolveVisitorPreferences,
): { owner: VisitorPreferencesOwner; release: () => void } {
  if (!validators.config(rawConfig)) throw new Error('Invalid visitor preference runtime configuration')
  const context = document.defaultView
  if (!context) throw new Error('Visitor preferences require a browser document')
  const window = context
  const host = document as Document & {
    __instaticVisitorPreferences?: { users: number; owner: VisitorPreferencesOwner; dispose: () => void }
  }
  let installation = host.__instaticVisitorPreferences
  if (!installation) {
    const root = document.documentElement
    const original = {
      defaultTheme: root.classList.contains('theme-default'),
      altTheme: root.classList.contains('theme-alt'),
      motion: root.getAttribute('data-instatic-motion'),
      media: root.getAttribute('data-instatic-media'),
    }
    let config = { defaults: { ...rawConfig.defaults }, storage: rawConfig.storage }
    let overrides: VisitorPreferenceOverrides = {}
    let status: VisitorPreferenceStatus = config.storage === 'memory' ? 'preview' : 'default'
    const dark = window.matchMedia('(prefers-color-scheme: dark)')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const listeners = new Set<() => void>()
    const managedVideos = new Map<HTMLVideoElement, {
      source: string | null
      preload: HTMLVideoElement['preload']
      autoplay: boolean
      ready: string | null
      onMediaState: (event: Event) => void
    }>()
    const storageKey = 'instatic.site-preferences'
    const controlSelector = '[data-instatic-preference-control]'
    const toggleSelector = 'button[data-instatic-preference-toggle]'
    const outputSelector = '[data-instatic-preference-output]'
    const ElementClass = window.Element
    let announcer: HTMLElement | null = null
    type PreferenceOrigin = { control: Element }
    type OriginAnimation = { origins: Map<VisitorPreferenceName, PreferenceOrigin> }
    const preferenceOrigins = new Map<VisitorPreferenceName, PreferenceOrigin>()
    const originAnimations = new WeakMap<Element, Map<string, OriginAnimation[]>>()
    const activeOriginAnimations = new Set<OriginAnimation>()
    const previousOriginAttributes = new Map<Element, string | null>()
    const originAttribute = 'data-instatic-preference-origin'

    function getState(): VisitorPreferencesState {
      return { ...resolve(config.defaults, overrides, { dark: dark.matches, reducedMotion: reducedMotion.matches }), status }
    }

    function readPatch(element: Element, attribute: string): VisitorPreferenceOverrides {
      const raw = element.getAttribute(attribute)
      if (raw === null) throw new Error('Missing native preference profile')
      const value: unknown = JSON.parse(raw)
      if (!validators.patch(value)) throw new Error('Invalid native preference profile')
      return value
    }

    function matches(patch: VisitorPreferenceOverrides, state: VisitorPreferencesState): boolean {
      return Object.entries(patch).every(([name, value]) => state.selected[name as VisitorPreferenceName] === value)
    }

    function toggleProfiles(element: Element) {
      const on = readPatch(element, 'data-instatic-preference-on')
      const off = readPatch(element, 'data-instatic-preference-off')
      const keys = Object.keys(on)
      if (keys.length !== Object.keys(off).length || keys.some(name => !Object.hasOwn(off, name))) throw new Error('Preference toggle profiles require identical preference names')
      if (keys.every(name => on[name as VisitorPreferenceName] === off[name as VisitorPreferenceName])) throw new Error('Preference toggle profiles must differ')
      return { on, off }
    }

    function announce(origin?: Element) {
      if (!origin?.matches(toggleSelector)) return
      const caption = origin.getAttribute('data-instatic-preference-status-' + status)
      if (!caption) throw new Error('Missing authored preference feedback')
      if (!announcer) {
        announcer = document.createElement('p')
        announcer.setAttribute('data-instatic-preference-announcer', '')
        announcer.setAttribute('role', 'status')
        document.body.append(announcer)
      }
      announcer.textContent = caption
    }

    function reflectOrigin(control: Element, names: string[], profileMatches = true) {
      if (!previousOriginAttributes.has(control)) previousOriginAttributes.set(control, control.getAttribute(originAttribute))
      const ownOrigin = profileMatches && names.every(name => preferenceOrigins.get(name as VisitorPreferenceName)?.control === control)
      const value = String(ownOrigin)
      if (control.getAttribute(originAttribute) !== value) control.setAttribute(originAttribute, value)
    }

    function restoreOrigin(control: Element, original: string | null) {
      if (control.ownerDocument !== document) return
      if (original === null) control.removeAttribute(originAttribute)
      else control.setAttribute(originAttribute, original)
    }

    function onOriginAnimationStart(event: AnimationEvent) {
      if (!(event.target instanceof ElementClass)) return
      const control = event.composedPath().find((item): item is Element => item instanceof ElementClass
        && (item.matches(controlSelector) || item.matches(toggleSelector))
        && item.getAttribute(originAttribute) === 'true')
      if (!control) return
      const origins = new Map([...preferenceOrigins].filter(([, origin]) => origin.control === control))
      if (!origins.size) return
      const target = event.target, key = event.animationName + '\0' + event.pseudoElement
      const runs = originAnimations.get(target) ?? new Map<string, OriginAnimation[]>()
      const queue = runs.get(key) ?? [], run = { origins }
      queue.push(run); runs.set(key, queue); originAnimations.set(target, runs)
      activeOriginAnimations.add(run)
    }

    function onOriginAnimationFinish(event: AnimationEvent) {
      if (!(event.target instanceof ElementClass)) return
      const runs = originAnimations.get(event.target), key = event.animationName + '\0' + event.pseudoElement
      const queue = runs?.get(key), run = queue?.shift()
      if (!run) return
      if (!queue!.length) runs!.delete(key)
      if (!runs!.size) originAnimations.delete(event.target)
      activeOriginAnimations.delete(run)
      let changed = false
      for (const [name, origin] of run.origins) {
        // Object identity distinguishes a later action on the same control.
        // An independent axis or another still-running effect keeps its origin.
        if (preferenceOrigins.get(name) !== origin) continue
        if ([...activeOriginAnimations].some(active => active.origins.get(name) === origin)) continue
        preferenceOrigins.delete(name)
        changed = true
      }
      if (changed) updateControls()
    }

    function updateControls(origin?: Element) {
      const state = getState()
      for (const [control, original] of previousOriginAttributes) if (!control.isConnected || control.ownerDocument !== document) {
        restoreOrigin(control, original)
        previousOriginAttributes.delete(control)
      }
      for (const control of document.querySelectorAll<HTMLElement>(controlSelector)) {
        const name = control.getAttribute('data-instatic-preference')
        if (!validators.name(name)) throw new Error('Invalid native preference control name')
        const select = control.querySelector<HTMLSelectElement>('select[data-instatic-preference-value]')
        // The synchronous head owner also sees parser additions while a
        // control's start tag exists but its select has not been parsed yet.
        if (!select) continue
        select.value = state.selected[name]
        select.disabled = false
        reflectOrigin(control, [name])
        const feedback = control.querySelector<HTMLElement>('[data-instatic-preference-feedback]')
        // Only the initiating control announces a user action; repeated controls
        // still reflect the state without announcing the same result twice.
        feedback?.setAttribute('aria-live', control === origin ? 'polite' : 'off')
        for (const caption of control.querySelectorAll<HTMLElement>('[data-instatic-preference-status]')) {
          caption.hidden = caption.getAttribute('data-instatic-preference-status') !== state.status
        }
      }
      for (const button of document.querySelectorAll<HTMLButtonElement>(toggleSelector)) {
        const profiles = toggleProfiles(button), active = matches(profiles.on, state)
        const suffix = active ? 'on' : 'off'
        const label = button.getAttribute('data-instatic-preference-label-' + suffix)
        const ariaLabel = button.getAttribute('data-instatic-preference-aria-label-' + suffix)
        const title = button.getAttribute('data-instatic-preference-title-' + suffix)
        if (label === null || ariaLabel === null || (!label.trim() && !ariaLabel.trim())) throw new Error('Missing authored preference toggle label')
        // The early owner may see an opening button before parser children.
        // Wait for its authored text node rather than inserting duplicate copy.
        if (label) {
          const first = button.firstChild
          if (!first || first.nodeType !== 3) continue
          if (first.nodeValue !== label) first.nodeValue = label
        }
        if (ariaLabel) button.setAttribute('aria-label', ariaLabel)
        else button.removeAttribute('aria-label')
        if (title) button.setAttribute('title', title)
        else button.removeAttribute('title')
        button.setAttribute('aria-pressed', String(active))
        button.setAttribute('data-instatic-preference-active', String(active))
        reflectOrigin(button, Object.keys(profiles.on), active || matches(profiles.off, state))
        button.disabled = false
      }
      for (const output of document.querySelectorAll<HTMLElement>(outputSelector)) {
        const active = matches(readPatch(output, 'data-instatic-preference-when'), state)
        const copy = output.getAttribute('data-instatic-preference-text-' + (active ? 'on' : 'off'))
        if (!copy?.trim()) throw new Error('Missing authored preference output copy')
        if (!output.firstChild && document.readyState === 'loading') continue
        if (output.textContent !== copy) output.textContent = copy
        output.setAttribute('data-instatic-preference-active', String(active))
      }
    }

    function updateDecorativeVideos() {
      const state = getState()
      for (const video of document.querySelectorAll<HTMLVideoElement>('video[data-instatic-decorative-src]')) {
        if (!managedVideos.has(video)) {
          const onMediaState = (event: Event) => {
            if (video.ownerDocument !== document || !video.isConnected || !video.hasAttribute('data-instatic-decorative-src')) return
            const preference = getState()
            const ready = event.type !== 'emptied' && event.type !== 'error' && video.error === null && !preference.reducedMedia && !preference.reducedMotion && video.readyState >= window.HTMLMediaElement.HAVE_CURRENT_DATA
            video.setAttribute('data-instatic-decorative-ready', String(ready))
          }
          managedVideos.set(video, { source: video.getAttribute('src'), preload: video.preload, autoplay: video.autoplay, ready: video.getAttribute('data-instatic-decorative-ready'), onMediaState })
          for (const name of ['loadeddata', 'emptied', 'error']) video.addEventListener(name, onMediaState)
        }
        const source = video.getAttribute('data-instatic-decorative-src')
        if (!source) throw new Error('Native decorative video is missing its source')
        if (state.reducedMedia || state.reducedMotion) {
          video.setAttribute('data-instatic-decorative-ready', 'false')
          video.autoplay = false
          video.preload = 'none'
          if (video.hasAttribute('src')) {
            video.pause()
            video.removeAttribute('src')
            video.load()
          }
        } else {
          video.setAttribute('preload', video.getAttribute('data-instatic-decorative-preload') ?? 'none')
          video.autoplay = video.getAttribute('data-instatic-decorative-autoplay') === 'true'
          if (video.getAttribute('src') !== source) {
            video.setAttribute('data-instatic-decorative-ready', 'false')
            video.setAttribute('src', source)
            video.load()
          } else {
            video.setAttribute('data-instatic-decorative-ready', String(video.error === null && video.readyState >= window.HTMLMediaElement.HAVE_CURRENT_DATA))
          }
        }
      }
      for (const [video, previous] of managedVideos) {
        if (video.ownerDocument !== document || !video.hasAttribute('data-instatic-decorative-src')) {
          // A content-role transition or another document owns the element now.
          for (const name of ['loadeddata', 'emptied', 'error']) video.removeEventListener(name, previous.onMediaState)
          if (video.ownerDocument === document) video.removeAttribute('data-instatic-decorative-ready')
          managedVideos.delete(video)
        } else if (!video.isConnected) {
          // Removing a media element does not itself stop its playback/download.
          video.pause()
          video.autoplay = false
          video.preload = 'none'
          video.removeAttribute('src')
          video.load()
          for (const name of ['loadeddata', 'emptied', 'error']) video.removeEventListener(name, previous.onMediaState)
          video.removeAttribute('data-instatic-decorative-ready')
          managedVideos.delete(video)
        }
      }
    }

    function apply(origin?: Element) {
      const state = getState()
      root.classList.toggle('theme-default', state.theme === 'default')
      root.classList.toggle('theme-alt', state.theme === 'alt')
      root.setAttribute('data-instatic-motion', state.reducedMotion ? 'reduced' : 'full')
      root.setAttribute('data-instatic-media', state.reducedMedia ? 'reduced' : 'full')
      updateControls(origin)
      updateDecorativeVideos()
      for (const listener of listeners) listener()
      document.dispatchEvent(new window.CustomEvent('instatic:visitor-preferences-change', { detail: state }))
      announce(origin)
    }

    function readStored(raw: string | null) {
      preferenceOrigins.clear()
      overrides = {}
      if (raw === null) { status = 'default'; return }
      try {
        const value: unknown = JSON.parse(raw)
        if (!validators.overrides(value)) throw new Error('Stored visitor preferences do not match their schema')
        overrides = value
        status = 'saved'
      } catch (error) {
        status = 'reset'
        console.warn('[visitor-preferences] Invalid stored preferences; explicit defaults restored:', error)
        try { window.localStorage.removeItem(storageKey) } catch (storageError) {
          status = 'unavailable'
          console.error('[visitor-preferences] Cannot remove invalid stored preferences:', storageError)
        }
      }
    }

    if (config.storage === 'persistent') {
      try { readStored(window.localStorage.getItem(storageKey)) } catch (error) {
        status = 'unavailable'
        console.error('[visitor-preferences] Cannot read stored preferences:', error)
      }
    }

    function set(patch: VisitorPreferenceOverrides, origin?: Element) {
      if (!validators.patch(patch)) throw new Error('Invalid visitor preference choice')
      const next = { ...overrides, ...patch }
      const attribution = origin ? { control: origin } : undefined
      for (const name of Object.keys(patch) as VisitorPreferenceName[]) {
        if (attribution) preferenceOrigins.set(name, attribution)
        else preferenceOrigins.delete(name)
      }
      overrides = next
      if (config.storage === 'memory') status = 'preview'
      else {
        try { window.localStorage.setItem(storageKey, JSON.stringify(overrides)); status = 'saved' } catch (error) {
          status = 'session'
          console.error('[visitor-preferences] Cannot save preferences; current document only:', error)
        }
      }
      apply(origin)
    }

    function onChange(event: Event) {
      const path = event.composedPath()
      const control = path.find((item): item is Element => item instanceof ElementClass && item.matches(controlSelector))
      if (!control || !path.some(item => item instanceof ElementClass && item.matches('select[data-instatic-preference-value]'))) return
      const name = control.getAttribute('data-instatic-preference')
      const select = control.querySelector<HTMLSelectElement>('select[data-instatic-preference-value]')
      try {
        if (!validators.name(name) || !select) throw new Error('Invalid native preference control')
        const patch: unknown = { [name]: select.value }
        if (!validators.patch(patch)) throw new Error('Invalid native preference control choice')
        set(patch, control)
      } catch (error) {
        status = 'invalid'
        console.error('[visitor-preferences] Cannot apply control choice:', error)
        apply(control)
      }
    }

    function onClick(event: MouseEvent) {
      const button = event.composedPath().find((item): item is HTMLButtonElement => item instanceof window.HTMLButtonElement && item.matches(toggleSelector))
      if (!button || button.disabled) return
      // Native button semantics already turn Enter and Space into click.
      const profiles = toggleProfiles(button)
      set(matches(profiles.on, getState()) ? profiles.off : profiles.on, button)
    }

    function onSystemChange() { apply() }
    function onStorage(event: StorageEvent) {
      if (config.storage !== 'persistent' || (event.key !== storageKey && event.key !== null)) return
      try { if (event.storageArea !== window.localStorage) return } catch (error) {
        status = 'unavailable'
        console.error('[visitor-preferences] Cannot synchronize saved preferences:', error)
        apply()
        return
      }
      readStored(event.newValue)
      apply()
    }

    const observer = new window.MutationObserver(() => { updateControls(); updateDecorativeVideos() })
    observer.observe(root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-instatic-decorative-src', 'data-instatic-decorative-preload', 'data-instatic-decorative-autoplay', 'data-instatic-preference', 'data-instatic-preference-on', 'data-instatic-preference-off', 'data-instatic-preference-when', 'data-instatic-preference-label-on', 'data-instatic-preference-label-off', 'data-instatic-preference-aria-label-on', 'data-instatic-preference-aria-label-off', 'data-instatic-preference-title-on', 'data-instatic-preference-title-off', 'data-instatic-preference-text-on', 'data-instatic-preference-text-off'],
    })
    document.addEventListener('change', onChange)
    document.addEventListener('click', onClick)
    document.addEventListener('animationstart', onOriginAnimationStart)
    document.addEventListener('animationend', onOriginAnimationFinish)
    document.addEventListener('animationcancel', onOriginAnimationFinish)
    dark.addEventListener('change', onSystemChange)
    reducedMotion.addEventListener('change', onSystemChange)
    window.addEventListener('storage', onStorage)
    const owner: VisitorPreferencesOwner = {
      getState,
      set,
      updateConfig(next) {
        if (!validators.config(next)) throw new Error('Invalid visitor preference runtime configuration')
        if (config.storage !== next.storage) throw new Error('A preference document cannot change its persistence mode')
        config = { defaults: { ...next.defaults }, storage: next.storage }
        apply()
      },
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    }
    installation = {
      users: 0,
      owner,
      dispose() {
        observer.disconnect()
        document.removeEventListener('change', onChange)
        document.removeEventListener('click', onClick)
        document.removeEventListener('animationstart', onOriginAnimationStart)
        document.removeEventListener('animationend', onOriginAnimationFinish)
        document.removeEventListener('animationcancel', onOriginAnimationFinish)
        announcer?.remove()
        dark.removeEventListener('change', onSystemChange)
        reducedMotion.removeEventListener('change', onSystemChange)
        window.removeEventListener('storage', onStorage)
        listeners.clear()
        preferenceOrigins.clear()
        activeOriginAnimations.clear()
        for (const [control, original] of previousOriginAttributes) restoreOrigin(control, original)
        previousOriginAttributes.clear()
        for (const [video, originalVideo] of managedVideos) {
          for (const name of ['loadeddata', 'emptied', 'error']) video.removeEventListener(name, originalVideo.onMediaState)
          if (video.ownerDocument !== document) continue
          if (!video.hasAttribute('data-instatic-decorative-src')) {
            video.removeAttribute('data-instatic-decorative-ready')
            continue
          }
          if (originalVideo.ready === null) video.removeAttribute('data-instatic-decorative-ready')
          else video.setAttribute('data-instatic-decorative-ready', originalVideo.ready)
          video.pause()
          if (originalVideo.source === null) video.removeAttribute('src')
          else video.setAttribute('src', originalVideo.source)
          video.preload = originalVideo.preload
          video.autoplay = originalVideo.autoplay
          video.load()
        }
        managedVideos.clear()
        root.classList.toggle('theme-default', original.defaultTheme)
        root.classList.toggle('theme-alt', original.altTheme)
        for (const [attribute, value] of [['data-instatic-motion', original.motion], ['data-instatic-media', original.media]] as const) {
          if (value === null) root.removeAttribute(attribute)
          else root.setAttribute(attribute, value)
        }
        delete host.__instaticVisitorPreferences
      },
    }
    host.__instaticVisitorPreferences = installation
    apply()
  } else installation.owner.updateConfig(rawConfig)

  installation.users += 1
  const installed = installation
  let released = false
  return {
    owner: installed.owner,
    release() {
      if (released) return
      released = true
      installed.users -= 1
      if (installed.users === 0) installed.dispose()
    },
  }
}
