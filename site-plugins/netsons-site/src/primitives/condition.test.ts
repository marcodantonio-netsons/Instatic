import { describe, expect, it } from 'bun:test'
import { ConditionModule } from './index'

describe('authored value conditions', () => {
  it('selects stable entry IDs regardless of their array position', () => {
    const props = { routePath: '/en/plans/example', matchValue: 'feature-network', equals: 'feature-network' }
    expect(ConditionModule.render(props, ['<span>10 Gbit/s</span>'])).toEqual({ html: '<span>10 Gbit/s</span>' })
    expect(ConditionModule.render({ ...props, matchValue: 'feature-cpu' }, ['CPU'])).toEqual({ html: '' })
    expect(ConditionModule.render({ ...props, matchValue: 'feature-cpu', invert: true }, ['CPU'])).toEqual({ html: 'CPU' })
  })

  it('combines explicit comparison with language and visibility conditions', () => {
    expect(ConditionModule.render({ routePath: '/fr/aide', whenLanguage: 'fr' }, ['Visible'])).toEqual({ html: 'Visible' })
    expect(ConditionModule.render({ routePath: '/fr/aide', whenLanguage: 'it' }, ['Hidden'])).toEqual({ html: '' })
    expect(ConditionModule.render({ routePath: '/', show: false, matchValue: 'x', equals: 'x' }, ['Hidden'])).toEqual({ html: '' })
  })
})
