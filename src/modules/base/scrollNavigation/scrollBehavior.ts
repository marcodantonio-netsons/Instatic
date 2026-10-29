/** Self-contained document installer emitted through ModuleDefinition.assets.js. */
export function installScrollRailBehavior(document: Document): () => void {
  const host = document as Document & { __instaticScrollRailBehavior?: { users: number; dispose: () => void } }
  let state = host.__instaticScrollRailBehavior
  if (!state) {
    const view = document.defaultView
    if (!view) throw new Error('Scroll rails require a browser document')
    const selector = '[data-instatic-scroll-rail]'
    type RailState = { controls: HTMLElement | null; generatedId: boolean; buttons: Map<HTMLButtonElement, string | null>; observedChild: Element | null }
    const rails = new Map<HTMLElement, RailState>()
    let identifier = 0, frame = 0
    let drag: { rail: HTMLElement; pointerId: number; startX: number; startScrollLeft: number; moved: boolean } | undefined
    let suppressClick: HTMLElement | undefined
    const resized = new view.ResizeObserver(schedule)
    function generatedId() {
      let candidate: string
      do { candidate = 'instatic-scroll-rail-' + (++identifier) } while (document.getElementById(candidate))
      return candidate
    }
    function sync() {
      frame = 0
      for (const [rail, entry] of rails) if (!rail.isConnected) {
        resized.unobserve(rail)
        if (entry.observedChild) resized.unobserve(entry.observedChild)
        if (entry.generatedId) rail.removeAttribute('id')
        for (const [button, original] of entry.buttons) {
          if (original === null) button.removeAttribute('aria-controls')
          else button.setAttribute('aria-controls', original)
        }
        rails.delete(rail)
      }
      for (const rail of document.querySelectorAll<HTMLElement>(selector)) {
        let entry = rails.get(rail)
        const sibling = rail.nextElementSibling
        const controls = sibling instanceof view!.HTMLElement && sibling.matches('[data-instatic-scroll-controls]') ? sibling : null
        if (!entry) {
          const generated = !rail.id
          if (generated) rail.id = generatedId()
          entry = { controls, generatedId: generated, buttons: new Map(), observedChild: null }
          rails.set(rail, entry)
          resized.observe(rail)
        }
        if (entry.observedChild !== rail.firstElementChild) {
          if (entry.observedChild) resized.unobserve(entry.observedChild)
          entry.observedChild = rail.firstElementChild
          if (entry.observedChild) resized.observe(entry.observedChild)
        }
        entry.controls = controls
        for (const [button, original] of entry.buttons) if (!controls?.contains(button)) {
          if (original === null) button.removeAttribute('aria-controls')
          else button.setAttribute('aria-controls', original)
          entry.buttons.delete(button)
        }
        if (controls) {
          const overflow = rail.scrollWidth > rail.clientWidth + 1
          if (!overflow && controls.contains(document.activeElement)) rail.focus({ preventScroll: true })
          controls.hidden = !overflow
          for (const button of controls.querySelectorAll<HTMLButtonElement>('button[data-instatic-scroll-direction]')) {
            if (!entry.buttons.has(button)) entry.buttons.set(button, button.getAttribute('aria-controls'))
            button.setAttribute('aria-controls', rail.id)
          }
        }
      }
    }
    function schedule() { if (!frame) frame = view!.requestAnimationFrame(sync) }
    function element(event: Event) {
      return event.composedPath().find((item): item is HTMLElement => item instanceof view!.HTMLElement)
    }
    function onClick(event: MouseEvent) {
      const target = element(event)
      if (suppressClick && target && suppressClick.contains(target)) {
        event.preventDefault(); event.stopPropagation(); suppressClick = undefined; return
      }
      suppressClick = undefined
      const button = target?.closest<HTMLButtonElement>('button[data-instatic-scroll-direction]')
      if (!button || button.disabled || event.defaultPrevented) return
      const controls = button.closest('[data-instatic-scroll-controls]'), rail = controls?.previousElementSibling
      if (!(rail instanceof view!.HTMLElement) || !rail.matches(selector) || controls?.hasAttribute('hidden')) return
      const direction = button.getAttribute('data-instatic-scroll-direction') === 'previous' ? -1 : 1
      const ratio = Number(rail.getAttribute('data-instatic-scroll-step'))
      const minimum = Number(rail.getAttribute('data-instatic-scroll-minimum'))
      const reduced = document.documentElement.getAttribute('data-instatic-motion') === 'reduced' || view!.matchMedia('(prefers-reduced-motion: reduce)').matches
      rail.scrollBy({ left: direction * Math.max(rail.clientWidth * ratio, minimum), behavior: reduced ? 'instant' : 'smooth' })
    }
    function onPointerDown(event: PointerEvent) {
      if (event.defaultPrevented || (event.pointerType === 'mouse' && event.button !== 0)) return
      const rail = element(event)?.closest<HTMLElement>(selector)
      if (!rail || rail.getAttribute('data-instatic-scroll-drag') !== 'true') return
      suppressClick = undefined
      drag = { rail, pointerId: event.pointerId, startX: event.clientX, startScrollLeft: rail.scrollLeft, moved: false }
    }
    function onPointerMove(event: PointerEvent) {
      if (!drag || drag.pointerId !== event.pointerId) return
      const delta = event.clientX - drag.startX
      if (!drag.moved && Math.abs(delta) > 4) {
        drag.moved = true
        drag.rail.setAttribute('data-instatic-dragging', 'true')
        drag.rail.setPointerCapture(event.pointerId)
      }
      if (drag.moved) { event.preventDefault(); drag.rail.scrollLeft = drag.startScrollLeft - delta }
    }
    function onPointerEnd(event: PointerEvent) {
      if (!drag || drag.pointerId !== event.pointerId) return
      if (drag.moved && event.type !== 'pointercancel') suppressClick = drag.rail
      drag.rail.removeAttribute('data-instatic-dragging')
      if (drag.rail.hasPointerCapture(event.pointerId)) drag.rail.releasePointerCapture(event.pointerId)
      drag = undefined
    }
    const mutations = new view.MutationObserver(schedule)
    mutations.observe(document, { childList: true, subtree: true })
    document.addEventListener('click', onClick, true)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointermove', onPointerMove, { passive: false })
    document.addEventListener('pointerup', onPointerEnd)
    document.addEventListener('pointercancel', onPointerEnd)
    view.addEventListener('resize', schedule)
    sync()
    state = { users: 0, dispose() {
      if (frame) view.cancelAnimationFrame(frame)
      resized.disconnect(); mutations.disconnect()
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerEnd)
      document.removeEventListener('pointercancel', onPointerEnd)
      view.removeEventListener('resize', schedule)
      for (const [rail, entry] of rails) {
        rail.removeAttribute('data-instatic-dragging')
        if (entry.generatedId) rail.removeAttribute('id')
        for (const [button, original] of entry.buttons) {
          if (original === null) button.removeAttribute('aria-controls')
          else button.setAttribute('aria-controls', original)
        }
      }
      delete host.__instaticScrollRailBehavior
    } }
    host.__instaticScrollRailBehavior = state
  }
  state.users++
  const installed = state
  let released = false
  return () => { if (released) return; released = true; installed.users--; if (!installed.users) installed.dispose() }
}
