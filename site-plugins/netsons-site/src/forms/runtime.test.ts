import { describe, expect, it } from 'bun:test'
import { JSDOM } from 'jsdom'
import modules from './modules'
import { installFormRuntime } from './runtime'

function render(id: string, props: Record<string, unknown>, children: string[] = []): string {
  const module = modules.find(item => item.id === id)
  if (!module) throw new Error('Unknown form module: ' + id)
  return module.render({ ...module.defaults, ...props, routePath: '/example' }, children).html
}

function formHtml(): string {
  return render('netsons.site.form', { mode: 'local', formId: 'example' }, [
    render('netsons.site.input', { name: 'quantity', value: '3', queryParameter: 'qty' }),
    render('netsons.site.input', { name: 'destination', inputType: 'hidden', value: '/checkout?plan=a' }),
    '<output data-instatic-form-output="quantity"></output>',
  ])
}

function start(html = '') {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'https://example.invalid/example?qty=7' })
  installFormRuntime(dom.window as unknown as Window & typeof globalThis)
  return dom
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('form DOM lifecycle', () => {
  it('initializes a form inserted by a native fragment without a host event', async () => {
    const dom = start('<instatic-hole></instatic-hole>')
    try {
      dom.window.document.querySelector('instatic-hole')!.outerHTML = formHtml()
      await tick()
      const form = dom.window.document.querySelector('form')!
      expect(form.noValidate).toBe(true)
      expect(form.getAttribute('data-instatic-form-state')).toBe('idle')
      expect(form.querySelector('output')!.textContent).toBe('7')
    } finally { dom.window.close() }
  })

  it('binds outputs inserted into an existing form without resetting edited values', async () => {
    const dom = start(formHtml())
    try {
      const form = dom.window.document.querySelector('form')!
      const input = form.querySelector<HTMLInputElement>('[name="quantity"]')!
      input.value = '12'
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      form.insertAdjacentHTML('beforeend', '<output id="added" data-instatic-form-output="quantity"></output>')
      await tick()
      expect(form.querySelector('#added')!.textContent).toBe('12')
      expect(input.value).toBe('12')
    } finally { dom.window.close() }
  })

  it('binds a newly inserted external link to its owning form', async () => {
    const dom = start(formHtml())
    try {
      dom.window.document.body.insertAdjacentHTML('beforeend', '<a data-instatic-form-id="example" data-instatic-form-link="destination">Continue</a>')
      await tick()
      expect(dom.window.document.querySelector('a')!.getAttribute('href')).toBe('/checkout?plan=a')
    } finally { dom.window.close() }
  })

  it('does not reinitialize forms for unrelated DOM changes', async () => {
    const dom = start(formHtml())
    try {
      let updates = 0
      dom.window.document.addEventListener('instatic:form-values', () => { updates++ })
      dom.window.document.body.insertAdjacentHTML('beforeend', '<section><p>Unrelated content</p></section>')
      await tick()
      expect(updates).toBe(0)
    } finally { dom.window.close() }
  })
})
