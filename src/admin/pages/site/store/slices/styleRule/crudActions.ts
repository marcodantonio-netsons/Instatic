/**
 * styleRule slice — create + update of style rules and their per-context
 * style bags: createClass, createAmbientRule, updateClassStyles,
 * setClassContextStyles.
 */

import { nanoid } from 'nanoid'
import type { StyleRule, CSSRuleGroup } from '@core/page-tree'
import { classKindSelector } from '@core/page-tree'
import { isGeneratedClassLocked } from '@core/page-tree'
import { assertValidCssClassName } from '@core/page-tree'
import { styleRuleSelector } from '@core/page-tree'
import { cssPropertyNameToStorageKey } from '@core/css-substitution'
import type { NewStyleRule } from '@core/siteImport'
import { isValidCssSelector } from '../../styleRuleRename'
import type { SiteSliceHelpers } from '../site/types'
import type { StyleRuleSlice } from './types'
import { nextRuleOrder, ruleOrderAfter, hasStylePatchChanges, removeStyleRuleReferences } from './helpers'
import { remapImportedRuleGroups } from '../site/importLinking'
import { splitRuleContextFragments } from './contextFragments'
import {
  clonePriorityBag, cloneContextPriorities, payloadFromRule, payloadEqual,
  emptyPayload, writePayload, type PriorityBag, type RulePayload,
} from './rulePayload'

type CrudActions = Pick<
  StyleRuleSlice,
  | 'createClass'
  | 'createAmbientRule'
  | 'updateClassStyles'
  | 'setClassContextStyles'
  | 'applyCssRules'
  | 'deleteCssRules'
  | 'removeCssRuleProperties'
>

function groupIdentity(group: CSSRuleGroup): unknown[] {
  return group.kind === 'context'
    ? ['context', group.contextId]
    : ['layer', group.name ?? null, group.name === undefined ? group.id : null]
}

function ruleIdentity(rule: StyleRule | NewStyleRule): string {
  return JSON.stringify([
    styleRuleSelector(rule),
    (rule.grouping ?? []).map(groupIdentity),
    rule.atRule?.kind ?? null,
    rule.atRule?.kind === 'group' ? groupIdentity(rule.atRule.group) : null,
  ])
}

/** Replace addresses a selector's complete condition cascade within its layer path. */
function ruleLayerIdentity(rule: StyleRule | NewStyleRule): string {
  return JSON.stringify([
    styleRuleSelector(rule),
    (rule.grouping ?? []).filter((group) => group.kind === 'layer').map(groupIdentity),
    rule.atRule?.kind ?? null,
    rule.atRule?.kind === 'group' ? groupIdentity(rule.atRule.group) : null,
  ])
}

function rulesBySelector(rules: Record<string, StyleRule>): Map<string, StyleRule[]> {
  const index = new Map<string, StyleRule[]>()
  for (const rule of Object.values(rules)) {
    const selector = styleRuleSelector(rule)
    const matches = index.get(selector)
    if (matches) matches.push(rule)
    else index.set(selector, [rule])
  }
  return index
}

