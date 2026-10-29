/** Lean binding catalogue shapes; detailed row/field settings stay private. */
import { Type, type Static } from '@core/utils/typeboxHelpers'
import { DataTableKindSchema } from './tableKindSchema'

// ---------------------------------------------------------------------------
// DataMeta — lean binding catalog returned by GET /admin/api/cms/data/_meta.
//
// A stripped-down view of the data tables + fields, designed for use by
// the instatic binding picker. Contains only what the picker needs to
// build its UI: identifiers, labels, types, and a small set of per-type
// extras (mediaKind, allowMultiple, targetTableSlug). Deep field settings
// (options, validation rules, currency, format, …) are intentionally
// omitted — keep the payload lean.
// ---------------------------------------------------------------------------

const DataMetaRepeaterItemFieldSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  type: Type.Union([
    Type.Literal('text'), Type.Literal('localizedText'), Type.Literal('longText'), Type.Literal('richText'),
    Type.Literal('number'), Type.Literal('boolean'),
    Type.Literal('date'), Type.Literal('dateTime'),
    Type.Literal('select'), Type.Literal('multiSelect'),
    Type.Literal('url'), Type.Literal('email'),
    Type.Literal('media'), Type.Literal('relation'),
  ]),
  mediaKind: Type.Optional(Type.Union([
    Type.Literal('image'), Type.Literal('video'), Type.Literal('any'),
  ])),
  allowMultiple: Type.Optional(Type.Boolean()),
  targetTableSlug: Type.Optional(Type.String()),
})

const DataMetaFieldSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  // NOTE: pageTree and fieldSchema are intentionally excluded — they are
  // document-level types not surfaced in the instatic binding catalog.
  type: Type.Union([
    Type.Literal('text'), Type.Literal('localizedText'), Type.Literal('longText'), Type.Literal('richText'),
    Type.Literal('number'), Type.Literal('boolean'),
    Type.Literal('date'), Type.Literal('dateTime'),
    Type.Literal('select'), Type.Literal('multiSelect'),
    Type.Literal('url'), Type.Literal('email'),
    Type.Literal('media'), Type.Literal('relation'),
    Type.Literal('repeater'),
  ]),
  mediaKind: Type.Optional(Type.Union([
    Type.Literal('image'), Type.Literal('video'), Type.Literal('any'),
  ])),
  allowMultiple: Type.Optional(Type.Boolean()),
  /** Resolved slug of the target table. Relation fields only. */
  targetTableSlug: Type.Optional(Type.String()),
  /** Lean item schema for repeater fields. */
  fields: Type.Optional(Type.Array(DataMetaRepeaterItemFieldSchema)),
  itemLabelFieldId: Type.Optional(Type.String()),
})

const DataMetaTableSchema = Type.Object({
  id: Type.String(),
  slug: Type.String(),
  name: Type.String(),
  kind: DataTableKindSchema,
  singularLabel: Type.String(),
  pluralLabel: Type.String(),
  primaryFieldId: Type.String(),
  routable: Type.Boolean(),
  versioned: Type.Boolean(),
  fields: Type.Array(DataMetaFieldSchema),
})

export const DataMetaSchema = Type.Object({
  tables: Type.Array(DataMetaTableSchema),
})

export type DataMetaField = Static<typeof DataMetaFieldSchema>
export type DataMetaRepeaterItemField = Static<typeof DataMetaRepeaterItemFieldSchema>
export type DataMetaTable = Static<typeof DataMetaTableSchema>
export type DataMeta = Static<typeof DataMetaSchema>
