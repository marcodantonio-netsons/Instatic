/** Shared canvas/public installer. It changes state attributes, never layout styles. */
export function installScrollStateBehavior(document: Document): () => void {
  const host = document as Document & { __instaticScrollStateBehavior?: { users: number; dispose: () => void } }
  let state = host.__instaticScrollStateBehavior
  if (!state) {
    const view = document.defaultView
    if (!view) throw new Error('Scroll state requires a browser document')
    const originals = new Map<HTMLElement, { state: string | null; motion: string | null }>()
    const observed = new Set<Element>()
    const motion = view.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    function restore(element: HTMLElement, original: { state: string | null; motion: string | null }) {
      if (original.state === null) element.removeAttribute('data-instatic-scroll-state')
      else element.setAttribute('data-instatic-scroll-state', original.state)
      if (original.motion === null) element.removeAttribute('data-instatic-scroll-motion')
      else element.setAttribute('data-instatic-scroll-motion', original.motion)
    }
    function update() {
      frame = 0
      const nextObserved = new Set<Element>([document.documentElement])
      if (document.body) nextObserved.add(document.body)
      for (const [element, original] of originals) if (!element.isConnected) { restore(element, original); originals.delete(element) }
      const reduced = document.documentElement.getAttribute('data-instatic-motion') === 'reduced' || motion.matches
      for (const element of document.querySelectorAll<HTMLElement>('[data-instatic-scroll-state]')) {
        if (!originals.has(element)) originals.set(element, { state: element.getAttribute('data-instatic-scroll-state'), motion: element.getAttribute('data-instatic-scroll-motion') })
        const targetId = element.getAttribute('data-instatic-scroll-target'), edge = element.getAttribute('data-instatic-scroll-edge'), offsetValue = element.getAttribute('data-instatic-scroll-offset'), offset = Number(offsetValue)
        const targets = targetId && /^[A-Za-z][A-Za-z0-9_.:-]*$/.test(targetId) ? document.querySelectorAll<HTMLElement>(`[id="${targetId}"]`) : []
        const target = targets.length === 1 ? targets[0] : null
        let next = 'unresolved'
        if (target && target !== element && offsetValue !== null && Number.isFinite(offset) && (edge === 'start' || edge === 'end')) {
          nextObserved.add(target)
          const bounds = target.getBoundingClientRect()
          next = (edge === 'start' ? bounds.top : bounds.bottom) <= offset ? 'after' : 'before'
        }
        if (element.getAttribute('data-instatic-scroll-state') !== next) element.setAttribute('data-instatic-scroll-state', next)
        const preference = reduced ? 'reduced' : 'full'
        if (element.getAttribute('data-instatic-scroll-motion') !== preference) element.setAttribute('data-instatic-scroll-motion', preference)
      }
      for (const target of observed) if (!nextObserved.has(target)) { sizes.unobserve(target); observed.delete(target) }
      for (const target of nextObserved) if (!observed.has(target)) { sizes.observe(target); observed.add(target) }
    }
    function schedule() { if (!frame) frame = view!.requestAnimationFrame(update) }
    const sizes = new view.ResizeObserver(schedule)
    const mutations = new view.MutationObserver(schedule)
    mutations.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['id', 'data-instatic-scroll-target', 'data-instatic-scroll-edge', 'data-instatic-scroll-offset', 'data-instatic-motion'] })
    view.addEventListener('scroll', schedule, { passive: true, capture: true })
    view.addEventListener('resize', schedule)
    document.addEventListener('load', schedule, true)
    document.addEventListener('instatic:content', schedule)
    document.fonts?.addEventListener('loadingdone', schedule)
    motion.addEventListener('change', schedule)
    update()
    state = { users: 0, dispose() {
      if (frame) view.cancelAnimationFrame(frame)
      sizes.disconnect(); mutations.disconnect()
      view.removeEventListener('scroll', schedule, true)
      view.removeEventListener('resize', schedule)
      document.removeEventListener('load', schedule, true)
      document.removeEventListener('instatic:content', schedule)
      document.fonts?.removeEventListener('loadingdone', schedule)
      motion.removeEventListener('change', schedule)
      for (const [element, original] of originals) restore(element, original)
      delete host.__instaticScrollStateBehavior
    } }
    host.__instaticScrollStateBehavior = state
  }
  state.users++
  const installed = state
  let released = false
  return () => { if (released) return; released = true; installed.users--; if (!installed.users) installed.dispose() }
}
