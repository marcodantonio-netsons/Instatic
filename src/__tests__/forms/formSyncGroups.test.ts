import { describe, expect, it } from 'bun:test'
import { Window } from 'happy-dom'
import '@modules/base'
import { FormModule, InputModule, RadioModule, FormConditionalModule, FormOutputModule } from '@modules/base/forms'
import { FORM_RUNTIME_JS } from '@modules/base/forms/formRuntimeJs'
import { assertSiteForms, validateFormSubmission } from '@core/forms'
import { DataTableSchema } from '@core/data/schemas'
import { Value } from '@sinclair/typebox/value'
import { makeNode, makePage, makeSite } from '../fixtures'

function controls() {
  return [InputModule.render({ ...InputModule.defaults, name: 'amount', inputType: 'range', min: '0', max: '3', step: '1', value: '0', syncGroup: 'choice', queryParameter: 'amount' }, []).html,
    ...[0, 1, 2, 3].map((value) => RadioModule.render({ ...RadioModule.defaults, name: 'choice', value: String(value), checked: value === 0, syncGroup: 'choice' }, []).html),
    FormConditionalModule.render({ condition: { field: 'amount', eq: '3' } }, ['<p>Last choice</p>']).html,
    FormOutputModule.render({ ...FormOutputModule.defaults, fieldName: 'choice', text: '' }, []).html]
}
function form(identity: string) { return FormModule.render({ ...FormModule.defaults, mode: 'custom', enhance: true, formId: identity, action: '/submit' }, controls()).html }
function model() {
  const page = makePage({ nodes: {
    root: makeNode({ id: 'root', moduleId: 'base.body', children: ['form'] }),
    form: makeNode({ id: 'form', moduleId: 'base.form', props: { mode: 'custom', enhance: true, formId: 'choice' }, children: ['amount', 'first', 'second'] }),
    amount: makeNode({ id: 'amount', moduleId: 'base.input', props: { name: 'amount', inputType: 'range', min: '0', max: '1', step: '1', value: '0', syncGroup: 'choice' } }),
    first: makeNode({ id: 'first', moduleId: 'base.radio', props: { fieldId: 'choice', name: 'choice', value: '0', checked: true, syncGroup: 'choice' } }),
    second: makeNode({ id: 'second', moduleId: 'base.radio', props: { fieldId: 'choice', name: 'choice', value: '1', checked: false, syncGroup: 'choice' } }),
  } })
  return { page, site: makeSite({ pages: [page] }) }
}

describe('native form shared value groups', () => {
  it('synchronizes radio and range before conditions, keeps radio values, and isolates forms and resets', async () => {
    const realm = new Window({ url: 'https://site.example/?amount=1', settings: { disableJavaScriptFileLoading: true } })
    const browser = realm as unknown as globalThis.Window & typeof globalThis
    browser.document.body.innerHTML = form('first') + form('second')
    try {
      browser.eval(FORM_RUNTIME_JS)
      const [first, second] = Array.from(browser.document.forms)
      const range = first.querySelector<HTMLInputElement>('input[type="range"]')!
      const radios = Array.from(first.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      expect(range.value).toBe('1')
      expect(radios.map((radio) => radio.checked)).toEqual([false, true, false, false])
      radios[3].checked = true; radios[3].dispatchEvent(new browser.Event('change', { bubbles: true }))
      expect(range.value).toBe('3')
      expect(first.querySelector<HTMLElement>('[data-instatic-form-condition]')!.hidden).toBe(false)
      expect(first.querySelector('output')!.textContent).toBe('3')
      expect(second.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe('1')
      range.value = '2'; range.dispatchEvent(new browser.Event('input', { bubbles: true }))
      expect(radios.map((radio) => radio.checked)).toEqual([false, false, true, false])
      expect(radios.map((radio) => radio.value)).toEqual(['0', '1', '2', '3'])
      expect(first.querySelector<HTMLElement>('[data-instatic-form-condition]')!.hidden).toBe(true)
      first.reset(); await new Promise((resolve) => setTimeout(resolve, 0))
      expect(range.value).toBe('1')
      expect(radios.map((radio) => radio.checked)).toEqual([false, true, false, false])
      expect(first.querySelector('output')!.textContent).toBe('1')
    } finally { await realm.happyDOM.close() }
  })

  it('rejects contradictory authoring while ignoring unchecked radio literals in the initial value', () => {
    const { page, site } = model()
    expect(() => assertSiteForms(site)).not.toThrow()
    page.nodes.amount.props.value = '1'
    expect(() => assertSiteForms(site)).toThrow('same initial value')
    page.nodes.amount.props.value = '0'; page.nodes.second.props.value = '2'
    expect(() => assertSiteForms(site)).toThrow('match every offered choice')
    page.nodes.second.props.value = '1'; page.nodes.amount.props.resetBehavior = 'preserve'
    expect(() => assertSiteForms(site)).toThrow('one initial or preserve reset policy')
    page.nodes.amount.props.resetBehavior = 'initial'; page.nodes.amount.props.valueSourceField = 'choice'
    expect(() => assertSiteForms(site)).toThrow('cannot mirror or lock')
  })

  it('validates shared group consistency in CMS submissions', () => {
    const table = { ...Value.Create(DataTableSchema), fields: ['amount', 'choice'].map((id) => ({ id, label: id, type: 'text' as const })) }
    const controls = [{ nodeId: 'amount', name: 'amount', fieldId: 'amount', syncGroup: 'plan' }, { nodeId: 'choice', name: 'choice', fieldId: 'choice', inputType: 'radio', options: ['0', '1'], syncGroup: 'plan' }]
    expect(validateFormSubmission({ table, controls, values: { amount: '1', choice: '1' } }).ok).toBe(true)
    expect(validateFormSubmission({ table, controls, values: { amount: '0', choice: '1' } }).ok).toBe(false)
    expect(validateFormSubmission({ table, controls, values: { amount: '1' } }).ok).toBe(false)
  })
})
