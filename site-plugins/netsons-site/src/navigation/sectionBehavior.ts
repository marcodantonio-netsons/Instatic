/** Ordinary fragment links stay native; this installer only marks the current section. */
export function installSectionNavBehavior(document: Document): () => void {
  const host = document as Document & { __instaticSectionNavBehavior?: { users: number; dispose: () => void } }
  let state = host.__instaticSectionNavBehavior
  if (!state) {
    const view = document.defaultView
    if (!view) throw new Error('Section navigation requires a browser document')
    const originals = new Map<HTMLAnchorElement, string | null>()
    let frame = 0
    function update() {
      frame = 0
      for (const [link, original] of originals) if (!link.isConnected) {
        if (original === null) link.removeAttribute('aria-current')
        else link.setAttribute('aria-current', original)
        originals.delete(link)
      }
      for (const nav of document.querySelectorAll<HTMLElement>('[data-instatic-section-nav]')) {
        const offset = Number(nav.getAttribute('data-instatic-section-offset'))
        const entries = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')).filter(link => link.closest('[data-instatic-section-nav]') === nav).map(link => ({ link, section: document.getElementById(link.hash.slice(1)) })).filter(entry => entry.section)
        let active = entries[0]
        for (const entry of entries) if (entry.section!.getBoundingClientRect().top <= offset) active = entry
        for (const entry of entries) {
          if (!originals.has(entry.link)) originals.set(entry.link, entry.link.getAttribute('aria-current'))
          if (entry === active) entry.link.setAttribute('aria-current', 'location')
          else entry.link.removeAttribute('aria-current')
        }
      }
    }
    function schedule() { if (!frame) frame = view!.requestAnimationFrame(update) }
    const mutations = new view.MutationObserver(schedule)
    mutations.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'id'] })
    view.addEventListener('scroll', schedule, { passive: true, capture: true })
    view.addEventListener('resize', schedule)
    update()
    state = { users: 0, dispose() {
      if (frame) view.cancelAnimationFrame(frame)
      mutations.disconnect()
      view.removeEventListener('scroll', schedule, true)
      view.removeEventListener('resize', schedule)
      for (const [link, original] of originals) {
        if (original === null) link.removeAttribute('aria-current')
        else link.setAttribute('aria-current', original)
      }
      delete host.__instaticSectionNavBehavior
    } }
    host.__instaticSectionNavBehavior = state
  }
  state.users++
  const installed = state
  let released = false
  return () => { if (released) return; released = true; installed.users--; if (!installed.users) installed.dispose() }
}
