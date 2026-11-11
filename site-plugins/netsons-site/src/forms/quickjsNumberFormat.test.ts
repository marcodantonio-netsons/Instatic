import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { resolve } from 'node:path'
import { createModulePackVm } from '../../../../server/plugins/modulePackVm'
import { vpcCalculationsFixture } from './quickjsNumberFormat.fixture'

const pluginId = 'netsons.site'
const repoRoot = resolve(import.meta.dir, '../../../..')
const testPackEntry = resolve(import.meta.dir, 'quickjsNumberFormat.testPack.ts')
const nativeNumberFormat = Intl.NumberFormat

const languages = [
  { language: 'it', locale: 'it', routePath: '/virtual-private-cloud' },
  { language: 'en', locale: 'en', routePath: '/en/virtual-private-cloud' },
  { language: 'de', locale: 'de', routePath: '/de/virtuelle-private-cloud' },
  { language: 'fr', locale: 'fr', routePath: '/fr/cloud-prive-virtuel' },
  { language: 'es', locale: 'es', routePath: '/es/cloud-privada-virtual' },
  { language: 'pt', locale: 'pt', routePath: '/pt/cloud-privada-virtual' },
  { language: 'pt-PT', locale: 'pt-PT', routePath: '/pt/cloud-privada-virtual' },
  { language: 'nl', locale: 'nl', routePath: '/nl/virtual-private-cloud' },
  { language: 'pl', locale: 'pl', routePath: '/pl/virtual-private-cloud' },
  { language: 'ro', locale: 'ro', routePath: '/ro/cloud-privat-virtual' },
] as const

const styles = ['decimal', 'currency', 'percent'] as const
type NumberStyle = typeof styles[number]
type TestVm = Awaited<ReturnType<typeof createModulePackVm>>

let vm: TestVm | undefined

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a form calculation object')
  return value as Record<string, unknown>
}

function rewriteNumberFormats(value: unknown, locale: string, style: NumberStyle): void {
  if (Array.isArray(value)) {
    for (const child of value) rewriteNumberFormats(child, locale, style)
    return
  }
  if (!value || typeof value !== 'object') return
  const expression = value as Record<string, unknown>
  if (expression.op === 'number-format') {
    expression.locale = locale
    expression.style = style
    if (style === 'currency') expression.currency = 'EUR'
    else delete expression.currency
  }
  for (const child of Object.values(expression)) rewriteNumberFormats(child, locale, style)
}

function formCalculations(locale: string, style: NumberStyle): Record<string, unknown> {
  const calculations = structuredClone(vpcCalculationsFixture) as Record<string, unknown>
  rewriteNumberFormats(calculations, locale, style)

  // The imported copy tokens are resolved by the publisher before this module
  // pack runs. Supply those resolved placeholder templates while preserving
  // the actual persisted expression trees from the fixture.
  for (const [name, label] of [
    ['promoLabel', 'Promo '],
    ['renewalLabel', 'Renewal '],
    ['gpuSummaryMonthlyLabel', 'GPU monthly: '],
  ] as const) {
    const expression = asRecord(calculations[name])
    asRecord(expression.value).literal = `${label}⟪native_value_0⟫`
  }
  for (const name of ['gpuUnitLabel', 'gpuMonthlyLabel']) {
    const expression = asRecord(calculations[name])
    const values = expression.values
    if (!Array.isArray(values) || !values[1]) throw new Error(`Missing source suffix for ${name}`)
    asRecord(values[1]).literal = ' / month'
  }
  return calculations
}

function currentVm(): TestVm {
  if (!vm) throw new Error('QuickJS form VM has not been initialized')
  return vm
}

function outputValue(html: string, fieldName: string): string {
  const escapedName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`<output\\b[^>]*data-instatic-form-output="${escapedName}"[^>]*>([\\s\\S]*?)<\\/output>`).exec(html)
  if (!match) throw new Error(`Missing form output for ${fieldName}`)
  return match[1]
}

