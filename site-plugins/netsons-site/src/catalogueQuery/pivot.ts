import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { translate } from '../localization'
import { CATALOGUE_QUERY_CONFIGS } from './config'

const FieldName = Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z][A-Za-z0-9_-]*$' })
const StringList = Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 1000 })
const Fields = Type.Record(Type.String({ maxLength: 128 }), Type.Unknown())
const Entry = Type.Object({ id: Type.String({ minLength: 1, maxLength: 256 }), fields: Fields }, { additionalProperties: false })
const Entries = Type.Array(Entry, { maxItems: 10000 })
const Filters = Type.Object({
  configId: Type.Literal('catalogue-comparison'),
  tableId: Type.Optional(Type.Literal('netsons-final-data-catalog')),
  matrixField: FieldName, keyField: FieldName, labelField: FieldName, groupField: FieldName,
  groupLabelField: FieldName, rawField: FieldName, valueField: FieldName,
  allowedValueFields: Type.String({ minLength: 1, maxLength: 1024 }),
  columnFields: Type.Optional(Type.String({ maxLength: 1024 })),
  columnValueField: Type.Optional(Type.String({ maxLength: 128 })),
  allowedColumnValueFields: Type.Optional(Type.String({ maxLength: 1024 })),
  columnLabelField: Type.Optional(Type.String({ maxLength: 128 })),
  allowedColumnLabelFields: Type.Optional(Type.String({ maxLength: 1024 })),
  maxColumns: Type.Optional(Type.Integer({ minimum: 1, maximum: 32 })),
  projection: Type.Optional(Type.Union([Type.Literal('rows'), Type.Literal('matrix')])),
  differencesOnly: Type.Optional(Type.Union([Type.Boolean(), Type.String({ maxLength: 16 })])),
  rowIds: Type.Optional(StringList),
  cellField: Type.Optional(FieldName),
  cellValue: Type.Optional(Type.String({ maxLength: 2048 })),
  cellOperator: Type.Optional(Type.Literal('is')),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000 })),
  limit: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000 })),
}, { additionalProperties: false })
const Query = Type.Record(Type.String({ minLength: 1, maxLength: 128 }), Type.String({ maxLength: 2048 }), { maxProperties: 64 })
const Language = Type.Union(['it', 'en', 'de', 'fr', 'es', 'pt', 'nl', 'pl', 'ro'].map(value => Type.Literal(value)))
const CellRecord = Type.Object({ id: Type.String({ minLength: 1, maxLength: 256 }), cells: Fields }, { additionalProperties: false })
const Repeater = Type.Array(CellRecord, { maxItems: 10000 })
const Scalar = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])
const OutputItem = Type.Object({ id: Type.String(), fields: Type.Record(Type.String(), Type.Unknown()) }, { additionalProperties: false })
const Output = Type.Object({ items: Type.Array(OutputItem), totalItems: Type.Integer({ minimum: 0 }) }, { additionalProperties: false })

type FiltersValue = Static<typeof Filters>
type EntryValue = Static<typeof Entry>
type ProjectedRow = {
  id: string
  fields: {
    key: string
    label: string
    group: string
    groupLabel: string
    cells: Array<Record<string, unknown>>
    columnCount: number
    colspan: number
    isDifferent: boolean
    startsGroup: boolean
  }
}

const translationToken = /^\{i18n\.([A-Za-z][A-Za-z0-9_.-]*)\}$/

function assert<T>(schema: TSchema, value: unknown, message: string): asserts value is T {
  if (!Value.Check(schema, value)) throw new Error(message)
}

function fieldNames(value: string | undefined, label: string): string[] {
  if (!value) return []
  const names = value.split(',').map(name => name.trim()).filter(Boolean)
  if (new Set(names).size !== names.length || names.some(name => !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name))) {
    throw new Error('Invalid catalogue matrix ' + label)
  }
  return names
}

function localize(value: unknown, language: string, path: string): unknown {
  if (typeof value !== 'string') return value
  const token = translationToken.exec(value)
  if (token) {
    try { return translate(language, token[1]) } catch (cause) {
      throw new Error('Cannot resolve catalogue text at ' + path, { cause })
    }
  }
  return value
}

function text(value: unknown, language: string, path: string): string {
  const localized = localize(value, language, path)
  if (typeof localized !== 'string') throw new Error('Catalogue matrix labels require text at ' + path)
  return localized
}

