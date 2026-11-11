/** One structural tab owner supplies keyboard, selection and locally generated ARIA identities. */
export function installTabsBehavior(document: Document): () => void {
  const host = document as Document & { __instaticTabsBehavior?: { users: number; dispose: () => void } }
  let state = host.__instaticTabsBehavior
  if (!state) {
    const view = document.defaultView
    if (!view) throw new Error('Tabs require a browser document')
    const initialized = new WeakSet<HTMLElement>()
    let identifier = 0
    function members(owner: HTMLElement) {
      const tabs = Array.from(owner.querySelectorAll<HTMLButtonElement>('[data-instatic-tab]')).filter(tab => tab.closest('[data-instatic-tabs]') === owner)
      const panels = Array.from(owner.querySelectorAll<HTMLElement>('[data-instatic-tab-panel]')).filter(panel => panel.closest('[data-instatic-tabs]') === owner)
      return { tabs, panels }
    }
    function activate(owner: HTMLElement, index: number, focus: boolean) {
      const { tabs, panels } = members(owner)
      if (tabs.length !== panels.length || !tabs[index]) throw new Error('Tabs require one ordered panel per tab')
      for (const [position, tab] of tabs.entries()) {
        const selected = position === index
        tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1
        panels[position].hidden = !selected
      }
      if (focus) tabs[index].focus()
    }
    function initialize() {
      for (const owner of document.querySelectorAll<HTMLElement>('[data-instatic-tabs]')) {
        if (initialized.has(owner)) continue
        const { tabs, panels } = members(owner)
        if (!tabs.length || tabs.length !== panels.length) throw new Error('Tabs require one ordered panel per tab')
        const selected = tabs.map((tab, index) => tab.getAttribute('aria-selected') === 'true' ? index : -1).filter(index => index >= 0)
        if (selected.length !== 1) throw new Error('Tabs require exactly one initial selection')
        for (const [index, tab] of tabs.entries()) {
          let base: string
          do { base = 'instatic-tab-' + (++identifier) } while (document.getElementById(base) || document.getElementById(base + '-panel'))
          tab.id = base; panels[index].id = base + '-panel'
          tab.setAttribute('aria-controls', panels[index].id)
          panels[index].setAttribute('aria-labelledby', tab.id)
        }
        activate(owner, selected[0], false)
        initialized.add(owner)
      }
    }
    function target(event: Event) { return event.composedPath().find((item): item is HTMLElement => item instanceof view!.HTMLElement)?.closest<HTMLButtonElement>('[data-instatic-tab]') }
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented) return
      const link = event.composedPath().find((item): item is HTMLElement => item instanceof view!.HTMLElement)?.closest<HTMLAnchorElement>('a[data-instatic-tab-link]')
      if (link) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute('download') || link.target && link.target !== '_self') return
        const groupId = link.getAttribute('data-instatic-tab-link'), key = link.getAttribute('data-instatic-target-tab')
        const groups = Array.from(document.querySelectorAll<HTMLElement>('[data-instatic-tabs]')).filter(owner => owner.getAttribute('data-instatic-tabs-group') === groupId)
        if (!groupId || !key || groups.length !== 1) throw new Error('Tab links require one authored target group and key')
        const index = members(groups[0]).tabs.findIndex(tab => tab.getAttribute('data-instatic-tab-key') === key)
        if (index < 0) throw new Error('Tab link target is not present')
        activate(groups[0], index, false)
        return
      }
      const tab = target(event), owner = tab?.closest<HTMLElement>('[data-instatic-tabs]')
      if (!tab || !owner || tab.disabled) return
      activate(owner, members(owner).tabs.indexOf(tab), false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return
      const tab = target(event), owner = tab?.closest<HTMLElement>('[data-instatic-tabs]')
      if (!tab || !owner || tab.disabled) return
      const { tabs } = members(owner), index = tabs.indexOf(tab)
      let next: number
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = tabs.length - 1
      else return
      event.preventDefault(); activate(owner, next, true)
    }
    const mutations = new view.MutationObserver(initialize)
    mutations.observe(document, { childList: true, subtree: true })
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKeyDown)
    initialize()
    state = { users: 0, dispose() {
      mutations.disconnect()
      document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKeyDown)
      delete host.__instaticTabsBehavior
    } }
    host.__instaticTabsBehavior = state
  }
  state.users++
  const installed = state
  let released = false
  return () => { if (released) return; released = true; installed.users--; if (!installed.users) installed.dispose() }
}
