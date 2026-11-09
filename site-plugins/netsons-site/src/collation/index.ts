import { Collator } from './generated/collator.js'

const collators = new Map<string, Intl.Collator>()
export function compareLocale(left: string, right: string, language: string, options: Intl.CollatorOptions = {}): number {
  const key = JSON.stringify([language, options])
  let collator = collators.get(key)
  if (!collator) {
    collator = new Collator(language, options)
    collators.set(key, collator)
    if (collators.size > 32) collators.delete(collators.keys().next().value!)
  }
  return collator.compare(left, right)
}
