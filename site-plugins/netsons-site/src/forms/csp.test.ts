import { describe, expect, it } from 'bun:test'
import { augmentFormsCsp } from './csp'

describe('form action CSP origins', () => {
  for (const [action, origin] of [
    ['https://forms2.example.test/submit', 'https://forms2.example.test'],
    ['http://127.0.0.1:8080/submit', 'http://127.0.0.1:8080'],
    ['http://[::1]:8080/submit', 'http://[::1]:8080'],
  ]) {
    it(`accepts the valid numeric host in ${action}`, () => {
      const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; form-action 'self'; connect-src 'self';"></head><body><form data-instatic-form-mode="request" action="${action}"></form></body></html>`
      const result = augmentFormsCsp(html)
      expect(result).toContain(origin)
      expect(augmentFormsCsp(result)).toBe(result)
    })
  }
})
