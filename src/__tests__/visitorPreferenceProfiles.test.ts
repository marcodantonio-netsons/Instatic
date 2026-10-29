import { describe, expect, it, spyOn } from 'bun:test'
import { GlobalWindow } from 'happy-dom'
import { PreferenceModule, PreferenceToggleModule, PreferenceOutputModule } from '@modules/base/preference'
import { installVisitorPreferences, resolveVisitorPreferences, visitorPreferencesValidators, VISITOR_PREFERENCES_RUNTIME_JS, VISITOR_PREFERENCES_CONFIG_ATTRIBUTE } from '@core/visitor-preferences'
import { DEFAULT_SITE_VISITOR_PREFERENCES } from '@core/visitor-preferences-schema'

const on = { theme: 'alt', motion: 'reduced', media: 'reduced' } as const
const off = { theme: 'default', motion: 'system', media: 'full' } as const
const props = { ...PreferenceToggleModule.defaults, on, off, labelOn: 'Standard ', labelOff: 'Reduced ', titleOn: 'Use standard display', titleOff: 'Use reduced display', savedStatus: 'Saved profile' }
function fixture(storage: 'persistent' | 'memory' = 'memory') {
  const window = new GlobalWindow({ url: 'http://localhost/preferences-profiles' })
  const storageOwner = window.localStorage
  Object.defineProperty(window, 'localStorage', { value: storageOwner, configurable: true })
  window.document.body.innerHTML = PreferenceToggleModule.render(props, ['<i>icon</i>']).html + PreferenceToggleModule.render({ ...props, labelOn: '', labelOff: '', ariaLabelOn: 'Use standard', ariaLabelOff: 'Use reduced', titleOn: '', titleOff: '' }, ['<i>leaf</i>']).html + PreferenceOutputModule.render({ ...PreferenceOutputModule.defaults, when: on, textOn: 'Reduced profile', textOff: 'Other profile', tag: 'strong' }, []).html + PreferenceModule.render(PreferenceModule.defaults, []).html
  const lease = installVisitorPreferences(window.document, { defaults: DEFAULT_SITE_VISITOR_PREFERENCES, storage }, visitorPreferencesValidators, resolveVisitorPreferences)
  return { window, lease }
}

