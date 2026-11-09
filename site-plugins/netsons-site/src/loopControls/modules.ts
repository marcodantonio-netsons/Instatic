import type { Static, TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { PluginModuleDefinition, PluginPropertySchema } from '@instatic/plugin-sdk'
import { htmlAttributesAttr } from '../shared/attributeEmitter'
import { escapeHtml } from '../shared/htmlSafety'
import { resolveHtmlTag } from '../shared/tags'
import { languageFromPath, localizeRenderProps } from '../localization'
import { isCatalogueQueryConfigId } from '../catalogueQuery/config'
import { HtmlAttributesSchema, LoopConditionalPropsSchema, LoopCountPropsSchema, LoopMorePropsSchema } from './schema'

const generatedCountAttributes = ['data-instatic-loop-count', 'data-instatic-loop-count-metric', 'data-netsons-query-configs']
const generatedConditionalAttributes = ['data-instatic-loop-empty-group', 'data-instatic-loop-condition', 'data-netsons-query-configs', 'hidden']
const generatedMoreAttributes = [
  'data-instatic-loop-more',
  'data-instatic-loop-load-more-label',
  'data-instatic-loop-loading-label',
  'data-instatic-loop-retry-label',
  'type',
  'hidden',
  'disabled',
]

function localizedProps<T extends TSchema>(schema: T, input: Record<string, unknown>): Static<T> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Loop control properties must be an object')
  if (input.routePath !== undefined && typeof input.routePath !== 'string') throw new Error('Loop control routePath must be a string')
  const routePath = typeof input.routePath === 'string' ? input.routePath : '/'
  const language = languageFromPath(routePath)
  const authored = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'routePath'))
  const defaulted: unknown = Value.Default(schema, authored)
  if (!Value.Check(schema, defaulted)) throw new Error('Invalid loop control properties')
  const localized = localizeRenderProps(defaulted as Record<string, unknown>, language)
  if (!Value.Check(schema, localized)) throw new Error('Invalid localized loop control properties')
  const parsed: unknown = Value.Parse(schema, localized)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Loop control properties must resolve to an object')
  return parsed as Static<T>
}

function readLoopIds(value: string): string[] {
  const ids = [...new Set(value.trim().split(/\s+/).filter(Boolean))]
  if (ids.length > 32 || ids.some(id => id.length > 256 || [...id].some(character => character.charCodeAt(0) < 32))) {
    throw new Error('Invalid loop IDs')
  }
  return ids
}

function readSingleLoopId(value: string): string {
  const [id, ...otherIds] = readLoopIds(value)
  if (!id || otherIds.length > 0) throw new Error('Loop-more requires one loop ID')
  return id
}

function readQueryConfigIds(value: string, loopIds: readonly string[]): string[] {
  const ids = value.trim() ? value.trim().split(/\s+/) : []
  if (ids.length === 0) return []
  if (ids.length !== loopIds.length || ids.some(id => !isCatalogueQueryConfigId(id))) {
    throw new Error('Loop query configuration IDs must match the loop references')
  }
  return ids
}

function queryConfigAttribute(configIds: readonly string[]): string {
  return configIds.length
    ? ` data-netsons-query-configs="${escapeHtml(JSON.stringify(configIds))}"`
    : ''
}

function htmlAttributes(value: Record<string, string>, json: string): Record<string, string> {
  if (!json.trim()) return value
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('HTML attributes must be valid JSON')
  }
  if (!Value.Check(HtmlAttributesSchema, parsed)) throw new Error('HTML attributes must be a JSON object of string values')
  return Value.Parse(HtmlAttributesSchema, parsed)
}

