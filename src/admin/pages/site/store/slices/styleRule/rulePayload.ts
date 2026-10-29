/** Clone, compare and assign a style rule's declaration payload. */
import { Value } from '@sinclair/typebox/value'
import type { CSSDeclarationPriorityBag, StyleRule } from '@core/page-tree'
import type { NewStyleRule } from '@core/siteImport'

export type PriorityBag = CSSDeclarationPriorityBag

export type RulePayload = Pick<StyleRule,
  | 'styles' | 'contextStyles' | 'stylePriorities' | 'contextStylePriorities'
  | 'rawCss' | 'grouping' | 'atRule'
>

export function clonePriorityBag(priorities: PriorityBag | undefined): PriorityBag | undefined {
  if (!priorities || Object.keys(priorities).length === 0) return undefined
  return { ...priorities }
}

function cloneContextStyles(
  contexts: Record<string, Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(contexts ?? {}).map(([contextId, styles]) => [contextId, { ...styles }]),
  )
}

export function cloneContextPriorities(
  contexts: Record<string, PriorityBag> | undefined,
): Record<string, PriorityBag> | undefined {
  if (!contexts) return undefined
  const cloned = Object.fromEntries(
    Object.entries(contexts)
      .filter(([, priorities]) => Object.keys(priorities).length > 0)
      .map(([contextId, priorities]) => [contextId, { ...priorities }]),
  )
  return Object.keys(cloned).length > 0 ? cloned : undefined
}

export function payloadFromRule(rule: StyleRule | NewStyleRule): RulePayload {
  return {
    styles: { ...rule.styles },
    contextStyles: cloneContextStyles(rule.contextStyles),
    stylePriorities: clonePriorityBag(rule.stylePriorities),
    contextStylePriorities: cloneContextPriorities(rule.contextStylePriorities),
    ...(rule.rawCss !== undefined ? { rawCss: rule.rawCss } : {}),
    ...(rule.grouping ? { grouping: Value.Clone(rule.grouping) } : {}),
    ...(rule.atRule ? { atRule: Value.Clone(rule.atRule) } : {}),
  }
}

function orderedBagEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  if (leftEntries.length !== rightEntries.length) return false
  return leftEntries.every(([key, value], index) => {
    const rightEntry = rightEntries[index]
    return rightEntry?.[0] === key && Object.is(rightEntry[1], value)
  })
}

function priorityBagEqual(left: PriorityBag | undefined, right: PriorityBag | undefined): boolean {
  const leftEntries = Object.entries(left ?? {})
  const rightEntries = Object.entries(right ?? {})
  if (leftEntries.length !== rightEntries.length) return false
  return leftEntries.every(([key, value]) => right?.[key] === value)
}

function contextStylesEqual(
  left: Record<string, Record<string, unknown>>,
  right: Record<string, Record<string, unknown>>,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((contextId) => {
    const rightBag = right[contextId]
    return rightBag !== undefined && orderedBagEqual(left[contextId], rightBag)
  })
}

function contextPrioritiesEqual(
  left: Record<string, PriorityBag> | undefined,
  right: Record<string, PriorityBag> | undefined,
): boolean {
  const leftContexts = left ?? {}
  const rightContexts = right ?? {}
  const leftKeys = Object.keys(leftContexts)
  const rightKeys = Object.keys(rightContexts)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((contextId) =>
    priorityBagEqual(leftContexts[contextId], rightContexts[contextId]),
  )
}

export function payloadEqual(left: RulePayload, right: RulePayload): boolean {
  return (
    orderedBagEqual(left.styles, right.styles) &&
    contextStylesEqual(left.contextStyles, right.contextStyles) &&
    priorityBagEqual(left.stylePriorities, right.stylePriorities) &&
    contextPrioritiesEqual(left.contextStylePriorities, right.contextStylePriorities) &&
    Object.is(left.rawCss, right.rawCss) &&
    JSON.stringify(left.grouping) === JSON.stringify(right.grouping) &&
    JSON.stringify(left.atRule) === JSON.stringify(right.atRule)
  )
}

export function emptyPayload(payload: RulePayload): boolean {
  return !payload.atRule && payload.rawCss === undefined &&
    Object.keys(payload.styles).length === 0 &&
    Object.values(payload.contextStyles).every((bag) => Object.keys(bag).length === 0)
}

export function writePayload(target: StyleRule, payload: RulePayload): void {
  target.styles = payload.styles
  target.contextStyles = payload.contextStyles
  if (payload.stylePriorities) target.stylePriorities = payload.stylePriorities
  else delete target.stylePriorities
  if (payload.contextStylePriorities) {
    target.contextStylePriorities = payload.contextStylePriorities
  } else {
    delete target.contextStylePriorities
  }
  if (payload.rawCss !== undefined) target.rawCss = payload.rawCss
  else delete target.rawCss
  if (payload.grouping !== undefined) target.grouping = payload.grouping
  else delete target.grouping
  if (payload.atRule !== undefined) target.atRule = payload.atRule
  else delete target.atRule
}