describe('native preference profiles', () => {
  it('validates the complete patch before state, persistence or event changes', () => {
    const { window, lease } = fixture('persistent')
    const writes = spyOn(window.Storage.prototype, 'setItem')
    let events = 0
    window.document.addEventListener('instatic:visitor-preferences-change', () => { events++ })
    const before = lease.owner.getState()
    try {
      for (const invalid of [{ theme: 'alt', media: 'invalid' }, {}, { other: 'alt' }, { theme: 'alt', motion: 'full' }]) {
        expect(() => Reflect.apply(lease.owner.set, lease.owner, [invalid])).toThrow('Invalid visitor preference choice')
        expect(lease.owner.getState()).toEqual(before)
      }
      expect(writes).toHaveBeenCalledTimes(0)
      expect(events).toBe(0)
      lease.owner.set(on)
      expect(writes).toHaveBeenCalledTimes(1)
      expect(events).toBe(1)
      expect(lease.owner.getState().selected).toEqual(on)
    } finally { writes.mockRestore(); lease.release(); window.happyDOM.close() }
  })

  it('synchronizes two semantic buttons and exact-tag output without replacing children', async () => {
    const { window, lease } = fixture()
    const buttons = [...window.document.querySelectorAll('button')], output = window.document.querySelector('strong')!, icon = buttons[0].querySelector('i')!
    try {
      expect(buttons.every(button => button.type === 'button' && !button.disabled)).toBe(true)
      expect(buttons[0].title).toBe('Use reduced display')
      expect(buttons[1].hasAttribute('title')).toBe(false)
      lease.owner.set({ theme: 'alt' })
      expect(buttons[0].getAttribute('aria-pressed')).toBe('false')
      expect(output.textContent).toBe('Other profile')
      buttons[0].click()
      expect(lease.owner.getState().selected).toEqual(on)
      expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['true','true'])
      expect(buttons[0].firstChild?.textContent).toBe('Standard ')
      expect(buttons[0].querySelector('i')).toBe(icon)
      expect(buttons[1].getAttribute('aria-label')).toBe('Use standard')
      expect(buttons[0].title).toBe('Use standard display')
      expect(buttons[1].hasAttribute('title')).toBe(false)
      expect(output.textContent).toBe('Reduced profile')
      expect(output.tagName).toBe('STRONG')
      expect(window.document.querySelector('select')?.value).toBe('alt')
      const added = window.document.createElement('div')
      added.innerHTML = PreferenceOutputModule.render({ ...PreferenceOutputModule.defaults, when: on, textOn: 'Late active', textOff: 'Late inactive' }, []).html
      window.document.body.append(added)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(added.firstElementChild?.textContent).toBe('Late active')
      buttons[1].click()
      expect(lease.owner.getState().selected).toEqual(off)
      expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['false','false'])
      expect(output.textContent).toBe('Other profile')
      expect(buttons[0].title).toBe('Use reduced display')
      const select = window.document.querySelector('select')!
      expect(select.value).toBe('default')
      select.value = 'alt'
      select.dispatchEvent(new window.Event('change', { bubbles: true }))
      expect(lease.owner.getState().selected).toEqual({ ...off, theme: 'alt' })
      expect(output.textContent).toBe('Other profile')
      expect(buttons[0].getAttribute('aria-pressed')).toBe('false')
      buttons[0].setAttribute('data-instatic-preference-title-off', 'Updated authored title')
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(buttons[0].title).toBe('Updated authored title')
    } finally { lease.release(); window.happyDOM.close() }
  })

  it('uses the same owner for memory leases and exposes native button activation only', () => {
    const { window, lease } = fixture()
    const next = installVisitorPreferences(window.document, { defaults: DEFAULT_SITE_VISITOR_PREFERENCES, storage: 'memory' }, visitorPreferencesValidators, resolveVisitorPreferences)
    const writes = spyOn(window.Storage.prototype, 'setItem'), button = window.document.querySelector('button')!
    let events = 0
    window.document.addEventListener('instatic:visitor-preferences-change', () => { events++ })
    try {
      expect(next.owner).toBe(lease.owner)
      button.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      expect(events).toBe(0)
      // User agents activate native buttons with click for Enter/Space; no
      // duplicate key handler is installed by the preference capability.
      button.click()
      expect(events).toBe(1)
      expect(writes).toHaveBeenCalledTimes(0)
      expect(next.owner.getState().status).toBe('preview')
      expect(window.document.querySelector('[role="status"]')?.textContent).toBe(props.previewStatus)
    } finally { writes.mockRestore(); next.release(); lease.release(); window.happyDOM.close() }
  })

  it('emits one self-contained native installer containing no language token resolution', () => {
    expect(VISITOR_PREFERENCES_RUNTIME_JS).toContain('data-instatic-preference-output')
    expect(VISITOR_PREFERENCES_RUNTIME_JS).not.toContain('site.translations')
    expect(VISITOR_PREFERENCES_RUNTIME_JS).not.toContain('netsons')
  })
})

function originFixture(storage: 'persistent' | 'memory' = 'memory', savedTheme?: 'alt') {
  const window = new GlobalWindow({ url: 'http://localhost/preference-origins' })
  const storageOwner = window.localStorage
  Object.defineProperty(window, 'localStorage', { value: storageOwner, configurable: true })
  if (savedTheme) window.localStorage.setItem('instatic.site-preferences', JSON.stringify({ theme: savedTheme }))
  const themeToggle = { ...props, on: { theme: 'alt' as const }, off: { theme: 'default' as const } }
  const button = PreferenceToggleModule.render(themeToggle, ['<i>icon</i>']).html
  window.document.body.innerHTML = '<header>' + button + button + '</header><footer>' + button + '</footer>' + PreferenceModule.render({ ...PreferenceModule.defaults, preference: 'motion' }, []).html
  const lease = installVisitorPreferences(window.document, { defaults: DEFAULT_SITE_VISITOR_PREFERENCES, storage }, visitorPreferencesValidators, resolveVisitorPreferences)
  const buttons = [...window.document.querySelectorAll('button')]
  return { window, lease, buttons }
}

