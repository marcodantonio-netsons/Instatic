import { describe, expect, it } from 'bun:test'
import { Window } from 'happy-dom'
import '@modules/base'
import { registry } from '@core/module-engine'
import { Value } from '@sinclair/typebox/value'
import { FormCalculationsSchema, type FormCalculations, type FormValueExpression } from '@core/forms-schema'
import { evaluateFormValues, evaluateFormExpression, formExpressionFields } from '@core/form-values'
import { assertSiteForms, derivePublishedPageFormSnapshots, validateFormSubmission } from '@core/forms'
import { publishPage } from '@core/publisher'
import { DataTableSchema } from '@core/data/schemas'
import { FormModule, InputModule, SelectModule, OptionModule, CheckboxModule, FormOutputModule, FormLinkModule, FormStepModule } from '@modules/base/forms'
import { FORM_RUNTIME_JS } from '@modules/base/forms/formRuntimeJs'
import { makeNode, makePage, makeSite } from '../fixtures'

const literal = (value: string | number): FormValueExpression => ({ literal: value })
const field = (name: string): FormValueExpression => ({ field: name })
const calculations: FormCalculations = {
  minimumCpu: { op: 'lookup', value: field('gpu'), cases: { accelerated: { op: 'multiply', args: [literal(16), field('quantity')] } }, otherwise: literal(8) },
  gpuCost: { op: 'lookup', value: field('gpu'), cases: { accelerated: { op: 'multiply', args: [literal(200), field('quantity')] } }, otherwise: literal(0) },
  total: { op: 'add', args: [literal(100), { op: 'multiply', args: [field('cpu'), literal(15)] }, field('gpuCost')] },
  formatted: { op: 'number-format', value: field('total'), locale: 'it-IT', minimumFractionDigits: 2, maximumFractionDigits: 2 },
  quoteUrl: { op: 'url', base: literal('/quote'), query: { subject: { op: 'concat', values: [literal('CPU: '), field('cpu')] } } },
}
function model() {
  const page = makePage({ nodes: {
    root: makeNode({ id: 'root', moduleId: 'base.body', children: ['form'] }),
    form: makeNode({ id: 'form', moduleId: 'base.form', props: { mode: 'cms', formId: 'calculator', targetTableId: 'quotes', calculations }, children: ['cpu','gpu','quantity','result','link'] }),
    cpu: makeNode({ id: 'cpu', moduleId: 'base.input', props: { name: 'cpu', fieldId: 'cpu', inputType: 'range', min: '8', max: '1024', value: '8', minValueField: 'minimumCpu' } }),
    gpu: makeNode({ id: 'gpu', moduleId: 'base.select', props: { name: 'gpu', fieldId: 'gpu' }, children: ['none','accelerated'] }),
    none: makeNode({ id: 'none', moduleId: 'base.option', props: { value: '', selected: true, label: 'None' } }),
    accelerated: makeNode({ id: 'accelerated', moduleId: 'base.option', props: { value: 'accelerated', label: 'Accelerated' } }),
    quantity: makeNode({ id: 'quantity', moduleId: 'base.input', props: { name: 'quantity', fieldId: 'quantity', inputType: 'number', value: '1', min: '1', max: '10', disabledWhen: { field: 'gpu', eq: '' } } }),
    result: makeNode({ id: 'result', moduleId: 'base.form-output', props: { fieldName: 'formatted' } }),
    link: makeNode({ id: 'link', moduleId: 'base.form-link', props: { valueField: 'quoteUrl', text: 'Quote' } }),
  } })
  return { page, site: makeSite({ pages: [page] }) }
}
function htmlForm(id = 'calculator') {
  return FormModule.render({ ...FormModule.defaults, mode: 'custom', enhance: true, formId: id, calculations }, [
    InputModule.render({ ...InputModule.defaults, name: 'cpu', inputType: 'range', min: '8', max: '1024', value: '8', minValueField: 'minimumCpu' }, []).html,
    SelectModule.render({ ...SelectModule.defaults, name: 'gpu' }, [OptionModule.render({ ...OptionModule.defaults, value: '', label: 'None', selected: true }, []).html, OptionModule.render({ ...OptionModule.defaults, value: 'accelerated', label: 'Accelerated' }, []).html]).html,
    InputModule.render({ ...InputModule.defaults, name: 'quantity', inputType: 'number', value: '1', min: '1', max: '10', disabledWhen: { field: 'gpu', eq: '' } }, []).html,
    InputModule.render({ ...InputModule.defaults, name: 'domain', value: 'initial' }, []).html,
    FormOutputModule.render({ ...FormOutputModule.defaults, fieldName: 'formatted' }, []).html,
    FormOutputModule.render({ ...FormOutputModule.defaults, fieldName: 'total', cssVariable: '--amount' }, []).html,
    FormLinkModule.render({ ...FormLinkModule.defaults, valueField: 'quoteUrl', text: 'Quote' }, []).html,
    FormStepModule.render({ ...FormStepModule.defaults, fieldName: 'quantity', step: 1 }, []).html,
  ]).html
}
async function realmWith(html: string) {
  const realm = new Window({ url: 'https://site.example/', settings: { disableJavaScriptFileLoading: true } })
  const browser = realm as unknown as globalThis.Window & typeof globalThis
  browser.document.body.innerHTML = html
  browser.eval(FORM_RUNTIME_JS)
  return { realm, browser }
}