function scalar(value: unknown, language: string, path: string): string | number | boolean | null {
  const localized = localize(value, language, path)
  if (!Value.Check(Scalar, localized)) throw new Error('Catalogue matrix values require scalar cells at ' + path)
  return localized
}

function parseDifferencesOnly(value: boolean | string | undefined): boolean {
  return value === true || value === 'true' || value === 'on' || value === '1'
}

function resolveFilters(filters: FiltersValue, query: Static<typeof Query>): FiltersValue {
  const result: FiltersValue = { ...filters }
  for (const binding of CATALOGUE_QUERY_CONFIGS['catalogue-comparison'].visitorBindings) {
    const raw = query[binding.queryParameter]
    if (raw === undefined) continue
    let value: unknown = raw
    if (binding.valueType === 'stringArray') {
      try { value = JSON.parse(raw) } catch (cause) { throw new Error('Invalid catalogue plan selection', { cause }) }
      if (!Value.Check(StringList, value)) throw new Error('Catalogue plans must be a JSON array of entry IDs')
    }
    Object.assign(result, { [binding.filterKey]: value })
  }
  if (!Value.Check(Filters, result)) throw new Error('Invalid resolved catalogue matrix filters')
  return result
}

/** Projects allowlisted CMS catalogue entries into the native data.pivot LoopItem shape. */
export function projectCatalogueMatrix(
  entries: unknown,
  filters: unknown,
  query: unknown,
  language: unknown,
): { items: Array<{ id: string; fields: Record<string, unknown> }>; totalItems: number } {
  assert<unknown[]>(Entries, entries, 'Invalid catalogue entries')
  assert<FiltersValue>(Filters, filters, 'Invalid catalogue matrix filters')
  assert<Static<typeof Query>>(Query, query, 'Invalid catalogue query parameters')
  assert<string>(Language, language, 'Unsupported catalogue language')
  const settings = filters as FiltersValue
  const visitorQuery = query as Static<typeof Query>
  const locale = language as string
  if (settings.configId !== 'catalogue-comparison') throw new Error('Unsupported catalogue matrix configuration')
  if (settings.tableId !== undefined && settings.tableId !== 'netsons-final-data-catalog') throw new Error('Unsupported catalogue matrix table')

  const configuration = resolveFilters(settings, visitorQuery)
  const allowedValues = fieldNames(configuration.allowedValueFields, 'allowed value fields')
  if (!allowedValues.includes(configuration.valueField)) throw new Error('Catalogue value field is not authorized')
  const columnFields = fieldNames(configuration.columnFields, 'column metadata fields')
  const reserved = new Set(['id', 'index', 'value', 'displayValue', 'rawValue', 'isEmpty', 'isHeading', 'isColumn', 'hasValue'])
  if (columnFields.some(name => reserved.has(name))) throw new Error('Catalogue column metadata uses a reserved field')
  const allowedColumnValues = fieldNames(configuration.allowedColumnValueFields, 'allowed column value fields')
  const allowedColumnLabels = fieldNames(configuration.allowedColumnLabelFields, 'allowed column label fields')
  if (configuration.columnValueField && !allowedColumnValues.includes(configuration.columnValueField)) throw new Error('Catalogue column value field is not authorized')
  if (configuration.columnLabelField && !allowedColumnLabels.includes(configuration.columnLabelField)) throw new Error('Catalogue column label field is not authorized')

  const allEntries = entries as EntryValue[]
  const selectedIds = configuration.rowIds === undefined ? null : new Set(configuration.rowIds)
  let selected = allEntries.filter(entry => selectedIds === null || selectedIds.has(entry.id))
  if (configuration.cellField && configuration.cellValue !== undefined) {
    if (configuration.cellOperator && configuration.cellOperator !== 'is') throw new Error('Unsupported catalogue family filter')
    selected = selected.filter(entry => entry.fields[configuration.cellField!] === configuration.cellValue)
  }
  const maxColumns = configuration.maxColumns ?? 4
  if (selected.length > maxColumns) throw new Error('Catalogue comparison exceeds its column limit')
  if (!selected.length) return { items: [], totalItems: 0 }

  const columns = selected.map(entry => {
    const matrix = entry.fields[configuration.matrixField]
    if (matrix === undefined || matrix === null) throw new Error('Catalogue matrix field is missing on ' + entry.id)
    if (!Value.Check(Repeater, matrix)) throw new Error('Invalid catalogue repeater on ' + entry.id)
    return { entry, rows: matrix as Array<{ id: string; cells: Record<string, unknown> }> }
  })
  const first = columns[0].rows
  const keys = new Set<string>()
  const rows: ProjectedRow[] = first.map((record, index) => {
    const key = text(record.cells[configuration.keyField], locale, 'matrix.' + index + '.key')
    if (!key || keys.has(key)) throw new Error('Catalogue matrix rows require distinct nonempty keys')
    keys.add(key)
    const group = text(record.cells[configuration.groupField], locale, 'matrix.' + key + '.group')
    const cells = columns.map(({ entry, rows: currentRows }) => {
      const current = currentRows[index]
      if (!current || current.cells[configuration.keyField] !== record.cells[configuration.keyField] || current.cells[configuration.groupField] !== record.cells[configuration.groupField] || currentRows.length !== first.length) {
        throw new Error('Catalogue matrices require the same ordered keys and groups on ' + entry.id)
      }
      const rawValue = scalar(current.cells[configuration.rawField], locale, 'matrix.' + key + '.raw')
      const displayValue = scalar(current.cells[configuration.valueField], locale, 'matrix.' + key + '.value')
      const metadata = Object.fromEntries(columnFields.map(name => [name, localize(entry.fields[name], locale, 'entries.' + entry.id + '.' + name)]))
      return { id: entry.id, displayValue, rawValue, isEmpty: displayValue === null, hasValue: displayValue !== null, ...metadata }
    })
    return {
      id: key,
      fields: {
        key,
        label: text(record.cells[configuration.labelField], locale, 'matrix.' + key + '.label'),
        group,
        groupLabel: text(record.cells[configuration.groupLabelField], locale, 'matrix.' + key + '.groupLabel'),
        cells,
        columnCount: columns.length,
        colspan: columns.length + 1,
        isDifferent: new Set(cells.map(cell => JSON.stringify(cell.rawValue))).size > 1,
        startsGroup: false,
      },
    }
  })

  const visible = parseDifferencesOnly(configuration.differencesOnly) && columns.length > 1
    ? rows.filter(row => row.fields.isDifferent)
    : rows
  let previous: string | undefined
  for (const row of visible) {
    row.fields.startsGroup = previous !== row.fields.group
    previous = row.fields.group
  }
  if ((configuration.projection ?? 'rows') === 'matrix') {
    const headers = [
      { id: 'row-heading', isHeading: true, isColumn: false },
      ...columns.map(({ entry }) => {
        const displayValue = configuration.columnValueField
          ? scalar(entry.fields[configuration.columnValueField], locale, 'entries.' + entry.id + '.' + configuration.columnValueField)
          : null
        return {
          id: entry.id,
          isHeading: false,
          isColumn: true,
          displayValue,
          isEmpty: configuration.columnValueField ? displayValue === null : false,
          hasValue: configuration.columnValueField ? displayValue !== null : false,
          ...Object.fromEntries(columnFields.map(name => [name, localize(entry.fields[name], locale, 'entries.' + entry.id + '.' + name)])),
        }
      }),
    ]
    const matrixRows = visible.map(row => ({
      id: row.id,
      ...row.fields,
      cells: [
        { id: 'row-heading', isHeading: true, isColumn: false, displayValue: row.fields.label },
        ...row.fields.cells.map(cell => ({ ...cell, isHeading: false, isColumn: true })),
      ],
    }))
    const matrix = {
      id: 'comparison',
      fields: {
        columns: headers,
        rows: matrixRows,
        columnLabel: configuration.columnLabelField
          ? text(columns[0].entry.fields[configuration.columnLabelField], locale, 'matrix.columnLabel')
          : '',
        hasEmptyColumns: headers.some(header => 'isEmpty' in header && header.isEmpty),
        columnCount: columns.length,
        colspan: columns.length + 1,
      },
    }
    const output = { items: (configuration.offset ?? 0) > 0 ? [] : [matrix], totalItems: 1 }
    if (!Value.Check(Output, output)) throw new Error('Invalid projected catalogue matrix')
    return output
  }
  const offset = configuration.offset ?? 0
  const limit = configuration.limit ?? 1000
  const output = { items: visible.slice(offset, offset + limit), totalItems: visible.length }
  if (!Value.Check(Output, output)) throw new Error('Invalid projected catalogue rows')
  return output
}
