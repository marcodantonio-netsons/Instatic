/**
 * Token interpolation — embeds binding values into string-typed prop
 * values via `{source.field}` placeholders.
 *
 * Today's binding model replaces the entire prop value at render time
 * (`dynamicBindings[propKey] -> field`). Tokens add a second, finer
 * model: the prop value stays a string and contains `{...}` placeholders
 * that the publisher resolves and substitutes inline. Example:
 *
 *     "Welcome to {site.name} — {page.title}!"
 *     => "Welcome to My Site — Hello World!"
 *
 * Why a separate engine: full-value bindings are still needed for
 * non-string props (number, boolean, media src that *must* be just the
 * resolved URL). Tokens are layered on top, only for strings, so we
 * never break the non-string path.
 *
 * Syntax:
 *   - `{source.field}`               — single segment field
 *   - `{source.field.nested.path}`   — dotted path through nested objects and
 *                                       repeater items selected by stable ID
 *   - `\{not-a-token}`               — backslash escape, emits a literal
 *                                       `{not-a-token}` with no replacement
 *
 * Unknown sources / fields / null values resolve to an empty string by
 * default — keeps published HTML clean instead of leaking placeholder
 * syntax. Future per-token fallback strategies can plug in here.
 */

import type { DynamicPropBinding } from '@core/page-tree'
import type { TemplateRenderDataContext } from './renderDataContext'
import { LocalizationError, resolveTranslation } from '@core/localization'
import { readPageTranslationField } from './pageTranslations'
import { readPublicFileField } from '@core/files/references'

// ---------------------------------------------------------------------------
// Source identifiers — must match DynamicBindingSourceSchema
// ---------------------------------------------------------------------------

const VALID_SOURCES: ReadonlySet<DynamicPropBinding['source']> = new Set([
  'currentEntry',
  'parentEntry',
  'page',
  'site',
  'route',
  'file',
])

function isValidSource(s: string): s is DynamicPropBinding['source'] {
  return VALID_SOURCES.has(s as DynamicPropBinding['source'])
}

// ---------------------------------------------------------------------------
// Token serialisation — produce a `{source.field}` literal from a binding.
// Used by the binding picker when inserting tokens into string-typed prop
// values. The output is a valid token that `parseTokenString` round-trips.
// ---------------------------------------------------------------------------

export function bindingToToken(source: DynamicPropBinding['source'], fieldPath: string): string {
  return `{${source}.${fieldPath}}`
}

// ---------------------------------------------------------------------------
// Heuristic — quick scan to avoid lexing strings with no token markers
// ---------------------------------------------------------------------------

/**
 * Cheap check before invoking the full parser. The vast majority of
 * string-typed props in a published page contain no token syntax at all
 * (button labels, html tags, etc.). Detecting that case in O(n) without
 * allocations short-circuits a full parse + concat per render.
 *
 * Any `{` warrants a parse — including an escaped `\{`, which the parser
 * still processes to strip the backslash and emit a literal `{`.
 */
