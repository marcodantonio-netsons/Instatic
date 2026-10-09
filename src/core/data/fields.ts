/**
 * Field-shape helpers for the data module.
 *
 *   parseDataTableFields       — validates the complete persisted schema;
 *                                malformed fields never disappear from reads.
 *   buildPostTypeDefaultFields — the canonical built-in field set for a new
 *                                `kind: 'postType'` table. Title + slug are
 *                                mandatory; body / featured media / SEO are
 *                                optional built-ins that ship enabled.
 *   findField                  — lookup helper.
 *   isPostTypeBuiltInFieldId   — predicate for the reserved field-id check.
 */

import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import {
  DataFieldSchema,
  POST_TYPE_FIELD_BODY,
  POST_TYPE_FIELD_FEATURED_MEDIA,
  POST_TYPE_FIELD_SEO_DESCRIPTION,
  POST_TYPE_FIELD_SEO_TITLE,
  POST_TYPE_FIELD_SLUG,
  POST_TYPE_FIELD_TITLE,
  POST_TYPE_MANDATORY_FIELD_IDS,
  POST_TYPE_OPTIONAL_BUILTIN_FIELD_IDS,
  type DataField,
  type DataMeta,
  type DataMetaField,
  type DataMetaRepeaterItemField,
  type DataTable,
  type RepeaterItemField,
} from './schemas'

export class DataFieldValidationError extends Error {
  readonly path: string
  constructor(path: string, message: string, options?: ErrorOptions) {
    super(`${path}: ${message}`, options)
    this.name = 'DataFieldValidationError'
    this.path = path
  }
}

const TableFieldsSchema = Type.Array(DataFieldSchema)

export function parseDataTableFields(value: unknown, path = 'fields'): DataField[] {
  const parsed = safeParseValue(TableFieldsSchema, value)
  if (!parsed.ok) {
    const error = parsed.errors[0]
    throw new DataFieldValidationError(path + (error?.path ?? ''), error?.message ?? 'Invalid data-field schema')
  }
  const assertIdentities = (fields: readonly { id: string }[], fieldPath: string) => {
    const ids = new Set<string>()
    for (const [index, field] of fields.entries()) {
      if (!field.id.trim() || ids.has(field.id)) {
        throw new DataFieldValidationError(`${fieldPath}.${index}.id`, 'Fields require distinct nonempty identities')
      }
      ids.add(field.id)
    }
  }
  assertIdentities(parsed.value, path)
  for (const field of parsed.value) {
    if (field.type === 'repeater') assertIdentities(field.fields, `${path}.${field.id}.fields`)
  }
  return parsed.value
}

function findField(table: Pick<DataTable, 'fields'>, fieldId: string): DataField | null {
  return table.fields.find((field) => field.id === fieldId) ?? null
}

export function dataTableHasField(table: Pick<DataTable, 'fields'>, fieldId: string): boolean {
  return findField(table, fieldId) !== null
}

/**
 * Primary fields name records in grids and pickers, so collection/document
 * values and multi-value fields are not meaningful candidates.
 */
export function isPrimaryFieldCandidate(field: DataField): boolean {
  if (field.type === 'repeater' || field.type === 'pageTree' || field.type === 'fieldSchema') {
    return false
  }
  if (field.type === 'multiSelect') return false
  if (field.type === 'media' || field.type === 'relation') {
    return field.allowMultiple !== true
  }
  return true
}

const POST_TYPE_BUILTIN_FIELD_IDS = new Set<string>([
  ...POST_TYPE_MANDATORY_FIELD_IDS,
  ...POST_TYPE_OPTIONAL_BUILTIN_FIELD_IDS,
])

export function isPostTypeBuiltInFieldId(fieldId: string): boolean {
  return POST_TYPE_BUILTIN_FIELD_IDS.has(fieldId)
}

// ---------------------------------------------------------------------------
// buildDataMeta — builds the lean binding catalog from a list of DataTables.
//
// Strips deep field settings (options, validation, format, currency, …) and
// keeps only what the instatic binding picker needs: identifiers, labels,
// types, and per-type extras (mediaKind, allowMultiple, targetTableSlug).
//
// Relation fields whose targetTableId does not resolve to a known table are
// omitted from the output — a dangling reference is not useful in a picker.
// ---------------------------------------------------------------------------