describe('declarative native form values', () => {
  it('projects a derived select value without losing the independent edit target while disabled', async () => {
    const calculations: FormCalculations = { display: { op: 'lookup', value: field('gpu'), cases: { '': literal(0) }, otherwise: field('quantity') } }
    const page = makePage({ nodes: {
      root: makeNode({id:'root',moduleId:'base.body',children:['form']}),
      form: makeNode({id:'form',moduleId:'base.form',props:{mode:'local',formId:'projection',calculations},children:['gpu','quantity','choice']}),
      gpu: makeNode({id:'gpu',moduleId:'base.select',props:{name:'gpu',fieldId:'gpu'},children:['none','active']}),
      none: makeNode({id:'none',moduleId:'base.option',props:{value:'',selected:true,label:'None'}}),
      active: makeNode({id:'active',moduleId:'base.option',props:{value:'active',label:'Active'}}),
      quantity: makeNode({id:'quantity',moduleId:'base.input',props:{name:'quantity',fieldId:'quantity',inputType:'number',min:'1',max:'10',value:'1',htmlAttributes:{hidden:''}}}),
      choice: makeNode({id:'choice',moduleId:'base.select',props:{name:'choice',fieldId:'choice',valueSourceField:'display',valueTargetField:'quantity',disabledWhen:{field:'gpu',eq:''}},children:['zero','one','seven']}),
      zero: makeNode({id:'zero',moduleId:'base.option',props:{value:'0',selected:true,label:'0'}}),
      one: makeNode({id:'one',moduleId:'base.option',props:{value:'1',label:'1'}}),
      seven: makeNode({id:'seven',moduleId:'base.option',props:{value:'7',label:'7'}}),
    } }),site=makeSite({pages:[page]})
    assertSiteForms(site)
    const {realm,browser}=await realmWith(publishPage(page,site,registry).html)
    try {
      const form=browser.document.forms[0],owner=form.elements.namedItem('quantity') as HTMLInputElement,choice=form.elements.namedItem('choice') as HTMLSelectElement,gpu=form.elements.namedItem('gpu') as HTMLSelectElement
      const change=(control:HTMLSelectElement,value:string)=>{control.value=value;control.dispatchEvent(new browser.Event('change',{bubbles:true}))}
      expect(choice.disabled).toBe(true);expect(choice.value).toBe('0');expect(owner.value).toBe('1')
      change(gpu,'active');change(choice,'7');expect(owner.value).toBe('7')
      change(gpu,'');expect(choice.value).toBe('0');expect(choice.disabled).toBe(true);expect(owner.value).toBe('7')
      change(gpu,'active');expect(choice.value).toBe('7');expect(choice.disabled).toBe(false);expect(owner.value).toBe('7')
      change(choice,'0');expect(owner.value).toBe('1');expect(choice.value).toBe('1')
      expect(form.getAttribute('data-instatic-form-state')).toBe('idle')
    } finally {await realm.happyDOM.close()}
    page.nodes.form.props.mode='cms';page.nodes.form.props.targetTableId='quotes'
    const [snapshot]=derivePublishedPageFormSnapshots(site,page)
    const table={...Value.Create(DataTableSchema),fields:[{id:'gpu',label:'GPU',type:'text' as const},{id:'quantity',label:'Quantity',type:'number' as const},{id:'choice',label:'Choice',type:'text' as const}]}
    const submitted={gpu:'active',quantity:'7',choice:'7'}
    expect(validateFormSubmission({table,controls:snapshot.controls,calculations:snapshot.calculations,values:submitted}).ok).toBe(true)
    const forged=validateFormSubmission({table,controls:snapshot.controls,calculations:snapshot.calculations,values:{...submitted,choice:'1'}})
    expect(forged.ok).toBe(false)
    if(!forged.ok)expect(forged.errors).toContainEqual({fieldId:'choice',code:'invalid_value',message:'Invalid synchronized value.'})
    expect(submitted).toEqual({gpu:'active',quantity:'7',choice:'7'})
    page.nodes.quantity.props.valueTargetField='choice';page.nodes.quantity.props.valueSourceField='display'
    expect(()=>assertSiteForms(site)).toThrow('independent enabled scalar target')
  })
  it('replaces the first literal scalar match and traces every operand dependency', () => {
    const expression: FormValueExpression = { op: 'replace', value: field('caption'), search: field('marker'), replacement: field('amount') }
    expect(formExpressionFields(expression)).toEqual(['caption','marker','amount'])
    expect(evaluateFormExpression(expression,{caption:'Cost: [amount] / [amount]',marker:'[amount]',amount:12})).toBe('Cost: 12 / [amount]')
    expect(evaluateFormExpression(expression,{caption:'x.*x',marker:'.*',amount:'$&'})).toBe('x$&x')
    expect(evaluateFormExpression(expression,{caption:'caption',marker:'absent',amount:9})).toBe('caption')
    expect(() => evaluateFormExpression(expression,{caption:['invalid'],marker:'invalid',amount:1})).toThrow('scalar')
    expect(() => evaluateFormValues({ result: { ...expression, replacement: field('result') } },{caption:'x',marker:'x'})).toThrow('cycle')
  })
  it('clamps dependent resources before prices and preserves resources when a minimum decreases', () => {
    const bounds = [{ fieldName: 'cpu', minValueField: 'minimumCpu', max: 1024 }]
    const next = evaluateFormValues(calculations, { cpu: '8', gpu: 'accelerated', quantity: '2' }, bounds)
    expect(next.cpu).toBe('32'); expect(next.total).toBe(980); expect(next.formatted).toBe('980,00')
    const reduced = evaluateFormValues(calculations, { cpu: next.cpu, gpu: '', quantity: '2' }, bounds)
    expect(reduced.cpu).toBe('32'); expect(reduced.total).toBe(580)
    expect(new URL(String(next.quoteUrl), 'https://site.example').searchParams.get('subject')).toBe('CPU: 32')
  })
  it('rejects cycles, unknown fields, executable syntax, unsafe URLs and non-finite results', () => {
    expect(() => evaluateFormValues({ a: field('b'), b: field('a') }, {})).toThrow('cycle')
    expect(() => evaluateFormValues({ a: field('missing') }, {})).toThrow('Unknown calculation')
    expect(() => evaluateFormValues({ minimum: field('cpu') }, { cpu: '8' }, [{ fieldName: 'cpu', minValueField: 'minimum' }])).toThrow('cycle')
    expect(Value.Check(FormCalculationsSchema, { price: 'return window.location' })).toBe(false)
    expect(() => evaluateFormExpression({ op: 'url', base: literal('javascript:alert(1)'), query: {} }, {})).toThrow('HTTP(S)')
    expect(() => evaluateFormExpression({ op: 'divide', args: [literal(1), literal(0)] }, {})).toThrow('non-finite')
  })
  it('renders the initial calculated state and validates dynamic bounds against the published CMS model', () => {
    const { page, site } = model()
    expect(() => assertSiteForms(site)).not.toThrow()
    const html = publishPage(page, site, registry).html
    expect(html).toContain('>220,00</output>'); expect(html).toContain('href="/quote?subject=CPU%3A+8"')
    const [snapshot] = derivePublishedPageFormSnapshots(site, page)
    const table = { ...Value.Create(DataTableSchema), fields: [{ id: 'cpu', label: 'CPU', type: 'number' as const }, { id: 'gpu', label: 'GPU', type: 'text' as const }, { id: 'quantity', label: 'Quantity', type: 'number' as const }] }
    expect(validateFormSubmission({ table, controls: snapshot.controls, calculations: snapshot.calculations, values: { cpu: '32', gpu: 'accelerated', quantity: '2' } }).ok).toBe(true)
    const forged = validateFormSubmission({ table, controls: snapshot.controls, calculations: snapshot.calculations, values: { cpu: '8', gpu: 'accelerated', quantity: '2' } })
    expect(forged.ok).toBe(false)
    if (!forged.ok) expect(forged.errors[0].code).toBe('too_small')
  })
  it('keeps SSR and browser calculations, CSS values, links, steppers, form isolation and reset aligned', async () => {
    const { realm, browser } = await realmWith(htmlForm() + htmlForm('independent'))
    try {
      const form = browser.document.forms[0], other = browser.document.forms[1]
      const cpu = form.elements.namedItem('cpu') as HTMLInputElement, gpu = form.elements.namedItem('gpu') as HTMLSelectElement, quantity = form.elements.namedItem('quantity') as HTMLInputElement
      expect(quantity.disabled).toBe(true)
      gpu.value = 'accelerated'; gpu.dispatchEvent(new browser.Event('change', { bubbles: true }))
      expect(cpu.value).toBe('16'); expect(quantity.disabled).toBe(false)
      form.querySelector<HTMLButtonElement>('[data-instatic-form-step]')!.click()
      expect(quantity.value).toBe('2'); expect(cpu.value).toBe('32')
      expect(form.querySelector('output')!.textContent).toBe('980,00')
      expect(form.querySelector<HTMLElement>('[data-instatic-form-css-variable]')!.style.getPropertyValue('--amount')).toBe('980')
      expect(new URL(form.querySelector<HTMLAnchorElement>('a')!.href).searchParams.get('subject')).toBe('CPU: 32')
      expect(other.querySelector('output')!.textContent).toBe('220,00')
      gpu.value = ''; gpu.dispatchEvent(new browser.Event('change', { bubbles: true }))
      expect(cpu.value).toBe('32'); expect(form.querySelector('output')!.textContent).toBe('580,00')
      form.reset(); await new Promise((resolve) => setTimeout(resolve, 0))
      expect(cpu.value).toBe('8'); expect(quantity.value).toBe('1'); expect(quantity.disabled).toBe(true)
      expect(form.querySelector('output')!.textContent).toBe('220,00')
    } finally { await realm.happyDOM.close() }
  })
  it('binds new external loop links to the current form snapshot and provides a late-listener handshake', async () => {
    const expression: FormValueExpression = { op: 'url', base: literal('/buy'), query: { domain: field('domain'), extension: literal('.it') } }
    const { realm, browser } = await realmWith(htmlForm())
    try {
      const form = browser.document.forms[0], domain = form.elements.namedItem('domain') as HTMLInputElement
      domain.value = 'example & name'; domain.dispatchEvent(new browser.Event('input', { bubbles: true }))
      let deliveries = 0
      browser.document.addEventListener('instatic:form-values', () => { deliveries++ })
      browser.document.body.insertAdjacentHTML('beforeend', FormLinkModule.render({ ...FormLinkModule.defaults, formId: 'calculator', expression, text: 'New row' }, []).html)
      browser.document.dispatchEvent(new browser.CustomEvent('instatic:content'))
      const link = browser.document.querySelector<HTMLAnchorElement>('a[data-instatic-form-id]')!
      expect(new URL(link.href).searchParams.get('domain')).toBe('example & name')
      expect(deliveries).toBe(0)
      browser.document.dispatchEvent(new browser.CustomEvent('instatic:form-values-request', { detail: { formId: 'calculator' } }))
      expect(deliveries).toBe(1)
    } finally { await realm.happyDOM.close() }
  })
  it('preserves minimum selection and applies FIFO overflow per checkbox collection', async () => {
    const choices = ['a','b','c','d','e'].map((value) => CheckboxModule.render({ ...CheckboxModule.defaults, name: 'selected', value, checked: value === 'a', minSelected: 1, maxSelected: 4, selectionOverflow: 'drop-oldest' }, []).html)
    const html = FormModule.render({ ...FormModule.defaults, formId: 'compare', mode: 'custom', enhance: true, calculations: { count: { op: 'length', value: field('selected') } } }, [...choices, FormOutputModule.render({ ...FormOutputModule.defaults, fieldName: 'count' }, []).html]).html
    const { realm, browser } = await realmWith(html)
    try {
      const form = browser.document.forms[0], checkboxes = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      checkboxes[0].click(); expect(checkboxes[0].checked).toBe(true)
      for (const checkbox of checkboxes.slice(1)) checkbox.click()
      expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([false,true,true,true,true])
      expect(form.querySelector('output')!.textContent).toBe('4')
      for (const checkbox of checkboxes.slice(1)) checkbox.click()
      expect(checkboxes.filter((checkbox) => checkbox.checked).length).toBe(1)
      form.reset(); await new Promise((resolve) => setTimeout(resolve, 0))
      expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([true,false,false,false,false])
    } finally { await realm.happyDOM.close() }
  })
  it('clears declared text fields before emitting the next normalized form snapshot', async () => {
    const html = FormModule.render({ ...FormModule.defaults, formId: 'search', mode: 'custom', enhance: true }, [InputModule.render({ ...InputModule.defaults, name: 'category', value: 'all', clearFieldsOnChange: 'query' }, []).html, InputModule.render({ ...InputModule.defaults, name: 'query', value: 'previous' }, []).html]).html
    const { realm, browser } = await realmWith(html)
    try {
      let emitted: unknown
      browser.document.addEventListener('instatic:form-values', (event) => { emitted = (event as CustomEvent).detail.values })
      const category = browser.document.forms[0].elements.namedItem('category') as HTMLInputElement
      category.value = 'other'; category.dispatchEvent(new browser.Event('input', { bubbles: true }))
      expect(emitted).toEqual({ category: 'other', query: '' })
    } finally { await realm.happyDOM.close() }
  })
  it('normalizes declared text without accepting non-text trim operands', () => {
    expect(evaluateFormExpression({ op: 'trim', value: literal('  guide  ') }, {})).toBe('guide')
    expect(() => evaluateFormExpression({ op: 'trim', value: literal(1) }, {})).toThrow('text')
  })
  it('keeps local submissions in the page and preserves semantic CSS output children', async () => {
    const html = FormModule.render({ ...FormModule.defaults, formId: 'local-search', mode: 'local', submitTargetId: 'results', calculations: { height: { op: 'multiply', args: [field('amount'), literal(3)] } } }, [
      InputModule.render({ ...InputModule.defaults, name: 'amount', inputType: 'number', value: '2' }, []).html,
      FormOutputModule.render({ ...FormOutputModule.defaults, fieldName: 'height', cssVariable: '--height', tag: 'custom', customTag: 'span' }, ['<em>Label</em>']).html,
    ]).html + '<section id="results">Results</section>'
    const { realm, browser } = await realmWith(html)
    try {
      const form = browser.document.forms[0], target = browser.document.getElementById('results')!
      let requests = 0, navigations = 0, scrolling: unknown
      browser.fetch = (() => { requests++; throw new Error('Unexpected transport') }) as typeof fetch
      form.requestSubmit = () => { navigations++ }
      target.scrollIntoView = (options) => { scrolling = options }
      browser.document.documentElement.setAttribute('data-instatic-motion', 'reduced')
      const amount = form.elements.namedItem('amount') as HTMLInputElement
      amount.value = '4'; amount.dispatchEvent(new browser.Event('input', { bubbles: true }))
      const bar = form.querySelector<HTMLElement>('[data-instatic-form-output]')!
      expect(bar.tagName).toBe('SPAN'); expect(bar.innerHTML).toBe('<em>Label</em>')
      expect(bar.style.getPropertyValue('--height')).toBe('12')
      form.dispatchEvent(new browser.Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
      expect(requests).toBe(0); expect(navigations).toBe(0)
      expect(scrolling).toEqual({ block: 'start', behavior: 'auto' })
      expect(browser.document.activeElement).toBe(target)
      expect(form.getAttribute('data-instatic-form-state')).toBe('idle')
    } finally { await realm.happyDOM.close() }
  })

})
