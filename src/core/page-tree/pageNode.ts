/** Page nodes and component nodes share one structural and binding contract. */
import { BaseNodeSchema, parseBaseNodeFields, type BaseNode } from './baseNode'
import { asPlainObject } from './parseHelpers'

export const PageNodeSchema = BaseNodeSchema
export type PageNode = BaseNode

/** Preserve the page parser's required-field path while sharing node normalization. */
export function parsePageNode(raw: unknown, nodePath: string): PageNode {
  const record = asPlainObject(raw)
  if (!record) throw new Error(`${nodePath}: not an object`)
  return parseBaseNodeFields(record, nodePath)
}
