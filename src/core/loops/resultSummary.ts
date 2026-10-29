import { LoopQueryConfigurationError } from './queryBindings'

/** Author-facing list of stable loop node IDs. */
export function readSummaryLoopIds(value: unknown): string[] {
  if (typeof value !== 'string') throw new LoopQueryConfigurationError('Loop IDs must be a space-separated list', 'loopIds')
  const ids = [...new Set(value.trim().split(/\s+/).filter(Boolean))]
  if (ids.length > 32 || ids.some(id => id.length > 256 || [...id].some(character => character.charCodeAt(0) < 32))) throw new LoopQueryConfigurationError('Invalid loop IDs', 'loopIds')
  return ids
}
