import { timingSafeEqual } from 'node:crypto'

/** Compare strings without content-dependent timing when their UTF-8 lengths match. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
