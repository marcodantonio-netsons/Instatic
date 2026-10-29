import {
  readCssDeclarationBlock,
  encodeSubstitutionDeclarations,
  cssPropertyNameToStorageKey,
} from '@core/css-substitution'
import { isEmittableProperty } from '@core/publisher'
import type { ImportWarning } from './types'
import type { DeclarationLayer } from './declarationCascade'

interface AuthoredDeclaration {
  property: string
  value: string
  important: boolean
}

/**
 * Keep each authored declaration in its own ordered registry fragment.
 * Property bags are persisted as JSON objects, whose key order is not part of
 * the storage contract (Postgres JSONB reorders them). Distinct property names
 * can still overlap: an opaque `background: var(--hero)` resets every
 * background longhand, and logical properties can overlap physical sides.
 * Native rule order preserves those relationships without a shorthand table
 * or depending on one CSS engine's ability to expand a value.
 *
 * A browser remains the authority on value validity; a headless CSSOM's
 * unsupported value is not data loss.
 */
export function parseAuthoredDeclarationLayers(
  declarations: AuthoredDeclaration[],
  selector: string,
  Sheet: typeof CSSStyleSheet,
  warnings: ImportWarning[],
): DeclarationLayer[] {
  const layers: DeclarationLayer[] = []
  for (const declaration of declarations) {
    const sheet = new Sheet()
    sheet.replaceSync(
      encodeSubstitutionDeclarations(
        `x { ${declaration.property}: ${declaration.value}${declaration.important ? ' !important' : ''}; }`,
      ),
    )
    const rule = sheet.cssRules[0] as CSSStyleRule | undefined
    const parsed: DeclarationLayer = rule
      ? parseStyleDeclarations(rule.style, selector, warnings)
      : { styles: {}, priorities: {} }
    const property = cssPropertyNameToStorageKey(
      declaration.property.startsWith('--')
        ? declaration.property
        : declaration.property.toLowerCase(),
    )
    if (!Object.keys(parsed.styles).length && isEmittableProperty(property)) {
      parsed.styles[property] = declaration.value
      if (declaration.important) parsed.priorities[property] = 'important'
    }
    if (Object.keys(parsed.styles).length) layers.push(parsed)
  }
  if (!layers.length) layers.push({ styles: {}, priorities: {} })
  return layers
}

export function parseStyleDeclarations(
  style: CSSStyleDeclaration,
  selectorForWarning: string,
  warnings: ImportWarning[],
): DeclarationLayer {
  const parsed = readCssDeclarationBlock(style, (camel, kebab) => {
    warnings.push({
      kind: 'blocked-property',
      message: `Property "${camel}" (${kebab}) is blocked for security and was dropped`,
      selector: selectorForWarning,
      property: camel,
    })
  })
  return { styles: parsed.styles, priorities: parsed.priorities }
}