const SIDE_STORAGE_KEYS: Record<string, string[]> = {
  padding: ['padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
  margin: ['margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft'],
}

function storageKeysForProperty(property: string): string[] {
  const storageKey = cssPropertyNameToStorageKey(property)
  return SIDE_STORAGE_KEYS[storageKey] ?? [storageKey]
}

function ruleHasAnyProperty(rule: StyleRule, keys: readonly string[]): boolean {
  if (keys.some((key) => key in rule.styles)) return true
  return Object.values(rule.contextStyles).some((styles) => keys.some((key) => key in styles))
}

function deletePriorityKeys(priorities: PriorityBag | undefined, keys: readonly string[]): void {
  if (!priorities) return
  for (const key of keys) delete priorities[key]
}

export function createCrudActions({
  get,
  mutateSite,
  mutateSiteState,
}: SiteSliceHelpers): CrudActions {
  return {
    createClass(name, styles = {}) {
      const { site } = get()
      if (!site) throw new Error('[styleRuleSlice] Site document is not initialized')
      assertValidCssClassName(name)

      // Uniqueness check
      const existing = Object.values(site.styleRules).find((c) => c.name === name)
      if (existing) throw new Error(`[styleRuleSlice] A class named "${name}" already exists`)

      const now = Date.now()
      const newClass: StyleRule = {
        id: nanoid(),
        name,
        kind: 'class',
        selector: classKindSelector(name),
        order: nextRuleOrder(site.styleRules),
        styles,
        contextStyles: {},
        createdAt: now,
        updatedAt: now,
      }

      mutateSite((site) => {
        site.styleRules[newClass.id] = newClass
        return true
      })

      return newClass
    },

    createAmbientRule(input) {
      const { site } = get()
      if (!site) throw new Error('[styleRuleSlice] Site document is not initialized')

      const selector = input.selector.trim()
      if (selector.length === 0) {
        throw new Error('[styleRuleSlice] Ambient selector cannot be empty')
      }
      if (!isValidCssSelector(selector)) {
        throw new Error(`[styleRuleSlice] Invalid CSS selector: ${selector}`)
      }

      // Default display name to the selector text. Unlike class-kind rules,
      // ambient rule names are not required to be globally unique — multiple
      // rules can share a selector (cascade resolves by `order`).
      const name = input.name && input.name.trim().length > 0 ? input.name.trim() : selector

      const now = Date.now()
      const newRule: StyleRule = {
        id: nanoid(),
        name,
        kind: 'ambient',
        selector,
        order: nextRuleOrder(site.styleRules),
        styles: input.styles ?? {},
        contextStyles: input.contextStyles ?? {},
        createdAt: now,
        updatedAt: now,
      }

      mutateSite((site) => {
        site.styleRules[newRule.id] = newRule
        return true
      })

      return newRule
    },

    updateClassStyles(classId, patch) {
      const { site } = get()
      const cls = site?.styleRules[classId]
      if (!cls) return
      if (isGeneratedClassLocked(cls)) return
      if (!hasStylePatchChanges(cls.styles, patch)) return

      mutateSite((site) => {
        const draftClass = site.styleRules[classId]
        if (!draftClass) return false
        Object.assign(draftClass.styles, patch)
        // Remove keys explicitly set to undefined/null (allow clearing a property)
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === null) {
            delete draftClass.styles[k]
            delete draftClass.stylePriorities?.[k]
          }
        }
        if (draftClass.stylePriorities && Object.keys(draftClass.stylePriorities).length === 0) {
          delete draftClass.stylePriorities
        }
        draftClass.updatedAt = Date.now()
        return true
      })
    },

    setClassContextStyles(classId, contextId, patch) {
      const { site } = get()
      const cls = site?.styleRules[classId]
      if (!cls) return
      if (isGeneratedClassLocked(cls)) return
      const currentStyles = cls.contextStyles[contextId] ?? {}
      if (!hasStylePatchChanges(currentStyles, patch)) return

      mutateSite((site) => {
        const draftClass = site.styleRules[classId]
        if (!draftClass) return false
        if (!draftClass.contextStyles[contextId]) {
          draftClass.contextStyles[contextId] = {}
        }
        Object.assign(draftClass.contextStyles[contextId], patch)
        // Remove keys explicitly set to undefined/null
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === null) {
            delete draftClass.contextStyles[contextId][k]
            delete draftClass.contextStylePriorities?.[contextId]?.[k]
          }
        }
        const contextPriorities = draftClass.contextStylePriorities?.[contextId]
        if (contextPriorities && Object.keys(contextPriorities).length === 0) {
          delete draftClass.contextStylePriorities?.[contextId]
        }
        if (
          draftClass.contextStylePriorities &&
          Object.keys(draftClass.contextStylePriorities).length === 0
        ) {
          delete draftClass.contextStylePriorities
        }
        draftClass.updatedAt = Date.now()
        return true
      })
    },

    applyCssRules(rules, conditions, mode) {
      const { site } = get()
      if (!site) return { created: 0, updated: 0, blockedSelectors: [] }
      const allConditions = [...(site.conditions ?? []), ...conditions]
      const incoming = remapImportedRuleGroups(rules.flatMap((rule) =>
        splitRuleContextFragments(rule, site.breakpoints, allConditions),
      )).map((source) => ({
        selector: styleRuleSelector(source),
        source,
        payload: payloadFromRule(source),
        identity: ruleIdentity(source),
      }))
      const existingBySelector = rulesBySelector(site.styleRules)
      const blockedSelectors = incoming
        .filter(({ selector }) =>
          (existingBySelector.get(selector) ?? []).some(isGeneratedClassLocked),
        )
        .map(({ selector }) => selector)
      if (blockedSelectors.length > 0) {
        return { created: 0, updated: 0, blockedSelectors }
      }

      let created = 0
      let updated = 0

      mutateSiteState((state, site) => {
        let mutated = false

        // Register referenced reusable conditions before their context bags.
        if (conditions.length > 0) {
          if (!site.conditions) site.conditions = []
          const known = new Set(site.conditions.map((c) => c.id))
          for (const def of conditions) {
            if (known.has(def.id)) continue
            known.add(def.id)
            site.conditions.push(def)
            mutated = true
          }
        }

        // Compact editor rules can carry base and responsive bags together.
        // Materialize their existing emission sequence before inserting a new
        // declaration, so a base patch cannot jump after its own overrides.
        const selectors = new Set(incoming
          .filter((item) => mode === 'replace' || !emptyPayload(item.payload))
          .map((item) => item.selector))
        const now = Date.now()
        for (const rule of Object.values(site.styleRules).sort((a, b) => a.order - b.order)) {
          if (!selectors.has(styleRuleSelector(rule))) continue
          const fragments = splitRuleContextFragments(rule, site.breakpoints, site.conditions ?? [])
          if (fragments.length === 1 && payloadEqual(payloadFromRule(rule), payloadFromRule(fragments[0]))) continue
          writePayload(rule, payloadFromRule(fragments[0]))
          rule.updatedAt = now
          updated++
          mutated = true
          let anchor = rule
          for (const fragment of fragments.slice(1)) {
            const id = nanoid()
            const companion: StyleRule = {
              ...fragment, id, order: ruleOrderAfter(site.styleRules, anchor),
              createdAt: now, updatedAt: now,
            }
            site.styleRules[id] = companion
            anchor = companion
            created++
          }
        }

        const targetByIdentity = new Map<string, StyleRule[]>()
        for (const target of Object.values(site.styleRules).sort((a, b) => a.order - b.order)) {
          const identity = ruleIdentity(target)
          const matches = targetByIdentity.get(identity) ?? []
          matches.push(target)
          targetByIdentity.set(identity, matches)
        }
        const itemsByIdentity = new Map<string, typeof incoming>()
        for (const item of incoming) {
          if (mode === 'merge' && emptyPayload(item.payload) && existingBySelector.has(item.selector)) continue
          const items = itemsByIdentity.get(item.identity) ?? []
          items.push(item)
          itemsByIdentity.set(item.identity, items)
        }
        const payloads = new Map<string, RulePayload>()
        const slotsByIdentity = new Map<string, StyleRule[]>()
        for (const [identity, items] of itemsByIdentity) {
          const candidates = targetByIdentity.get(identity) ?? []
          const baseKeys = new Set(items.flatMap((item) => Object.keys(item.payload.styles)))
          const contextKeys = new Map<string, Set<string>>()
          for (const item of items) {
            for (const [context, bag] of Object.entries(item.payload.contextStyles)) {
              const keys = contextKeys.get(context) ?? new Set<string>()
              for (const key of Object.keys(bag)) keys.add(key)
              contextKeys.set(context, keys)
            }
          }
          const addressed: StyleRule[] = []
          for (const candidate of candidates) {
            const payload = payloadFromRule(candidate)
            let touched = mode === 'replace' || !!candidate.atRule || candidate.rawCss !== undefined
            if (mode === 'merge') {
              for (const key of baseKeys) {
                if (key in payload.styles) touched = true
                delete payload.styles[key]
                delete payload.stylePriorities?.[key]
              }
              for (const [context, keys] of contextKeys) {
                for (const key of keys) {
                  if (key in (payload.contextStyles[context] ?? {})) touched = true
                  delete payload.contextStyles[context]?.[key]
                  delete payload.contextStylePriorities?.[context]?.[key]
                }
              }
              payload.stylePriorities = clonePriorityBag(payload.stylePriorities)
              payload.contextStylePriorities = cloneContextPriorities(payload.contextStylePriorities)
            }
            payloads.set(candidate.id, payload)
            if (touched) addressed.push(candidate)
          }
          const slots = addressed.length ? addressed : candidates.slice(-1)
          // A one-property upsert replaces its last source occurrence. A full
          // declaration program retains each occurrence instead of collapsing
          // repeated selectors across intervening competing rules.
          slotsByIdentity.set(identity, mode === 'replace' ? slots.slice(0, items.length) : slots.slice(-items.length))
        }
        const positions = new Map<string, number>()
        const anchors = new Map<string, StyleRule>()
        const addressedLayers = new Set(incoming.map((item) => ruleLayerIdentity(item.source)))
        const retained = new Set<string>()
        const classByName = new Map(
          Object.values(site.styleRules)
            .filter((rule) => rule.kind === 'class')
            .map((rule) => [rule.name, rule]),
        )
        for (const item of incoming) {
          if (mode === 'merge' && emptyPayload(item.payload) && existingBySelector.has(item.selector)) continue
          const candidates = slotsByIdentity.get(item.identity) ?? []
          const position = positions.get(item.identity) ?? 0
          positions.set(item.identity, position + 1)
          const binding =
            item.source.kind === 'class' ? classByName.get(item.source.name) : undefined
          if (
            mode === 'replace' && binding && !retained.has(binding.id) &&
            addressedLayers.has(ruleLayerIdentity(binding)) &&
            candidates[position]?.id !== binding.id
          ) {
            // Keep the binding as an empty anchor at its own source position;
            // conditional declarations retain their existing later position.
            const bindingPayload = payloadFromRule(binding)
            bindingPayload.styles = {}
            bindingPayload.contextStyles = {}
            delete bindingPayload.stylePriorities
            delete bindingPayload.contextStylePriorities
            payloads.set(binding.id, bindingPayload)
            retained.add(binding.id)
            if (!candidates.length) anchors.set(item.identity, binding)
          }
          const target = candidates[position]
          const current = target && payloads.get(target.id)
          const reusable = target && current && (
            mode === 'replace' || target.atRule || target.rawCss !== undefined ||
            (Object.keys(current.styles).length === 0 &&
              Object.values(current.contextStyles).every((bag) => Object.keys(bag).length === 0))
          )
          if (target && current && reusable) {
            const patch = { ...item.payload, grouping: current.grouping }
            if (patch.atRule?.kind === 'group' && current.atRule?.kind === 'group') {
              patch.atRule = { ...patch.atRule, group: current.atRule.group }
            }
            payloads.set(target.id, patch)
            retained.add(target.id)
            anchors.set(item.identity, target)
            continue
          }

          const id = nanoid()
          const anchor = targetByIdentity.has(item.identity)
            ? target ?? anchors.get(item.identity) ?? candidates.at(-1)
            : undefined
          const newRule: StyleRule = {
            ...item.source,
            ...item.payload,
            id,
            order: anchor ? ruleOrderAfter(site.styleRules, anchor) : nextRuleOrder(site.styleRules),
            createdAt: now,
            updatedAt: now,
            kind: binding ? 'ambient' : item.source.kind,
          }
          site.styleRules[id] = newRule
          retained.add(id)
          anchors.set(item.identity, newRule)
          if (newRule.kind === 'class') classByName.set(newRule.name, newRule)
          created++
          mutated = true
        }

        const removedClassIds = new Set<string>()
        for (const rule of Object.values(site.styleRules)) {
          const payload = payloads.get(rule.id)
          const emptyAmbient = mode === 'merge' && payload && !retained.has(rule.id) &&
            rule.kind === 'ambient' && !payload.atRule && payload.rawCss === undefined &&
            Object.keys(payload.styles).length === 0 &&
            Object.values(payload.contextStyles).every((bag) => Object.keys(bag).length === 0)
          if (emptyAmbient || (mode === 'replace' && !retained.has(rule.id) &&
            addressedLayers.has(ruleLayerIdentity(rule)))) {
            if (rule.kind === 'class') removedClassIds.add(rule.id)
            delete site.styleRules[rule.id]
            mutated = true
          } else if (payload && !payloadEqual(payloadFromRule(rule), payload)) {
            writePayload(rule, payload)
            rule.updatedAt = now
            updated++
            mutated = true
          }
        }
        removeStyleRuleReferences(state, site, removedClassIds)

        return mutated
      })

      return { created, updated, blockedSelectors: [] }
    },

    deleteCssRules(selectors) {
      const { site } = get()
      if (!site) {
        return { deleted: 0, missingSelectors: selectors, blockedSelectors: [] }
      }
      const requested = [...new Set(selectors.map((selector) => selector.trim()))]
      const existingBySelector = rulesBySelector(site.styleRules)
      const missingSelectors = requested.filter(
        (selector) => (existingBySelector.get(selector) ?? []).length === 0,
      )
      const blockedSelectors = requested.filter((selector) =>
        (existingBySelector.get(selector) ?? []).some(isGeneratedClassLocked),
      )
      if (missingSelectors.length > 0 || blockedSelectors.length > 0) {
        return { deleted: 0, missingSelectors, blockedSelectors }
      }

      const ids = requested.flatMap((selector) =>
        (existingBySelector.get(selector) ?? []).map((rule) => rule.id),
      )
      get().deleteClasses(ids)
      return { deleted: ids.length, missingSelectors: [], blockedSelectors: [] }
    },

    removeCssRuleProperties(selectors, properties) {
      const { site } = get()
      if (!site) {
        return {
          updated: 0,
          removed: 0,
          missingSelectors: selectors,
          missingProperties: properties,
          blockedSelectors: [],
        }
      }
      const requestedSelectors = [...new Set(selectors.map((selector) => selector.trim()))]
      const requestedProperties = [...new Set(properties.map((property) => property.trim()))]
      const existingBySelector = rulesBySelector(site.styleRules)
      const missingSelectors = requestedSelectors.filter(
        (selector) => (existingBySelector.get(selector) ?? []).length === 0,
      )
      const blockedSelectors = requestedSelectors.filter((selector) =>
        (existingBySelector.get(selector) ?? []).some(isGeneratedClassLocked),
      )
      const targets = requestedSelectors.flatMap(
        (selector) => existingBySelector.get(selector) ?? [],
      )
      const propertyKeys = new Map(
        requestedProperties.map((property) => [property, storageKeysForProperty(property)]),
      )
      const missingProperties = requestedProperties.filter(
        (property) =>
          !targets.some((rule) => ruleHasAnyProperty(rule, propertyKeys.get(property) ?? [])),
      )

      if (
        missingSelectors.length > 0 ||
        blockedSelectors.length > 0 ||
        missingProperties.length > 0
      ) {
        return {
          updated: 0,
          removed: 0,
          missingSelectors,
          missingProperties,
          blockedSelectors,
        }
      }

      const keys = [...new Set([...propertyKeys.values()].flat())]
      let updated = 0
      let removed = 0
      mutateSite((site) => {
        const now = Date.now()
        for (const target of targets) {
          const draftRule = site.styleRules[target.id]
          if (!draftRule) continue
          let ruleChanged = false
          for (const key of keys) {
            if (key in draftRule.styles) {
              delete draftRule.styles[key]
              removed++
              ruleChanged = true
            }
            for (const contextStyles of Object.values(draftRule.contextStyles)) {
              if (key in contextStyles) {
                delete contextStyles[key]
                removed++
                ruleChanged = true
              }
            }
          }
          deletePriorityKeys(draftRule.stylePriorities, keys)
          if (draftRule.stylePriorities && Object.keys(draftRule.stylePriorities).length === 0) {
            delete draftRule.stylePriorities
          }
          for (const priorities of Object.values(draftRule.contextStylePriorities ?? {})) {
            deletePriorityKeys(priorities, keys)
          }
          if (draftRule.contextStylePriorities) {
            for (const [contextId, priorities] of Object.entries(
              draftRule.contextStylePriorities,
            )) {
              if (Object.keys(priorities).length === 0) {
                delete draftRule.contextStylePriorities[contextId]
              }
            }
            if (Object.keys(draftRule.contextStylePriorities).length === 0) {
              delete draftRule.contextStylePriorities
            }
          }
          if (!ruleChanged) continue
          draftRule.updatedAt = now
          updated++
        }
        return updated > 0
      })

      return {
        updated,
        removed,
        missingSelectors: [],
        missingProperties: [],
        blockedSelectors: [],
      }
    },
  }
}
