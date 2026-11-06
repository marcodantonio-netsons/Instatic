/**
 * DynamicBindingControl — binding affordance wrapper.
 *
 * Wraps any property control child in two modes:
 *
 *  Unbound: renders children with a BracesIcon affordance button (visible on
 *    hover/focus-within) that opens the shared DataBindingPicker.
 *
 *  Bound: replaces the child with a striped badge showing the resolved field
 *    label, plus a clear button.
 *
 * The picker itself is shared with the Content workspace through
 * `@admin/shared/DataBindingPicker`; this wrapper supplies Site-specific
 * template, loop, and page-frame context.
 */

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import type { PropertyControl } from '@core/module-engine'
import type { DynamicPropBinding } from '@core/page-tree'
import type { LoopSourceField } from '@core/loops/types'
import type { DataMeta } from '@core/data/schemas'
import {
  buildPageFrame,
  buildRouteFrame,
  buildSiteFrame,
} from '@core/templates/contextFrames'
import { primaryTemplateTableSlug } from '@core/templates'
import { selectActivePage, useEditorStore } from '@site/store/store'
import { Button } from '@ui/components/Button'
import { CloseIcon } from 'pixel-art-icons/icons/close'
import { BracesIcon } from 'pixel-art-icons/icons/braces'
import { DataBindingPicker } from '@admin/shared/DataBindingPicker'
import { _cachedMeta, loadDataMeta } from '@admin/shared/DataBindingPicker/cache'
import { bindingToToken } from '@core/templates/tokenInterpolation'
import { buildPublicFileReferences } from '@core/files/references'
import { resolveBindingLabel } from '@admin/shared/DataBindingPicker/helpers'
import { cn } from '@ui/cn'
import { Select } from '@ui/components/Select'
import styles from './DynamicBindingControl.module.css'
import controlStyles from '@ui/components/ControlRow/ControlRow.module.css'

const NumberBindingOptions = lazy(() => import('./NumberBindingOptions').then((module) => ({
  default: module.NumberBindingOptions,
})))

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DynamicBindingControlProps {
  propKey: string
  label: string
  control: PropertyControl
  layout?: 'inline' | 'stacked'
  binding?: DynamicPropBinding
  onSet: (binding: DynamicPropBinding) => void
  onClear: () => void
  /**
   * Insertion mode — used for string-typed property controls. When set,
   * the picker INSERTS a `{source.field}` token into the prop value at
   * the input's caret (via `onInsertToken`) instead of writing a
   * structured entry to `dynamicBindings`. The bound-state striped chip
   * is suppressed in this mode; the actual token shows up in the
   * underlying text input as ordinary characters.
   *
   * Non-string controls (number, toggle) keep the structured whole-prop
   * path because tokens can't carry non-string values.
   */
  insertMode?: boolean
  /**
   * Callback for `insertMode === true`. Receives the `{source.field}`
   * token string; the control implementation decides whether to append,
   * insert at caret, or replace the current value.
   */
  onInsertToken?: (token: string) => void
  /**
   * Fields offered by the closest enclosing loop source. When provided, an
   * additional "Loop" scope entry appears in the picker's left pane. These
   * are distinct from DataMeta fields: they include synthesised columns
   * (authorName, permalink, publishedAt, etc.) that live outside the table's
   * field definitions.
   */
  availableFields?: LoopSourceField[]
  /** Human label for the loop source — shown in the left pane. */
  sourceLabel?: string
  /**
   * Table id of the data table this loop iterates (only set when the
   * enclosing loop uses `data.rows`). When provided, the picker auto-scopes
   * to that single table — hiding the left pane and showing its fields
   * directly, plus the loop's synthetic fields in a separate group.
   */
  loopTableId?: string | null
  children: ReactNode
}

