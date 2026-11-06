import { describe, expect, it } from 'bun:test'
import { readCookie } from '../../../server/http'

describe('readCookie', () => {
  it('returns the first matching raw value and preserves embedded equals signs', () => {
    const request = {
      headers: { get: (name: string) => name.toLowerCase() === 'cookie'
        ? 'other=value; token=opaque==; token=ignored'
        : null },
    } as unknown as Request

    expect(readCookie(request, 'token')).toBe('opaque==')
    expect(readCookie(request, 'missing')).toBe('')
  })
})