export function containsTokens(value: string): boolean {
  return value.includes('{')
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface TextSegment {
  kind: 'text'
  value: string
}
export interface TokenReference {
  kind: 'token'
  source: DynamicPropBinding['source']
  /** Dotted field path, e.g. "title" or "author.name". Always non-empty. */
  field: string
  /**
   * Optional fallback string emitted when the token resolves to
   * undefined / null / empty string. Authored with `|` after the path:
   * `{site.name|My Site}`. The fallback text is taken verbatim (any
   * trailing whitespace after `|` and before `}` is preserved).
   */
  fallback?: string
  /** Original `{...}` text for verbatim emit when the source is unknown. */
  raw: string
}
type TokenSegmentNode = TextSegment | TokenReference

interface ExpandedTokenReference {
  token: TokenReference
  value: unknown
  framePresent: boolean
  translationStack: readonly string[]
  /** Present for a language-file token after its value has been expanded. */
  expandedTranslation?: string
}

/**
 * Parse a string into a flat list of text and token segments.
 *
 * Lexing rules:
 *   - Backslash before `{` (`\{`) emits a literal `{` and skips token
 *     recognition for that position. The backslash itself is consumed.
 *   - An unescaped `{` opens a token; the matching `}` closes it.
 *   - Inside `{...}` we expect `source.field` or `source.field.path`,
 *     optionally followed by `|fallback text`. The fallback is anything
 *     between the first `|` and the closing `}`, taken verbatim.
 *   - Malformed tokens (unmatched `{`, empty body, unknown source, no
 *     dot, etc.) emit verbatim as text. Never throws — tokens are
 *     author input and should be visible if broken, not break the page.
 */
export function parseTokenString(input: string): TokenSegmentNode[] {
  const segments: TokenSegmentNode[] = []
  let buffer = ''
  let i = 0

  const flushBuffer = () => {
    if (buffer.length > 0) {
      segments.push({ kind: 'text', value: buffer })
      buffer = ''
    }
  }

  while (i < input.length) {
    const c = input[i]!

    // Escape: \{ -> literal {. (\} not special; only `{` triggers tokens.)
    if (c === '\\' && i + 1 < input.length && input[i + 1] === '{') {
      buffer += '{'
      i += 2
      continue
    }

    if (c === '{') {
      const closeIdx = input.indexOf('}', i + 1)
      if (closeIdx === -1) {
        // No closing brace — emit the rest verbatim, including the `{`.
        buffer += input.slice(i)
        i = input.length
        continue
      }
      // Split body on the FIRST `|` to separate the path from the
      // optional fallback. Subsequent `|`s remain part of the fallback
      // text — authors can write `|missing | use this` if they want a
      // literal pipe in their fallback.
      const body = input.slice(i + 1, closeIdx)
      const pipeIdx = body.indexOf('|')
      const pathRaw = pipeIdx >= 0 ? body.slice(0, pipeIdx).trim() : body.trim()
      const fallbackRaw = pipeIdx >= 0 ? body.slice(pipeIdx + 1) : undefined
      const dotIdx = pathRaw.indexOf('.')
      const sourceCandidate = dotIdx > 0 ? pathRaw.slice(0, dotIdx).trim() : ''
      const fieldPath = dotIdx > 0 ? pathRaw.slice(dotIdx + 1).trim() : ''
      if (sourceCandidate && fieldPath && isValidSource(sourceCandidate)) {
        flushBuffer()
        segments.push({
          kind: 'token',
          source: sourceCandidate,
          field: fieldPath,
          ...(fallbackRaw !== undefined ? { fallback: fallbackRaw } : {}),
          raw: input.slice(i, closeIdx + 1),
        })
        i = closeIdx + 1
        continue
      }
      // Malformed — emit `{...}` verbatim including braces.
      buffer += input.slice(i, closeIdx + 1)
      i = closeIdx + 1
      continue
    }

    buffer += c
    i++
  }

  flushBuffer()
  return segments
}

// ---------------------------------------------------------------------------
// Frame access — shared by the token interpolator and the structured
// binding resolver in `dynamicBindings.ts`. Exported so both
// paths use one implementation; there is no second copy anywhere.
// ---------------------------------------------------------------------------

/**
 * Read a frame off the render context by source name. Returns the
 * frame's raw fields map, or `null` when the requested frame is empty
 * or absent (e.g. `currentEntry` outside a loop).
 */
export function readFrame(
  source: DynamicPropBinding['source'],
  context: TemplateRenderDataContext,
): Record<string, unknown> | null {
  switch (source) {
    case 'currentEntry':
    case 'parentEntry': {
      const offsetFromTop = source === 'parentEntry' ? 1 : 0
      const item = context.entryStack[context.entryStack.length - 1 - offsetFromTop]
      return item ? item.fields : null
    }
    case 'page':
      return (context.page as unknown as Record<string, unknown>) ?? null
    case 'site':
      return (context.site as unknown as Record<string, unknown>) ?? null
    case 'route':
      return (context.route as unknown as Record<string, unknown>) ?? null
    case 'file':
      return context.files ?? null
    default:
      return null
  }
}

/**
 * Walk a dotted field path against a frame. Arrays are traversed only when a
 * segment exactly matches an item's own string `id`; numeric segments never
 * select by position. Stops at null/undefined or any unsupported intermediate.
 */
export function walkFieldPath(frame: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.')
  let cursor: unknown = frame[segments[0]!]
  for (let i = 1; i < segments.length; i++) {
    if (cursor === null || cursor === undefined) return undefined
    const segment = segments[i]!
    if (Array.isArray(cursor)) {
      const item = cursor.find((candidate) =>
        candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate) &&
        Object.hasOwn(candidate, 'id') && (candidate as Record<string, unknown>).id === segment,
      )
      if (item === undefined) return undefined
      cursor = item
      continue
    }
    if (typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

/** Shared field resolution keeps catalogue diagnostics identical for both binding forms. */
export function readFrameField(
  source: DynamicPropBinding['source'],
  field: string,
  context: TemplateRenderDataContext,
): unknown {
  if (source === 'page' && field.startsWith('translations.')) {
    return readPageTranslationField(context.page?.translations, field.slice('translations.'.length))
  }
  if (source === 'file') return readPublicFileField(context.files, field)
  if (source === 'site' && field.startsWith('translations.')) {
    return resolveTranslation(context.site?.translations, field.slice('translations.'.length), context.site?.language ?? 'en')
  }
  const frame = readFrame(source, context)
  return frame ? walkFieldPath(frame, field) : undefined
}

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

/**
 * Resolve every `{source.field}` token in `input` against the render
 * context. Missing values resolve to empty strings (clean HTML beats
 * leaked placeholder syntax).
 *
 * Cheap shortcut: if the string contains no `{` markers, return the
 * input untouched without parsing — saves an allocation per static
 * prop value on a typical page.
 */
const MAX_TRANSLATION_TEMPLATE_DEPTH = 32

/**
 * Transform token references while recursively visiting only language-file
 * values. Data returned by currentEntry, page, site, route, and file remains a
 * one-pass value and is never parsed as another template.
 */
function transformExpandedTokenReferences(
  input: string,
  context: TemplateRenderDataContext,
  transform: (reference: ExpandedTokenReference) => string,
): string {
  return transformTokenReferences(input, context, transform, [], true)
}

function transformTokenReferences(
  input: string,
  context: TemplateRenderDataContext,
  transform: (reference: ExpandedTokenReference) => string,
  translationStack: readonly string[],
  resolveNonTranslationValues: boolean,
): string {
  if (!containsTokens(input)) return input
  const segments = parseTokenString(input)
  if (segments.length === 0) return input

  let out = ''
  for (const seg of segments) {
    if (seg.kind === 'text') {
      out += seg.value
      continue
    }
    const isSiteTranslation = seg.source === 'site' && seg.field.startsWith('translations.')
    const frame = resolveNonTranslationValues || isSiteTranslation ? readFrame(seg.source, context) : null
    const rawValue = resolveNonTranslationValues || isSiteTranslation
      ? readFrameField(seg.source, seg.field, context)
      : undefined
    let expandedTranslation: string | undefined
    if (isSiteTranslation && typeof rawValue === 'string') {
      const translationKey = seg.field.slice('translations.'.length)
      const translationPath = `translations.${translationKey}`
      if (translationStack.includes(translationKey)) {
        throw new LocalizationError(
          translationPath,
          `Circular translation template: ${[...translationStack, translationKey].join(' -> ')}`,
        )
      }
      if (translationStack.length >= MAX_TRANSLATION_TEMPLATE_DEPTH) {
        throw new LocalizationError(
          translationPath,
          `Translation templates exceed the maximum nesting depth of ${MAX_TRANSLATION_TEMPLATE_DEPTH}`,
        )
      }
      expandedTranslation = transformTokenReferences(
        rawValue,
        context,
        transform,
        [...translationStack, translationKey],
        resolveNonTranslationValues,
      )
    }
    out += transform({
      token: seg,
      value: rawValue,
      framePresent: Boolean(frame),
      translationStack,
      ...(expandedTranslation !== undefined ? { expandedTranslation } : {}),
    })
  }
  return out
}

/** Walk every authored token, including tokens nested in language-file values. */
export function visitExpandedTokenReferences(
  input: string,
  context: TemplateRenderDataContext,
  visit: (token: TokenReference, translationStack: readonly string[]) => void,
): void {
  transformTokenReferences(input, context, ({ token, translationStack }) => {
    visit(token, translationStack)
    return ''
  }, [], false)
}

export function interpolateTokens(input: string, context: TemplateRenderDataContext): string {
  return transformExpandedTokenReferences(input, context, ({ token, value, framePresent, expandedTranslation }) => {
    if (expandedTranslation !== undefined) return expandedTranslation
    // A token resolves to its fallback (if any) when:
    //   - the frame is absent
    //   - the field path is undefined / null
    //   - the value is an empty string (treat "" as "missing" for the
    //     fallback decision so authors get meaningful copy)
    const missing =
      !framePresent ||
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.length === 0)
    if (missing) return token.fallback ?? ''
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    // Objects / arrays resolve to NOTHING, deliberately. A binding that
    // misses is blank; it never dumps an internal frame shape into HTML.
    return token.fallback ?? ''
  })
}
