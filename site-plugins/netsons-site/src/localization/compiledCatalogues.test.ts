import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { resolve } from 'node:path'
import { createModulePackVm } from '../../../../server/plugins/modulePackVm'
import { LanguageCatalogueSchema } from './schema'

const pluginId = 'netsons.site'
const languages = ['it', 'en', 'de', 'fr', 'es', 'pt', 'nl', 'pl', 'ro'] as const
const repoRoot = resolve(import.meta.dir, '../../../..')
const pluginRoot = resolve(repoRoot, 'site-plugins/netsons-site')
const auditPackEntry = resolve(import.meta.dir, 'quickjsAuditPack.ts')

type LanguageCatalogue = Static<typeof LanguageCatalogueSchema>
type ExpectedTranslation = { kind: 'text'; value: string } | { kind: 'object' }
type AuditVm = Awaited<ReturnType<typeof createModulePackVm>>

const AuditResponseSchema = Type.Object({
  results: Type.Array(Type.Union([
    Type.Object({ value: Type.String() }, { additionalProperties: false }),
    Type.Object({ error: Type.String() }, { additionalProperties: false }),
  ])),
  globalsUnchanged: Type.Boolean(),
  intlNumberFormat: Type.String(),
}, { additionalProperties: false })

let vm: AuditVm | undefined

function flattenMessages(messages: LanguageCatalogue['messages'], parentPath = '', result = new Map<string, ExpectedTranslation>()): Map<string, ExpectedTranslation> {
  for (const [key, value] of Object.entries(messages)) {
    const path = parentPath ? `${parentPath}.${key}` : key
    if (typeof value === 'string') result.set(path, { kind: 'text', value })
    else {
      result.set(path, { kind: 'object' })
      flattenMessages(value, path, result)
    }
  }
  return result
}

async function loadCanonicalCatalogues(): Promise<Map<string, Map<string, ExpectedTranslation>>> {
  const catalogues = new Map<string, Map<string, ExpectedTranslation>>()
  for (const language of languages) {
    const raw: unknown = await Bun.file(resolve(pluginRoot, 'locales', `${language}.json`)).json()
    const catalogue = Value.Parse(LanguageCatalogueSchema, raw)
    if (catalogue.language !== language) throw new Error(`Unexpected language in locales/${language}.json`)
    catalogues.set(language, flattenMessages(catalogue.messages))
  }
  return catalogues
}

function currentVm(): AuditVm {
  if (!vm) throw new Error('Localization QuickJS VM has not been initialized')
  return vm
}

function runAudit(language: string, keys: string[]) {
  const output = currentVm().render('netsons.site.localization-audit', { language, keys }, [])
  return Value.Parse(AuditResponseSchema, JSON.parse(output.html))
}

describe('compiled translation catalogues', () => {
  beforeAll(async () => {
    const build = await Bun.build({
      entrypoints: [auditPackEntry],
      root: repoRoot,
      target: 'browser',
      format: 'esm',
    })
    if (!build.success) throw new AggregateError(build.logs, 'Could not bundle the localization audit module')
    vm = await createModulePackVm({ pluginId, packSource: await build.outputs[0].text() })
  })

  afterAll(() => {
    vm?.dispose()
    vm = undefined
  })

  it('rejects source keys that cannot be addressed as translation path segments', () => {
    expect(Value.Check(LanguageCatalogueSchema, { language: 'it', messages: { 'header.contact': 'Contact' } })).toBe(false)
    expect(Value.Check(LanguageCatalogueSchema, { language: 'it', messages: { '9contact': 'Contact' } })).toBe(false)
  })

  it('returns every canonical key and value for all nine locales without changing QuickJS globals', async () => {
    const catalogues = await loadCanonicalCatalogues()
    const allPaths = [...new Set([...catalogues.values()].flatMap(catalogue => [...catalogue.keys()]))].sort()
    const keyPattern = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z][A-Za-z0-9_-]*)*$/

    for (const language of languages) {
      const expectedCatalogue = catalogues.get(language)
      if (!expectedCatalogue) throw new Error(`Missing canonical catalogue ${language}`)
      for (let start = 0; start < allPaths.length; start += 512) {
        const keys = allPaths.slice(start, start + 512)
        const response = runAudit(language, keys)
        expect(response.globalsUnchanged).toBe(true)
        expect(response.intlNumberFormat).not.toBe('function')
        expect(response.results).toHaveLength(keys.length)

        for (const [index, key] of keys.entries()) {
          const actual = response.results[index]
          let expected: { value: string } | { error: string }
          const canonical = expectedCatalogue.get(key)
          if (!keyPattern.test(key)) expected = { error: `Invalid translation key ${key}` }
          else if (canonical?.kind === 'text') expected = { value: canonical.value }
          else if (canonical?.kind === 'object') expected = { error: `Translation does not address text ${key}` }
          else expected = { error: `Missing translation ${language}:${key}` }
          expect(actual).toEqual(expected)
        }
      }
    }
  })

  it('preserves invalid, missing, object-path, unknown-language, and prototype-key errors', async () => {
    const catalogues = await loadCanonicalCatalogues()
    const italian = catalogues.get('it')
    if (!italian) throw new Error('Missing canonical Italian catalogue')
    const objectPath = [...italian].find(([, value]) => value.kind === 'object')?.[0]
    if (!objectPath) throw new Error('Canonical catalogue has no object paths to test')

    const cases = [
      { language: 'it', key: '1invalid', error: 'Invalid translation key 1invalid' },
      { language: 'it', key: '__proto__', error: 'Invalid translation key __proto__' },
      { language: 'it', key: 'missing-key', error: 'Missing translation it:missing-key' },
      { language: 'it', key: 'constructor', error: 'Missing translation it:constructor' },
      { language: 'it', key: 'toString', error: 'Missing translation it:toString' },
      { language: 'constructor', key: 'header.contact', error: 'Unknown language constructor' },
      { language: 'it', key: objectPath, error: `Translation does not address text ${objectPath}` },
    ]

    for (const testCase of cases) {
      const response = runAudit(testCase.language, [testCase.key])
      expect(response.globalsUnchanged).toBe(true)
      expect(response.intlNumberFormat).not.toBe('function')
      expect(response.results).toEqual([{ error: testCase.error }])
    }
  })
})
