import { describe, expect, it } from 'bun:test'
import postcss from 'postcss'
import { PUBLISHER_RESET_CSS } from '@core/publisher'

describe('publisher box-model reset', () => {
  it('targets both pseudo-elements outside forgiving functional selector lists', () => {
    const selectors: string[] = []
    postcss.parse(PUBLISHER_RESET_CSS).walkRules(rule => {
      if (rule.nodes.some(node => node.type === 'decl' && node.prop === 'box-sizing' && node.value === 'border-box')) {
        selectors.push(...rule.selectors)
      }
    })

    // A rule can parse successfully while :where() silently discards its
    // pseudo-element arguments. Each pseudo must be a selector-list subject.
    expect(selectors).toContain('::before')
    expect(selectors).toContain('::after')
    expect(selectors.some(selector => /:(?:where|is)\([^)]*::/.test(selector))).toBe(false)
  })
})
