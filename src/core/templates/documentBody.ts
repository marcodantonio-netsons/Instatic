import type { PageNode } from '@core/page-tree'
import { normalizeHtmlAttributeName } from '@core/htmlAttributes'

/** Merge authored property bags; HTML attributes are owned per attribute name. */
function mergeProps(outer: PageNode['props'], inner: PageNode['props']): PageNode['props'] {
  const merged = { ...outer, ...inner }
  const outerAttrs = outer.htmlAttributes
  const innerAttrs = inner.htmlAttributes
  if (outerAttrs && typeof outerAttrs === 'object' && !Array.isArray(outerAttrs)
    && innerAttrs && typeof innerAttrs === 'object' && !Array.isArray(innerAttrs)) {
    merged.htmlAttributes = Object.fromEntries(
      [...Object.entries(outerAttrs), ...Object.entries(innerAttrs)]
        .map(([name, value]) => [normalizeHtmlAttributeName(name), value]),
    )
  }
  return merged
}

/** An authored inner value owns its field, including any whole-prop binding. */
function mergeBindings<T>(outer: Record<string, T> | undefined, inner: Record<string, T> | undefined, authored: PageNode['props']) {
  const bindings = { ...outer }
  for (const key of Object.keys(authored)) delete bindings[key]
  Object.assign(bindings, inner)
  return Object.keys(bindings).length ? bindings : undefined
}

/**
 * One document body for an outer→inner template chain. Structural identity and
 * children belong to the outer body; presentation comes from every body.
 * Attribute/property conflicts are owned by the closest authored inner body.
 * Class IDs retain outer→inner order and are interned once. No wrapper is made.
 */
export function composeDocumentBody(bodies: readonly PageNode[]): PageNode {
  if (!bodies.length || bodies.some(body => body.moduleId !== 'base.body')) {
    throw new Error('Document body composition requires one or more base.body nodes')
  }
  let body = { ...bodies[0] }
  for (const inner of bodies.slice(1)) {
    const breakpointOverrides = { ...body.breakpointOverrides }
    for (const [breakpoint, props] of Object.entries(inner.breakpointOverrides)) {
      breakpointOverrides[breakpoint] = mergeProps(breakpointOverrides[breakpoint] ?? {}, props)
    }
    const inlineStyles = { ...body.inlineStyles, ...inner.inlineStyles }
    body = {
      ...body,
      props: mergeProps(body.props, inner.props),
      breakpointOverrides,
      classIds: [...new Set([...(body.classIds ?? []), ...(inner.classIds ?? [])])],
      ...(Object.keys(inlineStyles).length ? { inlineStyles } : {}),
      propBindings: mergeBindings(body.propBindings, inner.propBindings, inner.props),
      dynamicBindings: mergeBindings(body.dynamicBindings, inner.dynamicBindings, inner.props),
    }
  }
  return body
}
