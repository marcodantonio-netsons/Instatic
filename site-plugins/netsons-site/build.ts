import { readdir } from 'node:fs/promises'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { zipSync, strToU8 } from 'fflate'
import { parsePluginManifest } from '../../src/core/plugins/manifest'
import { readPluginPackage } from '../../server/plugins/package'
import { LanguageCatalogueSchema } from './src/localization/schema'
import { buildCollation } from './build-collation'
import {
  PropertyConditionSchema, FormTransportSchema, FormControlBehaviorSchema,
  FormChallengeResponseSchema, FormJsonResponseSchema, TurnstileConfigurationSchema,
  TurnstileApiSchema, FormValidationResponseSchema, FormSuccessResponseSchema,
  FormResponseContractSchema, FormCalculationsSchema, CheckboxGroupSchema,
  FormValueExpressionSchema, FormValuesRequestSchema,
} from './src/shared/forms'

const root = import.meta.dir
const project: unknown = await Bun.file(root + '/package.json').json()
const ProjectSchema = Type.Object({ version: Type.String({ minLength: 1 }) })
if (!Value.Check(ProjectSchema, project)) throw Error('Invalid plugin project metadata')
const languages = ['it', 'en', 'de', 'fr', 'es', 'pt', 'nl', 'pl', 'ro']
type LanguageCatalogue = Static<typeof LanguageCatalogueSchema>
const cataloguesByLanguage: Record<string, LanguageCatalogue> = Object.create(null)
for (const filename of (await readdir(root + '/locales')).filter(name => name.endsWith('.json')).sort()) {
  const raw: unknown = await Bun.file(root + '/locales/' + filename).json()
  if (!Value.Check(LanguageCatalogueSchema, raw) || filename !== raw.language + '.json' || !languages.includes(raw.language)) throw Error('Invalid language file ' + filename)
  if (Object.hasOwn(cataloguesByLanguage, raw.language)) throw Error('Duplicate language file ' + filename)
  cataloguesByLanguage[raw.language] = raw
}
if (Object.keys(cataloguesByLanguage).length !== languages.length || languages.some(language => !Object.hasOwn(cataloguesByLanguage, language))) throw Error('Expected exactly nine language files')

type TranslationMessages = LanguageCatalogue['messages']
const allPaths = new Set<string>()
const allStrings = new Set<string>()
function collectCatalogue(messages: TranslationMessages, parentPath = ''): void {
  for (const [key, value] of Object.entries(messages)) {
    const path = parentPath ? `${parentPath}.${key}` : key
    allPaths.add(path)
    if (typeof value === 'string') allStrings.add(value)
    else collectCatalogue(value, path)
  }
}
for (const language of languages) collectCatalogue(cataloguesByLanguage[language].messages)

const translationPaths = [...allPaths].sort()
const stringPool = [...allStrings].sort()
const pathIndexes = new Map(translationPaths.map((path, index) => [path, index]))
const stringIndexes = new Map(stringPool.map((value, index) => [value, index]))
const missingCatalogueValue = -1
const objectCatalogueValue = -2
const catalogueValueIds: Record<string, Int32Array> = Object.create(null)

function compileCatalogue(messages: TranslationMessages, ids: Int32Array, parentPath = ''): void {
  for (const [key, value] of Object.entries(messages)) {
    const path = parentPath ? `${parentPath}.${key}` : key
    const pathIndex = pathIndexes.get(path)
    if (pathIndex === undefined) throw Error('Missing generated language path ' + path)
    if (typeof value === 'string') {
      const stringIndex = stringIndexes.get(value)
      if (stringIndex === undefined) throw Error('Missing generated language value ' + path)
      ids[pathIndex] = stringIndex
    } else {
      ids[pathIndex] = objectCatalogueValue
      compileCatalogue(value, ids, path)
    }
  }
}

for (const language of languages) {
  const ids = new Int32Array(translationPaths.length)
  ids.fill(missingCatalogueValue)
  compileCatalogue(cataloguesByLanguage[language].messages, ids)
  catalogueValueIds[language] = ids
}

const pathIndexSource = translationPaths.map((path, index) => `[${JSON.stringify(path)}]:${index}`).join(',')
const valueIdsSource = languages.map(language => `${JSON.stringify(language)}:new Int32Array([${Array.from(catalogueValueIds[language]).join(',')}])`).join(',')
await Bun.write(root + '/src/localization/generatedCatalogues.ts', [
  '// Generated from locales/*.json. Do not edit.',
  `export const catalogueLanguages:readonly string[]=${JSON.stringify(languages)}`,
  `export const catalogueStringPool:readonly string[]=${JSON.stringify(stringPool)}`,
  `export const catalogueKeyIndexes:Record<string,number>={${pathIndexSource}}`,
  `export const catalogueValueIdsByLanguage:Record<string,Int32Array>={${valueIdsSource}}`,
  `export const MISSING_CATALOGUE_VALUE=${missingCatalogueValue}`,
  `export const OBJECT_CATALOGUE_VALUE=${objectCatalogueValue}`,
  '',
].join('\n'))

const intl = await Bun.build({ entrypoints: [root + '/src/numbers/privateIntlEntry.ts'], format: 'iife', target: 'browser', minify: { whitespace: true, syntax: false, identifiers: false } })
if (!intl.success || intl.outputs.length !== 1) throw new AggregateError(intl.logs, 'Cannot bundle private Intl implementation')
await Bun.write(root + '/src/numbers/generated/intl.js', 'export const NumberFormat = (() => { const Intl = {}; const globalThis = { Intl };\n' + await intl.outputs[0].text() + '\nreturn globalThis.__netsonsNumberFormat; })();\n')
await Bun.write(root + '/src/numbers/generated/intl.d.ts', 'export declare const NumberFormat: typeof Intl.NumberFormat\n')
await buildCollation(root, languages)

