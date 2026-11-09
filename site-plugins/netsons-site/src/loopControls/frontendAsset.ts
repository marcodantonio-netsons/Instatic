import { installLoopControlsRuntime } from './browserRuntime'
import { CATALOGUE_QUERY_CONFIGS } from '../catalogueQuery/config'

export const LOOP_CONTROLS_RUNTIME_ASSET_PATH = 'frontend/loop-controls.js'
export const LOOP_CONTROLS_STYLE_ASSET_PATH = 'frontend/loop-controls.css'

/** Declarative manifest entries; the host injects these into published pages. */
export const LOOP_CONTROLS_FRONTEND_ASSETS = [
  { kind: 'script', src: LOOP_CONTROLS_RUNTIME_ASSET_PATH, placement: 'head', strategy: 'defer' },
  { kind: 'style', href: LOOP_CONTROLS_STYLE_ASSET_PATH, placement: 'head-end' },
] as const

/** Browser behavior is independent of host/editor globals and has no runtime imports. */
export const LOOP_CONTROLS_RUNTIME_JS = `(${installLoopControlsRuntime.toString()})(document, ${JSON.stringify(CATALOGUE_QUERY_CONFIGS)});`

export const LOOP_CONTROLS_CSS = [
  '[data-instatic-loop-empty-group][hidden]{display:none}',
  '[data-instatic-loop-more][hidden]{display:none}',
].join('\n')
