/** A comparison matrix is a projection of selected published data rows, not a
 * second storage or browser engine. Only the selected columns are materialized. */
import { Type, parseValue, safeParseValue, type Static } from '@core/utils/typeboxHelpers'
import { readDataRepeaterValue } from '@core/data/localizedCells'
import type { LoopItem, LoopEntitySource, LoopFetchResult } from '../types'
import { DataRowsSource } from './dataRows'
import { LoopQueryConfigurationError } from '../queryBindings'

const field = Type.String({ minLength: 1, maxLength: 128, pattern: '^[A-Za-z][A-Za-z0-9_-]*$' })
const ConfigurationSchema = Type.Object({
  matrixField: field, keyField: field, labelField: field, groupField: field, groupLabelField: field,
  rawField: field, valueField: field, allowedValueFields: Type.String({ minLength: 1 }),
  columnFields: Type.String({ default: '' }), columnValueField: Type.String({ default: '' }), allowedColumnValueFields: Type.String({ default: '' }), columnLabelField: Type.String({ default: '' }), allowedColumnLabelFields: Type.String({ default: '' }), maxColumns: Type.Integer({ minimum: 1, maximum: 32, default: 4 }),
  projection: Type.Union([Type.Literal('rows'), Type.Literal('matrix')], { default: 'rows' }),
  differencesOnly: Type.Union([Type.Boolean(), Type.String()], { default: false }),
})
export type DataPivotConfiguration = Static<typeof ConfigurationSchema>
export class DataPivotConfigurationError extends LoopQueryConfigurationError {
  constructor(message: string, path = 'filters', options?: ErrorOptions) { super(message, path); this.name = 'DataPivotConfigurationError'; this.cause = options?.cause }
}
function fail(message: string, path: string): never { throw new DataPivotConfigurationError(message, path) }
function fieldNames(value: string, path: string): string[] {
  const names = value.split(',').map(name => name.trim()).filter(Boolean)
  if (new Set(names).size !== names.length || names.some(name => !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name))) fail('Expected distinct field names separated by commas', path)
  return names
}
export function readDataPivotConfiguration(filters: Record<string, unknown>): DataPivotConfiguration {
  let configuration: DataPivotConfiguration
  try { configuration = parseValue(ConfigurationSchema, filters) } catch (cause) { throw new DataPivotConfigurationError('Invalid comparison matrix configuration', 'filters', { cause }) }
  const allowed = fieldNames(configuration.allowedValueFields, 'filters.allowedValueFields')
  if (!allowed.includes(configuration.valueField)) fail('The selected matrix value field is not authorized', 'filters.valueField')
  const metadata = fieldNames(configuration.columnFields, 'filters.columnFields')
  if (metadata.some(name => ['id','index','value','displayValue','rawValue','isEmpty','isHeading','isColumn','hasValue'].includes(name))) fail('Column metadata uses a reserved projection field', 'filters.columnFields')
  if (configuration.columnValueField && !fieldNames(configuration.allowedColumnValueFields, 'filters.allowedColumnValueFields').includes(configuration.columnValueField)) fail('The selected column value field is not authorized', 'filters.columnValueField')
  if (configuration.columnLabelField && !fieldNames(configuration.allowedColumnLabelFields, 'filters.allowedColumnLabelFields').includes(configuration.columnLabelField)) fail('The selected column label field is not authorized', 'filters.columnLabelField')
  return configuration
}
const RawSchema = Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()])
function rawValue(value: unknown, path: string) {
  const parsed = safeParseValue(RawSchema, value === undefined ? null : value)
  if (!parsed.ok) fail('Matrix values require scalar cells', path)
  return parsed.value
}
function text(value: unknown, path: string): string {
  if (typeof value !== 'string') fail('Matrix identities and labels require text', path)
  return value
}
/** Shared with tests and native editor previews; never mutates source items. */
export function projectDataPivot(items: readonly LoopItem[], configuration: DataPivotConfiguration, offset = 0, limit = 1000): LoopFetchResult {
  if (items.length > configuration.maxColumns) fail('The selected comparison exceeds its authored column limit', 'filters.rowIds')
  if (!items.length) return { items: [], totalItems: 0 }
  const columns = items.map(item => {
    if (!Object.hasOwn(item.fields, configuration.matrixField)) fail('The configured matrix field is missing', `rows.${item.id}.${configuration.matrixField}`)
    return { item, rows: readDataRepeaterValue(item.fields[configuration.matrixField], `rows.${item.id}.${configuration.matrixField}`) }
  })
  const first = columns[0].rows, columnFields = fieldNames(configuration.columnFields, 'filters.columnFields')
  const keys = new Set<string>()
  const rows = first.map((record, index) => {
    const key = text(record.cells[configuration.keyField], `matrix.${index}.key`)
    if (!key || keys.has(key)) fail('Matrix rows require distinct nonempty keys', `matrix.${index}.key`)
    keys.add(key)
    const group = text(record.cells[configuration.groupField], `matrix.${key}.group`)
    const cells = columns.map(({ item, rows }) => {
      const current = rows[index]
      if (!current || current.cells[configuration.keyField] !== key || current.cells[configuration.groupField] !== group || rows.length !== first.length) fail('Compared matrices require the same ordered keys and groups', `rows.${item.id}.${configuration.matrixField}`)
      const raw = rawValue(current.cells[configuration.rawField], `matrix.${key}.raw`)
      const value = rawValue(current.cells[configuration.valueField], `matrix.${key}.value`)
      return { id: item.id, displayValue: value, rawValue: raw, isEmpty: value === null, hasValue: value !== null, ...Object.fromEntries(columnFields.map(name => [name, item.fields[name]])) }
    })
    const different = new Set(cells.map(cell => JSON.stringify(cell.rawValue))).size > 1
    return { id: key, fields: { key, label: text(record.cells[configuration.labelField], `matrix.${key}.label`), group,
      groupLabel: text(record.cells[configuration.groupLabelField], `matrix.${key}.groupLabel`), cells,
      columnCount: columns.length, colspan: columns.length + 1, isDifferent: different, startsGroup: false } }
  })
  const differences = configuration.differencesOnly === true || configuration.differencesOnly === 'true' || configuration.differencesOnly === 'on' || configuration.differencesOnly === '1'
  const visible = differences && columns.length > 1 ? rows.filter(row => row.fields.isDifferent) : rows
  let previous: string | undefined
  for (const row of visible) { row.fields.startsGroup = previous !== row.fields.group; previous = row.fields.group }
  if (configuration.projection === 'matrix') {
    const headers = [
      { id: 'row-heading', isHeading: true, isColumn: false },
      ...columns.map(({ item }) => {
        const value = configuration.columnValueField
          ? rawValue(item.fields[configuration.columnValueField], `rows.${item.id}.${configuration.columnValueField}`) : null
        return {
          id: item.id, isHeading: false, isColumn: true, displayValue: value,
          isEmpty: configuration.columnValueField ? value === null : false,
          hasValue: configuration.columnValueField ? value !== null : false,
          ...Object.fromEntries(columnFields.map(name => [name, item.fields[name]])),
        }
      }),
    ]
    const matrixRows = visible.map(row => ({
      id: row.id, ...row.fields,
      cells: [
        { id: 'row-heading', isHeading: true, isColumn: false, displayValue: row.fields.label },
        ...row.fields.cells.map(cell => ({ ...cell, isHeading: false, isColumn: true })),
      ],
    }))
    const matrix = { id: 'comparison', fields: {
      columns: headers, rows: matrixRows,
      columnLabel: configuration.columnLabelField ? text(items[0].fields[configuration.columnLabelField], 'matrix.columnLabel') : '',
      hasEmptyColumns: headers.some(header => 'isEmpty' in header && header.isEmpty),
      columnCount: columns.length, colspan: columns.length + 1,
    } }
    return { items: offset > 0 ? [] : [matrix], totalItems: 1 }
  }
  return { items: visible.slice(offset, offset + limit), totalItems: visible.length }
}