const validators = {
  checkCondition: PropertyConditionSchema, checkTransport: FormTransportSchema,
  checkControl: FormControlBehaviorSchema, checkChallenge: FormChallengeResponseSchema,
  checkJsonResponse: FormJsonResponseSchema, checkTurnstileConfiguration: TurnstileConfigurationSchema,
  checkTurnstileApi: TurnstileApiSchema, checkValidationResponse: FormValidationResponseSchema,
  checkSuccessResponse: FormSuccessResponseSchema, checkResponseContract: FormResponseContractSchema,
  checkCalculations: FormCalculationsSchema, checkCheckboxGroup: CheckboxGroupSchema,
  checkExpression: FormValueExpressionSchema, checkValuesRequest: FormValuesRequestSchema,
}
await Bun.write(root + '/src/forms/runtimeValidators.js', '// Generated from the shared form schemas.\n' + Object.entries(validators).map(([name, schema]) => `export const ${name} = (() => {\n${TypeCompiler.Code(schema)}\n})();\n`).join('\n'))

// Load runtime definitions only after their generated dependencies exist.
const [{ FORMS_CSS }, preferencesAsset, preferencesCss, preferencesHook, loopAssets, catalogue] = await Promise.all([
  import('./src/forms'), import('./src/preferences/browserAsset'),
  import('./src/preferences/documentCss'), import('./src/preferences/publishedHtml'),
  import('./src/loopControls/frontendAsset'), import('./src/catalogueQuery'),
])
async function bundle(source: string, target: string, browser = false) {
  const result = await Bun.build({ entrypoints: [root + '/src/' + source], target: 'browser', format: 'esm', minify: browser })
  if (!result.success) throw new AggregateError(result.logs, 'Cannot build ' + source)
  await Bun.write(root + '/dist/' + target, result.outputs[0])
}
await bundle('modules.ts', 'modules/index.js')
await bundle('server.ts', 'server/index.js')
await bundle('interactions.ts', 'frontend/interactions.js', true)
await bundle('forms/runtimeEntry.ts', 'frontend/forms.js', true)
await Bun.write(root + '/dist/frontend/interactions.css', await Bun.file(root + '/src/interactions.css').text())
await Bun.write(root + '/dist/frontend/forms.css', FORMS_CSS)
await Bun.write(root + '/dist/frontend/visitor-preferences.js', preferencesAsset.VISITOR_PREFERENCES_RUNTIME_JS)
await Bun.write(root + '/dist/frontend/visitor-preferences.css', preferencesCss.VISITOR_PREFERENCES_DOCUMENT_CSS)
await Bun.write(root + '/dist/frontend/loop-controls.js', loopAssets.LOOP_CONTROLS_RUNTIME_JS)
await Bun.write(root + '/dist/frontend/loop-controls.css', loopAssets.LOOP_CONTROLS_CSS)

const manifest = parsePluginManifest({
  id: 'netsons.site', name: 'Netsons Site', version: project.version, apiVersion: 1,
  description: 'Shared components, language files, catalogue queries and visitor preferences.', license: 'MIT',
  permissions: ['modules.register', 'frontend.assets', 'cms.hooks', 'loops.register', 'cms.content.read', 'cms.routes', 'cms.routes.public'],
  contentAccess: catalogue.CATALOGUE_QUERY_CONTENT_TABLES.map(table => ({ table, modes: ['read'] })),
  entrypoints: { modules: 'modules/index.js', server: 'server/index.js' },
  settings: preferencesHook.VISITOR_PREFERENCES_SETTINGS,
  frontend: { assets: [
    { kind: 'script', src: 'frontend/visitor-preferences.js', placement: 'head', strategy: 'sync' },
    { kind: 'style', href: 'frontend/visitor-preferences.css', placement: 'head' },
    { kind: 'script', src: 'frontend/interactions.js', placement: 'body-end', strategy: 'defer' },
    { kind: 'style', href: 'frontend/interactions.css', placement: 'head-end' },
    { kind: 'script', src: 'frontend/forms.js', placement: 'body-end', strategy: 'defer' },
    { kind: 'style', href: 'frontend/forms.css', placement: 'head-end' },
    ...loopAssets.LOOP_CONTROLS_FRONTEND_ASSETS,
  ] },
  resources: [], adminPages: [],
})
await Bun.write(root + '/dist/plugin.json', JSON.stringify(manifest, null, 2))
const files: Record<string, Uint8Array> = { 'plugin.json': strToU8(JSON.stringify(manifest)) }
for (const path of [manifest.entrypoints!.modules!, manifest.entrypoints!.server!, ...manifest.frontend!.assets.flatMap(asset => asset.kind === 'script' ? [asset.src] : asset.kind === 'style' ? [asset.href] : [])]) files[path] = new Uint8Array(await Bun.file(root + '/dist/' + path).arrayBuffer())
const bytes = zipSync(files, { level: 6 })
await readPluginPackage(new File([bytes], 'netsons-site.plugin.zip', { type: 'application/zip' }))
await Bun.write(root + '/dist/netsons-site.plugin.zip', bytes)
console.log(JSON.stringify({ status: 'BUILT_AND_INSPECTED', bytes: bytes.length, modules: 37, languages: languages.length }))
