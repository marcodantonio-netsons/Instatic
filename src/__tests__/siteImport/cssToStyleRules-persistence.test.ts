import { describe, expect, it } from 'bun:test'
import parse from 'postcss/lib/parse'
import { cssToStyleRules } from '@core/siteImport'
import { generateClassCSS, treeShakeStyleRules } from '@core/publisher'
import { parseStyleRule, type StyleRule } from '@core/page-tree'

/** JSONB preserves array order but deliberately does not preserve object keys. */
function reorderObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderObjectKeys)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.length - b.length || a.localeCompare(b))
      .map(([key, child]) => [key, reorderObjectKeys(child)]),
  )
}

function storedCss(source: string): string {
  const parsed = cssToStyleRules(source, { breakpoints: [], mediaTolerance: 0 })
  expect(parsed.warnings).toEqual([])
  const registry: Record<string, StyleRule> = {}
  for (const [index, incoming] of parsed.rules.entries()) {
    const id = String(index)
    const restored = parseStyleRule(reorderObjectKeys({
      ...incoming, id, createdAt: 0, updatedAt: 0,
    }))
    if (!restored) throw new Error('Invalid persisted style rule')
    registry[id] = restored
  }
  const bound = Object.values(registry).filter((rule) => rule.kind === 'class')
  expect(bound).toHaveLength(1)
  const shaken = treeShakeStyleRules(registry, new Set(bound.map((rule) => rule.id)))
  return generateClassCSS(shaken, [], parsed.conditions)
}

function declarationProgram(css: string): Array<[string, string, boolean]> {
  const declarations: Array<[string, string, boolean]> = []
  parse(css).walkDecls((declaration) => {
    declarations.push([declaration.prop, declaration.value, declaration.important ?? false])
  })
  return declarations
}

describe('CSS declaration order survives object-key reordering in persistence', () => {
  for (const [first, second] of [
    ['background-color: initial', 'background: var(--hero)'],
    ['border-top-color: red', 'border: 1px solid var(--line)'],
    ['line-height: 2', 'font: var(--font)'],
    ['animation-duration: 2s', 'animation: var(--motion)'],
    ['margin-inline-start: 4px', 'margin-left: 10px'],
    ['color: red', 'all: initial'],
  ]) {
    for (const declarations of [[first, second], [second, first]]) {
      for (const important of [false, true]) {
        const suffix = important ? ' !important' : ''
        const source = `.x { ${declarations[0]}${suffix}; ${declarations[1]}; }`
        it(source, () => {
          expect(declarationProgram(storedCss(source))).toEqual(declarationProgram(source))
        })
      }
    }
  }

  it('retains a valid opaque multilayer background after initial longhand resets', () => {
    const value = 'radial-gradient(at 80% 30%,#214977,#0000 60%),#101c2c'
    const source = `.x { background-color: initial; background-image: initial; background: ${value}; }`
    const declarations = declarationProgram(storedCss(source))
    expect(declarations).toEqual(declarationProgram(source))
    expect(declarations.at(-1)).toEqual(['background', value, false])
  })

  it('keeps conditional and layered declaration fragments in their original occurrence', () => {
    const source = '@layer hero { @media (min-width: 1px) { .x { background-color: initial; background: var(--hero) !important; } } }'
    const css = storedCss(source)
    expect(declarationProgram(css)).toEqual(declarationProgram(source))
    const root = parse(css)
    expect(root.nodes).toHaveLength(1)
    const layer = root.nodes[0]
    expect(layer.type === 'atrule' && layer.name).toBe('layer')
    const media = layer.type === 'atrule' && layer.nodes?.[0]
    expect(media && media.type === 'atrule' && media.name).toBe('media')
    expect(media && media.type === 'atrule' && media.nodes).toHaveLength(2)
  })
})