export const DataPivotSource: LoopEntitySource = {
  id: 'data.pivot', label: 'Data comparison matrix', description: 'Compare selected data rows by an ordered repeater field.',
  queryFilterKeys: ['cellValue', 'rowIds', 'valueField', 'columnValueField', 'columnLabelField', 'differencesOnly'],
  assertFilters: readDataPivotConfiguration,
  filterSchema: {
    ...DataRowsSource.filterSchema,
    projection: { type: 'select', label: 'Projection', options: [{label:'Rows',value:'rows'},{label:'Complete matrix',value:'matrix'}] },
    matrixField: { type: 'text', label: 'Matrix repeater field' }, keyField: { type: 'text', label: 'Row key field' },
    labelField: { type: 'text', label: 'Row label field' }, groupField: { type: 'text', label: 'Group key field' },
    groupLabelField: { type: 'text', label: 'Group label field' }, rawField: { type: 'text', label: 'Comparison value field' },
    valueField: { type: 'text', label: 'Displayed value field' }, allowedValueFields: { type: 'text', label: 'Allowed display fields (comma separated)' },
    columnLabelField: { type: 'text', label: 'Column heading field' }, allowedColumnLabelFields: { type: 'text', label: 'Allowed column heading fields (comma separated)' },
    columnValueField: { type: 'text', label: 'Displayed column value field' }, allowedColumnValueFields: { type: 'text', label: 'Allowed column value fields (comma separated)' },
    columnFields: { type: 'text', label: 'Column metadata fields (comma separated)' }, maxColumns: { type: 'number', label: 'Maximum columns', min: 1, max: 32 },
    differencesOnly: { type: 'toggle', label: 'Show differences only' },
  },
  orderByOptions: DataRowsSource.orderByOptions,
  fields: [
    { id: 'columnLabel', label: 'Column value heading' },
    { id: 'hasEmptyColumns', label: 'Columns with empty values' }, { id: 'columns', label: 'Matrix columns' }, { id: 'rows', label: 'Matrix rows' },
    { id: 'key', label: 'Row key' }, { id: 'label', label: 'Row label' }, { id: 'group', label: 'Group key' },
    { id: 'groupLabel', label: 'Group label' }, { id: 'cells', label: 'Compared cells' },
    { id: 'startsGroup', label: 'First visible row in group' }, { id: 'columnCount', label: 'Column count' },
    { id: 'colspan', label: 'Row width including heading' }, { id: 'isDifferent', label: 'Different raw values' },
  ],
  async fetch(context) {
    const configuration = readDataPivotConfiguration(context.filters)
    if (DataRowsSource.kind === 'contextual') throw new Error('Data rows must be prefetched')
    const columns = await DataRowsSource.fetch({ ...context, limit: configuration.maxColumns + 1, offset: 0 })
    if (columns.totalItems > configuration.maxColumns) fail('The selected comparison exceeds its authored column limit', 'filters.rowIds')
    return projectDataPivot(columns.items, configuration, context.offset, context.limit)
  },
  preview() { return [] },
}
