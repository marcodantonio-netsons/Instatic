import { nanoid } from 'nanoid'
import type { ConditionDef, SiteDocument } from '@core/page-tree'
import { sortViewportContextCascade } from '@core/publisher'
import type { NewStyleRule } from '@core/siteImport'

/** Split a compact rule in the exact base/condition/viewport order of the emitter. */
export function splitRuleContextFragments(
  rule: NewStyleRule,
  breakpoints: SiteDocument['breakpoints'],
  conditions: readonly ConditionDef[],
): NewStyleRule[] {
  const contexts = Object.keys(rule.contextStyles)
  if (!contexts.length || rule.atRule || rule.rawCss !== undefined) return [rule]
  const known = new Set<string>()
  const ordered: string[] = []
  for (const condition of conditions) {
    if (condition.id in rule.contextStyles && !known.has(condition.id)) {
      ordered.push(condition.id)
      known.add(condition.id)
    }
  }
  const viewportEntries = breakpoints.flatMap((breakpoint, index) =>
    breakpoint.id in rule.contextStyles && !known.has(breakpoint.id)
      ? [{ breakpoint, index }]
      : [],
  )
  for (const { breakpoint } of sortViewportContextCascade(viewportEntries)) {
    ordered.push(breakpoint.id)
    known.add(breakpoint.id)
  }
  // Keep unknown contexts inert, as they were in the original compact rule.
  ordered.push(...contexts.filter((context) => !known.has(context)))
  const result: NewStyleRule[] = []
  const hasBase = Object.keys(rule.styles).length > 0 ||
    (rule.kind === 'class' && !(rule.grouping ?? []).some((group) => group.kind === 'context'))
  if (hasBase) result.push({
    ...rule,
    contextStyles: {},
    contextStylePriorities: undefined,
  })
  for (const context of ordered) {
    const grouping = rule.grouping ?? []
    result.push({
      ...rule,
      kind: result.length ? 'ambient' : rule.kind,
      name: result.length ? rule.selector : rule.name,
      styles: {},
      stylePriorities: undefined,
      contextStyles: { [context]: rule.contextStyles[context] },
      contextStylePriorities: rule.contextStylePriorities?.[context]
        ? { [context]: rule.contextStylePriorities[context] }
        : undefined,
      grouping: grouping.some((group) => group.kind === 'context' && group.contextId === context)
        ? grouping
        : [...grouping, { id: nanoid(), kind: 'context', contextId: context }],
    })
  }
  return result
}