const commonSchema: PluginPropertySchema = {
  loopIds: { type: 'text', label: 'Loop IDs (space-separated)' },
  tag: { type: 'select', label: 'Tag', options: ['div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'ul', 'ol', 'custom'].map(value => ({ label: value, value })) },
  customTag: { type: 'text', label: 'Custom tag' },
  htmlAttributesJson: { type: 'textarea', label: 'HTML attributes (JSON)', rows: 4 },
}

export const LoopCountModule: PluginModuleDefinition = {
  id: 'netsons.site.loop-count',
  name: 'Loop count',
  description: 'Display a loop total, loaded count, remaining count, or progress.',
  category: 'Netsons',
  version: '1.0.0',
  htmlTag: 'span',
  canHaveChildren: false,
  defaults: { ...Value.Create(LoopCountPropsSchema), routePath: '{route.path}' },
  schema: {
    ...commonSchema,
    metric: { type: 'select', label: 'Count', options: [
      { label: 'Total matches', value: 'total' },
      { label: 'Loaded entries', value: 'loaded' },
      { label: 'Remaining entries', value: 'remaining' },
      { label: 'Loaded / total', value: 'progress' },
    ] },
  },
  render(input) {
    const props = localizedProps(LoopCountPropsSchema, input)
    const ids = readLoopIds(props.loopIds)
    const configIds = readQueryConfigIds(props.queryConfigIds, ids)
    const tag = resolveHtmlTag(props.tag, props.customTag)
    return {
      html: `<${tag} data-instatic-loop-count="${escapeHtml(JSON.stringify(ids))}" data-instatic-loop-count-metric="${props.metric}"${queryConfigAttribute(configIds)}${htmlAttributesAttr(htmlAttributes(props.htmlAttributes, props.htmlAttributesJson), generatedCountAttributes)}>?</${tag}>`,
    }
  },
}

export const LoopConditionalModule: PluginModuleDefinition = {
  id: 'netsons.site.loop-conditional',
  name: 'Loop condition',
  description: 'Show its contents when matching loop results exist or are empty.',
  category: 'Netsons',
  version: '1.0.0',
  htmlTag: 'div',
  canHaveChildren: true,
  defaults: { ...Value.Create(LoopConditionalPropsSchema), routePath: '{route.path}' },
  schema: {
    ...commonSchema,
    when: { type: 'select', label: 'Show when', options: [
      { label: 'Results exist', value: 'results' },
      { label: 'No results', value: 'empty' },
    ] },
  },
  render(input, children) {
    const props = localizedProps(LoopConditionalPropsSchema, input)
    const ids = readLoopIds(props.loopIds)
    const configIds = readQueryConfigIds(props.queryConfigIds, ids)
    const tag = resolveHtmlTag(props.tag, props.customTag)
    // The post-publish filter sets exact initial visibility when native loop
    // metadata is present; the browser asset reconciles after more pages load.
    return {
      html: `<${tag} data-instatic-loop-empty-group="${escapeHtml(JSON.stringify(ids))}" data-instatic-loop-condition="${props.when}"${queryConfigAttribute(configIds)} hidden${htmlAttributesAttr(htmlAttributes(props.htmlAttributes, props.htmlAttributesJson), generatedConditionalAttributes)}>${children.join('')}</${tag}>`,
    }
  },
}

export const LoopMoreModule: PluginModuleDefinition = {
  id: 'netsons.site.loop-more',
  name: 'Load more entries',
  description: 'An authored button for a native infinite loop.',
  category: 'Netsons',
  version: '1.0.0',
  htmlTag: 'button',
  canHaveChildren: true,
  defaults: { ...Value.Create(LoopMorePropsSchema), routePath: '{route.path}' },
  schema: {
    loopId: { type: 'text', label: 'Loop ID' },
    label: { type: 'text', label: 'Label', description: 'Use {remaining}, {loaded} or {total} for counts.' },
    loadingLabel: { type: 'text', label: 'Loading label' },
    retryLabel: { type: 'text', label: 'Retry label' },
    htmlAttributesJson: { type: 'textarea', label: 'HTML attributes (JSON)', rows: 4 },
  },
  render(input, children) {
    const props = localizedProps(LoopMorePropsSchema, input)
    const loopId = readSingleLoopId(props.loopId)
    const customAttrs = htmlAttributesAttr(htmlAttributes(props.htmlAttributes, props.htmlAttributesJson), generatedMoreAttributes)
    return {
      html: `<button type="button" data-instatic-loop-more="${escapeHtml(loopId)}" data-instatic-loop-load-more-label="${escapeHtml(props.label)}" data-instatic-loop-loading-label="${escapeHtml(props.loadingLabel)}" data-instatic-loop-retry-label="${escapeHtml(props.retryLabel)}"${children.length ? '' : ' data-instatic-loop-more-fallback=""'} hidden${customAttrs}>${children.length ? children.join('') : escapeHtml(props.label)}</button>`,
    }
  },
}

export const loopControlModules: PluginModuleDefinition[] = [LoopCountModule, LoopConditionalModule, LoopMoreModule]