function buildMetaRepeaterItemField(
  field: RepeaterItemField,
  tableSlugById: Map<string, string>,
): DataMetaRepeaterItemField | null {
  if (field.type === 'media') {
    const entry: DataMetaRepeaterItemField = {
      id: field.id,
      label: field.label,
      type: field.type,
    }
    if (field.mediaKind !== undefined) entry.mediaKind = field.mediaKind
    if (field.allowMultiple !== undefined) entry.allowMultiple = field.allowMultiple
    return entry
  }
  if (field.type === 'relation') {
    const targetTableSlug = tableSlugById.get(field.targetTableId)
    if (targetTableSlug === undefined) return null
    const entry: DataMetaRepeaterItemField = {
      id: field.id,
      label: field.label,
      type: field.type,
      targetTableSlug,
    }
    if (field.allowMultiple !== undefined) entry.allowMultiple = field.allowMultiple
    return entry
  }
  return { id: field.id, label: field.label, type: field.type }
}

function buildMetaFields(
  fields: DataField[],
  tableSlugById: Map<string, string>,
): DataMetaField[] {
  const result: DataMetaField[] = []
  for (const field of fields) {
    if (field.type === 'media') {
      const entry: DataMetaField = { id: field.id, label: field.label, type: field.type }
      if (field.mediaKind !== undefined) entry.mediaKind = field.mediaKind
      if (field.allowMultiple !== undefined) entry.allowMultiple = field.allowMultiple
      result.push(entry)
    } else if (field.type === 'relation') {
      const targetTableSlug = tableSlugById.get(field.targetTableId)
      if (targetTableSlug === undefined) continue
      const entry: DataMetaField = {
        id: field.id,
        label: field.label,
        type: field.type,
        targetTableSlug,
      }
      if (field.allowMultiple !== undefined) entry.allowMultiple = field.allowMultiple
      result.push(entry)
    } else if (field.type === 'repeater') {
      const fields = field.fields
        .map((itemField) => buildMetaRepeaterItemField(itemField, tableSlugById))
        .filter((itemField) => itemField !== null)
      result.push({
        id: field.id,
        label: field.label,
        type: field.type,
        fields,
        itemLabelFieldId: fields.some((itemField) => itemField.id === field.itemLabelFieldId)
          ? field.itemLabelFieldId
          : undefined,
      })
    } else if (field.type === 'pageTree' || field.type === 'fieldSchema') {
      // Structural types — not part of the instatic binding catalog.
      // pageTree and fieldSchema cells hold whole documents (tree/field array),
      // not scalar values that can be bound to a property control.
      continue
    } else {
      result.push({ id: field.id, label: field.label, type: field.type })
    }
  }
  return result
}

export function buildDataMeta(tables: DataTable[]): DataMeta {
  const tableSlugById = new Map<string, string>()
  for (const table of tables) {
    tableSlugById.set(table.id, table.slug)
  }

  return {
    tables: tables.map((table) => ({
      id: table.id,
      slug: table.slug,
      name: table.name,
      kind: table.kind,
      singularLabel: table.singularLabel,
      pluralLabel: table.pluralLabel,
      primaryFieldId: table.primaryFieldId,
      routable: (table.routeBase ?? '').length > 0,
      versioned: table.kind === 'postType',
      fields: buildMetaFields(table.fields, tableSlugById),
    })),
  }
}

/**
 * Canonical built-in field set for a new post-type table. Order matters —
 * the Content authoring UI relies on iteration order to render sections.
 */
export function buildPostTypeDefaultFields(): DataField[] {
  return [
    {
      type: 'text',
      id: POST_TYPE_FIELD_TITLE,
      label: 'Title',
      required: true,
      builtIn: true,
    },
    {
      type: 'text',
      id: POST_TYPE_FIELD_SLUG,
      label: 'Slug',
      required: true,
      builtIn: true,
    },
    {
      type: 'richText',
      id: POST_TYPE_FIELD_BODY,
      label: 'Body',
      format: 'markdown',
      builtIn: true,
    },
    {
      type: 'media',
      id: POST_TYPE_FIELD_FEATURED_MEDIA,
      label: 'Featured media',
      mediaKind: 'image',
      builtIn: true,
    },
    {
      type: 'text',
      id: POST_TYPE_FIELD_SEO_TITLE,
      label: 'SEO title',
      builtIn: true,
    },
    {
      type: 'longText',
      id: POST_TYPE_FIELD_SEO_DESCRIPTION,
      label: 'SEO description',
      builtIn: true,
    },
  ]
}
