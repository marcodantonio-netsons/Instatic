/**
 * Shared text-normalisation for the HTML importer.
 *
 * Source HTML is pretty-printed: an `<a>` or `<p>` often spans several lines
 * with leading indentation, so its `textContent` carries newlines and runs of
 * spaces (`"\n      instatic"`, `"The Club\n  is how…"`). The browser collapses
 * that whitespace when rendering, so storing it verbatim would surface stray
 * leading spaces / line breaks in the editor's text fields.
 *
 * Only HTML's collapsible ASCII whitespace (TAB, LF, FF, CR and SPACE) is
 * normalized. NBSP, narrow NBSP and other authored Unicode spacing remain
 * content, including at the edges of a text run.
 *
 * Lives in its own module so both `rules.ts` (element → text/label props) and
 * `walkAndMap.ts` (bare text nodes) can share it without an import cycle.
 */
export function collapseHtmlWhitespace(raw: string): string {
  return raw.replace(/[\t\n\f\r ]+/g, ' ')
}

export function trimHtmlWhitespaceStart(raw: string): string {
  return raw.replace(/^[\t\n\f\r ]+/, '')
}

export function trimHtmlWhitespaceEnd(raw: string): string {
  return raw.replace(/[\t\n\f\r ]+$/, '')
}

export function normalizeImportedText(raw: string): string {
  return trimHtmlWhitespaceEnd(trimHtmlWhitespaceStart(collapseHtmlWhitespace(raw)))
}
