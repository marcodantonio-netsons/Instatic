import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { PluginModuleDefinition } from '@instatic/plugin-sdk'
import { escapeHtml } from '../shared/htmlSafety'
import { languageFromPath, localizeRenderProps, translate } from '../localization'

const SvgPropsSchema = Type.Object({
  svg: Type.String({ default: '' }),
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

function resolvedProps(input: Record<string, unknown>): { svg: string; title: string } {
  if (typeof input.routePath !== 'string') throw Error('A resolved route path is required for SVG localization')
  const language = languageFromPath(input.routePath)
  const authored = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'routePath'))
  const defaulted: unknown = Value.Default(SvgPropsSchema, authored)
  if (!Value.Check(SvgPropsSchema, defaulted)) throw Error('Invalid SVG module properties')
  const parsed = Value.Parse(SvgPropsSchema, defaulted)
  const localizedTitle = localizeRenderProps({ title: parsed.title }, language).title
  if (typeof localizedTitle !== 'string') throw Error('Invalid SVG accessible label')

  return {
    // `svg` has already passed the publisher's `type: 'svg'` DOMPurify boundary.
    // Translate only the authored tokens now, escaping inserted copy so it
    // cannot add SVG markup after that boundary.
    svg: localizeSvgMarkup(parsed.svg, language),
    title: localizedTitle,
  }
}

function render(input: Record<string, unknown>) {
  const { svg, title } = resolvedProps(input)
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
    svg: { type: 'svg', label: 'SVG' },
    title: { type: 'text', label: 'Accessible label', placeholder: 'e.g. Company logo' },
  },
  propsSchema: SvgPropsSchema,
  canHaveChildren: false,
  htmlTag: 'svg',
  render: (props) => render(props),
  preview: (props) => preview(props),
}

export { localizeSvgMarkup }
