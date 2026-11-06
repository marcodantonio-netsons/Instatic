import { describe, expect, it } from 'bun:test'
import { visitJsonStrings } from '@core/utils/jsonStrings'

describe('visitJsonStrings', () => {
  it('visits nested string leaves in depth-first order with mapJsonStrings paths', () => {
    const input = {
      props: { title: 'Hello', attributes: [{ label: 'World' }, null, false], empty: '' },
      count: 2,
    }
    const originalInput = input
    const originalProps = input.props
    const originalAttributes = input.props.attributes
    const before = structuredClone(input)
    const seen: Array<[string, string]> = []

    visitJsonStrings(input, (value, path) => seen.push([path, value]))

    expect(seen).toEqual([
      ['props.title', 'Hello'],
      ['props.attributes.0.label', 'World'],
      ['props.empty', ''],
    ])
    expect(input).toBe(originalInput)
    expect(input.props).toBe(originalProps)
    expect(input.props.attributes).toBe(originalAttributes)
    expect(input).toEqual(before)
  })

  it('keeps root-string and root-array path conventions', () => {
    const seen: Array<[string, string]> = []
    visitJsonStrings('root', (value, path) => seen.push([path, value]))
    visitJsonStrings(['first', { second: 'last' }], (value, path) => seen.push([path, value]))

    expect(seen).toEqual([
      ['', 'root'],
      ['.0', 'first'],
      ['.1.second', 'last'],
    ])
  })

  it('propagates visitor errors unchanged', () => {
    const failure = new Error('stop at props.title')

    expect(() => visitJsonStrings({ props: { title: 'Hello' } }, (_value, path) => {
      if (path === 'props.title') throw failure
    })).toThrow(failure)
  })
})