export function DynamicBindingControl({
  propKey,
  label,
  control,
  layout = 'inline',
  binding,
  onSet,
  onClear,
  insertMode = false,
  onInsertToken,
  availableFields,
  sourceLabel,
  loopTableId,
  children,
}: DynamicBindingControlProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerAction, setPickerAction] = useState<'token' | 'binding'>(insertMode ? 'token' : 'binding')
  // Refs the popover uses for positioning + trigger-click handling.
  //  - `wrapperRef`: anchor — popover opens below this element (the input
  //    + {} affordance row), spanning its width.
  //  - `triggerRef`: the {} button — clicks here while open don't count
  //    as outside-clicks, so the toggle below stays in charge of state.
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  // Lazy initializer picks up already-cached meta so bound-state labels are
  // immediately resolved without needing an initial synchronous setState.
  const [resolvedMeta, setResolvedMeta] = useState<DataMeta | null>(() => _cachedMeta)
  useEffect(() => {
    if (_cachedMeta) return // already in state via lazy initializer
    // Pre-load meta so bound-state labels resolve on next render.
    loadDataMeta()
      .then((m) => setResolvedMeta(m))
      .catch(() => { /* ignore — label falls back to field id */ })
  }, [])
  const activePage = useEditorStore(selectActivePage)
  const activeSite = useEditorStore((s) => s.site)
  const activePageTableSlug = activePage
    ? primaryTemplateTableSlug(activePage)
    : null
  let pageFrame: ReturnType<typeof buildPageFrame> | null = null
  let siteFrame = null
  try {
    pageFrame = activePage && activeSite ? buildPageFrame(activePage, activeSite) : null
    siteFrame = activeSite ? buildSiteFrame(activeSite, activePage?.language) : null
  } catch (_error) {
    // Canvas reports language/relationship errors; keep their authoring controls editable.
  }
  const routeFrame = pageFrame ? buildRouteFrame(pageFrame.permalink) : null
  const publicFiles = activeSite ? buildPublicFileReferences(activeSite.files) : undefined

  // ── Bound state (structured whole-prop binding) ─────────────────────────
  // In insert mode the binding lives inline in the prop value as a token,
  // so we never enter this branch — the children render normally and
  // tokens appear in the text input as ordinary characters.
  if (binding) {
    const activeBinding = binding
    const bindingLabel = resolveBindingLabel(activeBinding, availableFields, sourceLabel, resolvedMeta, publicFiles)
    const boundTable = activeBinding.source === 'currentEntry'
      ? resolvedMeta?.tables.find((table) => table.id === loopTableId)
        ?? resolvedMeta?.tables.find((table) => table.slug === activePageTableSlug)
      : null
    const selectedFieldIsNumeric = activeBinding.field.includes('.')
      ? false
      : boundTable?.fields.some((field) => field.id === activeBinding.field && field.type === 'number') ?? false
    const canFormatNumber =
      (control.type === 'text' || control.type === 'textarea' || control.type === 'richtext') &&
      (selectedFieldIsNumeric || activeBinding.format === 'number')

    function updateNumberFormat(
      patch: Partial<NonNullable<DynamicPropBinding['numberFormat']>>,
    ) {
      const options = { ...activeBinding.numberFormat, ...patch }
      const numberFormat = Object.fromEntries(
        Object.entries(options).filter(([, value]) => value !== undefined),
      ) as NonNullable<DynamicPropBinding['numberFormat']>
      onSet({
        ...activeBinding,
        format: 'number',
        numberFormat: Object.keys(numberFormat).length > 0 ? numberFormat : undefined,
      })
    }

    return (
      <div
        className={cn(
          styles.boundWrapper,
          layout === 'stacked' && styles.boundWrapperStacked,
        )}
        data-bound="true"
      >
        <div className={controlStyles.labelRow}>
          <label>{label}</label>
        </div>
        <div className={styles.boundValueRow}>
          <Button
            variant="ghost"
            size="md"
            className={styles.boundValueDisplay}
            aria-label={bindingLabel}
            type="button"
          >
            {bindingLabel}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label={`Remove binding for ${label}`}
            tooltip={`Remove binding for ${label}`}
            onClick={onClear}
            type="button"
          >
            <CloseIcon size={11} aria-hidden="true" />
          </Button>
        </div>
        {canFormatNumber && (
          <div className={styles.formatSettings}>
            <label htmlFor={`binding-format-${propKey}`}>Value format</label>
            <Select
              id={`binding-format-${propKey}`}
              fieldSize="sm"
              value={activeBinding.format === 'number' ? 'number' : 'plain'}
              options={[
                { value: 'plain', label: 'Raw value' },
                { value: 'number', label: 'Number' },
              ]}
              onChange={(event) => {
                if (event.currentTarget.value === 'number') {
                  onSet({ ...activeBinding, format: 'number' })
                } else {
                  const { numberFormat: _numberFormat, ...plainBinding } = activeBinding
                  onSet({ ...plainBinding, format: 'plain' })
                }
              }}
            />
            {activeBinding.format === 'number' && (
              <div className={styles.numberSettingsWrapper}>
                <Suspense fallback={<div className={styles.formatLoading} role="status">Loading number settings…</div>}>
                  <NumberBindingOptions
                    key={`${binding.source}:${binding.field}:${binding.numberFormat?.locale ?? ''}`}
                    propKey={propKey}
                    binding={activeBinding}
                    pageLanguage={siteFrame?.language}
                    onUpdateNumberFormat={updateNumberFormat}
                  />
                </Suspense>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Unbound state — render children with BracesIcon affordance ──────────
  return (
    <>
      <div
        ref={wrapperRef}
        className={cn(styles.affordanceWrapper, pickerOpen && styles.affordanceWrapperActive)}
        data-prop-key={propKey}
      >
        {children}
        <Button
          ref={triggerRef}
          variant="ghost"
          size="xs"
          iconOnly
          className={styles.affordanceBtn}
          aria-label={pickerAction === 'token' ? `Insert binding for ${label}` : `Bind ${label}`}
          aria-expanded={pickerOpen}
          tooltip={pickerAction === 'token' ? 'Insert data token' : 'Bind to data field'}
          onClick={() => setPickerOpen((o) => !o)}
          type="button"
        >
          <BracesIcon size={11} aria-hidden="true" />
        </Button>
      </div>

      {pickerOpen && (
        <DataBindingPicker
          label={label}
          control={control}
          availableFields={availableFields}
          sourceLabel={sourceLabel}
          scopedTableId={loopTableId}
          scopedTableSlug={activePageTableSlug}
          scopeLabel={loopTableId ? 'Loop row' : 'Current row'}
          systemPreviewValues={{
            page: pageFrame,
            site: siteFrame,
            route: routeFrame,
          }}
          publicFiles={publicFiles}
          insertMode={pickerAction === 'token'}
          allowStructuredBinding={insertMode && (control.type === 'text' || control.type === 'textarea')}
          onModeChange={setPickerAction}
          anchorRef={wrapperRef}
          triggerRef={triggerRef}
          onClose={() => setPickerOpen(false)}
          onPick={(b) => {
            if (pickerAction === 'token' && onInsertToken) {
              // Insert a token at the input's caret. Leave the popover
              // open so the user can keep clicking to insert more tokens
              // without re-opening the picker each time.
              onInsertToken(bindingToToken(b.source, b.field))
            } else {
              // Bind mode — single shot. Commit the binding and dismiss.
              onSet(b)
              setPickerOpen(false)
            }
          }}
        />
      )}
    </>
  )
}
