import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { PluginModuleDefinition } from '@instatic/plugin-sdk'
import { escapeHtml } from '../shared/htmlSafety'
import { languageFromPath, localizeRenderProps, translate } from '../localization'

const SvgPropsSchema = Type.Object({
  title: Type.String({ default: '' }),
}, { additionalProperties: false })

function localizeSvgMarkup(
  markup: string,
  language: string,
  lookup: typeof translate = translate,
): string {
  return markup.replace(/\{i18n\.([A-Za-z][A-Za-z0-9_.-]*)\}/g, (_token, key: string) =>
    escapeHtml(lookup(language, key)),
  )
}

function resolvedProps(input: Record<string, unknown>): { language: string; title: string } {
  if (typeof input.routePath !== 'string') throw Error('A resolved route path is required for SVG localization')
  const language = languageFromPath(input.routePath)
  const authored = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'routePath'))
  const defaulted: unknown = Value.Default(SvgPropsSchema, authored)
  if (!Value.Check(SvgPropsSchema, defaulted)) throw Error('Invalid SVG module properties')
  const parsed = Value.Parse(SvgPropsSchema, defaulted)
  const localizedTitle = localizeRenderProps({ title: parsed.title }, language).title
  if (typeof localizedTitle !== 'string') throw Error('Invalid SVG accessible label')

  return {
    language,
    title: localizedTitle,
  }
}

function render(input: Record<string, unknown>, children: string[]) {
  if (children.length !== 1) throw Error('Localized SVG requires one native SVG child')
  const { language, title } = resolvedProps(input)
  // The native base.svg child owns the host sanitizer. Translate only escaped
  // copy after that boundary; the plugin needs no custom SDK property control.
  const svg = localizeSvgMarkup(children[0], language)
  if (!svg.trim()) return { html: '' }

  const label = title.trim()
  if (!label) return { html: svg }

  return {
    html: svg.replace(/^(\s*<svg\b)/i, (tag) => `${tag} role="img" aria-label="${label}"`),
  }
}

function preview(input: Record<string, unknown>) {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const label = escapeHtml(title || 'SVG')
  return { html: `<span role="img" aria-label="${label}">SVG</span>` }
}

export const SvgModule: PluginModuleDefinition = {
  id: 'netsons.site.svg',
  name: 'SVG',
  description: 'Inline vector graphic (logo or icon).',
  category: 'Netsons',
  version: '1.0.0',
  defaults: { ...Value.Create(SvgPropsSchema), routePath: '{route.path}' },
  schema: {
    title: { type: 'text', label: 'Accessible label', placeholder: 'e.g. Company logo' },
  },
  propsSchema: SvgPropsSchema,
  canHaveChildren: true,
  htmlTag: 'svg',
  render,
  preview: (props) => preview(props),
}

export { localizeSvgMarkup }
