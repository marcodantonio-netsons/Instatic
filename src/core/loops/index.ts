/**
 * `@core/loops` barrel — the public entry point for the loop engine.
 *
 * External callers (admin canvas, panels) import the shared loop-item
 * mapping helpers from here so they CONSUME the engine's projection instead
 * of re-deriving it. The canonical `site.pages` loop-item shape and its
 * template include/exclude filter live in `./sources/sitePages` and are
 * re-exported here; the editor canvas preview (`useLoopPreviewItems`) uses
 * them to guarantee canvas previews and published output never diverge.
 */

export { LoopItemSchema } from '@core/loops-schema'
export { LOOP_LOADING_LABEL_DEFAULTS } from './loadingLabels'
export type { LoopItem } from '@core/loops-schema'
export { readLoopQueryBindings, resolveLoopQueryFilters, LoopQueryConfigurationError } from './queryBindings'
export type { LoopQueryBinding } from '@core/loops-schema'
export { pageToLoopItem, filterPagesForLoop } from './sources/sitePages'
export {
  ENTRY_FIELD_FILTER_KEY,
  ENTRY_FIELD_SOURCE_ID,
  resolveEntryFieldItems,
  type EntryFieldMedia,
} from './sources/entryField'

// Media projection shared by the `data.rows` source and the publisher's
// entry-route frame, so `{currentEntry.<mediaField>}` resolves identically.
export { collectMediaIds, resolveMediaIdsToPaths, resolvedMediaOverlay } from './sources/dataRowsMedia'
export { readSummaryLoopIds } from './resultSummary'

export { DataPivotSource, projectDataPivot, readDataPivotConfiguration, DataPivotConfigurationError } from './sources/dataPivot'
export type { DataPivotConfiguration } from './sources/dataPivot'