async function createVm(): Promise<TestVm> {
  const build = await Bun.build({
    entrypoints: [testPackEntry],
    root: repoRoot,
    target: 'browser',
    format: 'esm',
  })
  if (!build.success) throw new AggregateError(build.logs, 'Could not bundle the actual Netsons form modules for QuickJS')
  return createModulePackVm({ pluginId, packSource: await build.outputs[0].text() })
}

describe('Netsons form number formatting in QuickJS', () => {
  beforeAll(async () => {
    vm = await createVm()
  })

  afterAll(() => {
    vm?.dispose()
    vm = undefined
  })

  it('uses the persisted VPC form calculation graph and keeps Intl.NumberFormat out of QuickJS globals', () => {
    expect(vpcCalculationsFixture.promoLabel.replacement.op).toBe('number-format')
    expect(vpcCalculationsFixture.promoLabel.replacement.locale).toBe('it-IT')
    expect(vpcCalculationsFixture.renewalLabel.replacement.op).toBe('number-format')
    expect(vpcCalculationsFixture.gpuSummaryMonthlyLabel.replacement.op).toBe('number-format')

    const status = currentVm().render('netsons.site.test-intl-probe', {}, []).html.split('|')
    expect(status).toHaveLength(2)
    expect(status[0]).not.toBe('function')
    expect(status[1]).toBe(status[0])
    expect(Intl.NumberFormat).toBe(nativeNumberFormat)
  })

  for (const { language, locale, routePath } of languages) {
    for (const style of styles) {
      it(`renders the imported VPC expressions with ${style} formatting for ${language}`, () => {
        const sandbox = currentVm()
        const routeInputValues = [
          ['cpu', '8'],
          ['ram', '64'],
          ['disk', '250'],
          ['ips', '4'],
          ['gpuId', 'a30'],
          ['gpuQuantity', '1'],
        ] as const
        const inputModule = sandbox.modules.find((module) => module.id === 'netsons.site.input')
        const outputModule = sandbox.modules.find((module) => module.id === 'netsons.site.form-output')
        const formModule = sandbox.modules.find((module) => module.id === 'netsons.site.form')
        if (!inputModule || !outputModule || !formModule) throw new Error('The form module pack is missing a required renderer')

        const children = routeInputValues.map(([name, value]) => sandbox.render('netsons.site.input', {
          ...inputModule.defaults,
          routePath,
          fieldId: name,
          name,
          inputType: name === 'gpuId' ? 'text' : 'number',
          value,
          htmlAttributes: {},
        }, []).html)
        for (const fieldName of ['promoLabel', 'gpuUnitLabel', 'renewalLabel', 'gpuMonthlyLabel', 'gpuSummaryMonthlyLabel']) {
          children.push(sandbox.render('netsons.site.form-output', {
            ...outputModule.defaults,
            routePath,
            fieldName,
            text: '',
            tag: 'custom',
            customTag: 'output',
            htmlAttributes: {},
          }, []).html)
        }

        const calculations = formCalculations(locale, style)
        const html = sandbox.render('netsons.site.form', {
          ...formModule.defaults,
          routePath,
          formId: 'vpc-configurator',
          mode: 'local',
          calculations,
        }, children).html

        const options: Intl.NumberFormatOptions = {
          style,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
          ...(style === 'currency' ? { currency: 'EUR' } : {}),
        }
        const expected = {
          promoLabel: `Promo ${new Intl.NumberFormat(locale, options).format(724.92)}`,
          gpuUnitLabel: `${new Intl.NumberFormat(locale, options).format(325)} / month`,
          renewalLabel: `Renewal ${new Intl.NumberFormat(locale, options).format(824.9)}`,
          gpuMonthlyLabel: `${new Intl.NumberFormat(locale, options).format(325)} / month`,
          gpuSummaryMonthlyLabel: `GPU monthly: ${new Intl.NumberFormat(locale, options).format(325)}`,
        }
        for (const [fieldName, text] of Object.entries(expected)) {
          expect(outputValue(html, fieldName)).toBe(text)
        }
        expect(Intl.NumberFormat).toBe(nativeNumberFormat)
      })
    }
  }
})