describe('document-local native preference origin', () => {
  const marker = 'data-instatic-preference-origin'
  const headerEffect = 'header:has(button[aria-pressed="true"][data-instatic-preference-origin="true"]) i'
  function animation(window: GlobalWindow, target: Element, type: 'animationstart' | 'animationend' | 'animationcancel', name = 'authored-effect', pseudoElement = '') {
    // Happy DOM does not run CSS animations; dispatch their native event shape.
    const event = new window.Event(type, { bubbles: true })
    Object.defineProperties(event, { animationName: { value: name }, pseudoElement: { value: pseudoElement } })
    target.dispatchEvent(event)
  }

  it('releases a finished interaction effect without changing state, persistence or another axis', async () => {
    const { window, lease, buttons } = originFixture('persistent')
    try {
      const motion = window.document.querySelector('select')!, icon = buttons[0].querySelector('i')!
      buttons[0].click()
      motion.value = 'reduced'; motion.dispatchEvent(new window.Event('change', { bubbles: true }))
      const motionControl = motion.closest('[data-instatic-preference-control]')!
      const state = lease.owner.getState(), saved = window.localStorage.getItem('instatic.site-preferences')
      let changes = 0
      window.document.addEventListener('instatic:visitor-preferences-change', () => { changes++ })
      animation(window, icon, 'animationstart')
      animation(window, icon, 'animationend')
      expect(buttons[0].getAttribute(marker)).toBe('false')
      expect(motionControl.getAttribute(marker)).toBe('true')
      expect(lease.owner.getState()).toEqual(state)
      expect(window.localStorage.getItem('instatic.site-preferences')).toBe(saved)
      expect(changes).toBe(0)
      window.document.body.append(window.document.createElement('p'))
      await new Promise(resolve => setTimeout(resolve, 0))
      animation(window, icon, 'animationstart')
      expect(buttons[0].getAttribute(marker)).toBe('false')
      expect(window.document.querySelectorAll(headerEffect)).toHaveLength(0)
    } finally { lease.release(); window.happyDOM.close() }
  })

  it('waits for all originating subtree effects and handles cancellation without unrelated event attribution', () => {
    const { window, lease, buttons } = originFixture()
    try {
      buttons[0].click()
      const icon = buttons[0].querySelector('i')!, other = buttons[1].querySelector('i')!
      animation(window, icon, 'animationstart', 'first-effect')
      animation(window, icon, 'animationstart', 'second-effect', '::before')
      animation(window, other, 'animationstart', 'first-effect')
      animation(window, other, 'animationend', 'first-effect')
      expect(buttons[0].getAttribute(marker)).toBe('true')
      animation(window, icon, 'animationend', 'first-effect')
      expect(buttons[0].getAttribute(marker)).toBe('true')
      animation(window, icon, 'animationcancel', 'second-effect', '::before')
      expect(buttons[0].getAttribute(marker)).toBe('false')
      expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
    } finally { lease.release(); window.happyDOM.close() }
  })

  it('does not let a late effect event clear another control or a later action on the same control', () => {
    const { window, lease, buttons } = originFixture()
    try {
      const first = buttons[0].querySelector('i')!, second = buttons[1].querySelector('i')!
      buttons[0].click(); animation(window, first, 'animationstart')
      buttons[1].click(); animation(window, second, 'animationstart')
      animation(window, first, 'animationend')
      expect(buttons[1].getAttribute(marker)).toBe('true')
      animation(window, second, 'animationcancel')
      expect(buttons[1].getAttribute(marker)).toBe('false')
      buttons[0].click(); animation(window, first, 'animationstart')
      buttons[0].click(); buttons[0].click(); animation(window, first, 'animationstart')
      animation(window, first, 'animationcancel')
      expect(buttons[0].getAttribute(marker)).toBe('true')
      animation(window, first, 'animationend')
      expect(buttons[0].getAttribute(marker)).toBe('false')
    } finally { lease.release(); window.happyDOM.close() }
  })

  it('uses the same event lifecycle in the self-contained published runtime', () => {
    const window = new GlobalWindow({ url: 'http://localhost/published-preferences' })
    window.document.body.innerHTML = PreferenceToggleModule.render({ ...props, on: { theme: 'alt' }, off: { theme: 'default' } }, ['<i>icon</i>']).html
    window.document.documentElement.setAttribute(VISITOR_PREFERENCES_CONFIG_ATTRIBUTE, JSON.stringify({ defaults: DEFAULT_SITE_VISITOR_PREFERENCES, storage: 'memory' }))
    const lease = new Function('document', 'return ' + VISITOR_PREFERENCES_RUNTIME_JS)(window.document) as { release: () => void }
    try {
      const button = window.document.querySelector('button')!, icon = button.querySelector('i')!
      button.click(); animation(window, icon, 'animationstart')
      expect(button.getAttribute(marker)).toBe('true')
      animation(window, icon, 'animationend')
      expect(button.getAttribute(marker)).toBe('false')
      expect(button.getAttribute('aria-pressed')).toBe('true')
      expect(window.document.documentElement.classList.contains('theme-alt')).toBe(true)
    } finally { lease.release(); window.happyDOM.close() }
  })

  it('retains the exact originating element across parser/mutation refreshes and unrelated axes', async () => {
    const { window, lease, buttons } = originFixture()
    try {
      expect(buttons.map(button => button.getAttribute(marker))).toEqual(['false', 'false', 'false'])
      lease.owner.set({ motion: 'reduced', media: 'reduced' })
      buttons[0].click()
      expect(lease.owner.getState().selected).toEqual({ theme: 'alt', motion: 'reduced', media: 'reduced' })
      expect(buttons.map(button => button.getAttribute(marker))).toEqual(['true', 'false', 'false'])
      expect(window.document.querySelectorAll(headerEffect)).toHaveLength(2)
      const added = window.document.createElement('p')
      added.textContent = 'Late content'
      window.document.body.append(added)
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(buttons[0].getAttribute(marker)).toBe('true')
      const select = window.document.querySelector('select')!
      select.value = 'system'
      select.dispatchEvent(new window.Event('change', { bubbles: true }))
      expect(buttons[0].getAttribute(marker)).toBe('true')
      expect(select.closest('[data-instatic-preference-control]')?.getAttribute(marker)).toBe('true')
      expect(lease.owner.getState().selected.media).toBe('reduced')
      expect(window.document.querySelectorAll(headerEffect)).toHaveLength(2)
    } finally { lease.release(); window.happyDOM.close() }
  })

  it('transfers overlapping attribution, so remote controls cannot restart another group effect', () => {
    const { window, lease, buttons } = originFixture()
    try {
      buttons[0].click()
      expect(window.document.querySelectorAll(headerEffect)).toHaveLength(2)
      buttons[1].click()
      expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false'])
      expect(window.document.querySelectorAll(headerEffect)).toHaveLength(0)
      buttons[2].click()
      expect(buttons.map(button => button.getAttribute(marker))).toEqual(['false', 'false', 'true'])
      expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['true', 'true', 'true'])
      expect(window.document.querySelectorAll(headerEffect)).toHaveLength(0)
      buttons[0].click()
      buttons[1].click()
      expect(window.document.querySelectorAll(headerEffect)).toHaveLength(2)
      expect(buttons[1].getAttribute(marker)).toBe('true')
    } finally { lease.release(); window.happyDOM.close() }
  })

  it('does not attribute saved, programmatic, storage-synchronized or reinstalled state to native UI', () => {
    const { window, lease, buttons } = originFixture('persistent', 'alt')
    try {
      expect(buttons.every(button => button.getAttribute('aria-pressed') === 'true')).toBe(true)
      expect(buttons.every(button => button.getAttribute(marker) === 'false')).toBe(true)
      expect(window.document.querySelectorAll(headerEffect)).toHaveLength(0)
      buttons[0].click()
      buttons[0].click()
      expect(buttons[0].getAttribute(marker)).toBe('true')
      expect(() => Reflect.apply(lease.owner.set, lease.owner, [{}])).toThrow('Invalid visitor preference choice')
      expect(buttons[0].getAttribute(marker)).toBe('true')
      lease.owner.set({ theme: 'alt' })
      expect(buttons.every(button => button.getAttribute(marker) === 'false')).toBe(true)
      buttons[0].click()
      window.dispatchEvent(new window.StorageEvent('storage', { key: 'instatic.site-preferences', newValue: JSON.stringify({ theme: 'alt' }), storageArea: window.localStorage }))
      expect(buttons.every(button => button.getAttribute(marker) === 'false')).toBe(true)
      expect(window.document.querySelectorAll(headerEffect)).toHaveLength(0)
      expect(window.localStorage.getItem('instatic.site-preferences')).not.toContain('origin')
      lease.release()
      const next = installVisitorPreferences(window.document, { defaults: DEFAULT_SITE_VISITOR_PREFERENCES, storage: 'persistent' }, visitorPreferencesValidators, resolveVisitorPreferences)
      try { expect(buttons.every(button => button.getAttribute(marker) === 'false')).toBe(true) }
      finally { next.release() }
    } finally { lease.release(); window.happyDOM.close() }
  })

  it('restores owner-managed attributes on removal/disposal and reserves them from authored attributes', async () => {
    const { window, lease, buttons } = originFixture()
    const selectControl = window.document.querySelector('[data-instatic-preference-control]')!
    try {
      buttons[0].click()
      buttons[0].remove()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(buttons[0].getAttribute(marker)).toBe('false')
      lease.release()
      expect(buttons[1].getAttribute(marker)).toBe('false')
      expect(selectControl.hasAttribute(marker)).toBe(false)
      const html = PreferenceToggleModule.render({ ...props, htmlAttributes: { [marker]: 'true' } }, []).html
      expect(html.match(/data-instatic-preference-origin=/g)).toHaveLength(1)
      expect(html).toContain('data-instatic-preference-origin="false"')
      expect(VISITOR_PREFERENCES_RUNTIME_JS).toContain(marker)
      expect(VISITOR_PREFERENCES_RUNTIME_JS).not.toContain('headerEcoNeon')
    } finally { lease.release(); window.happyDOM.close() }
  })
})
