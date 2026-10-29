/** Native table families, shared by storage and the lean binding catalogue. */
import { Type, type Static } from '@core/utils/typeboxHelpers'

export const DataTableKindSchema = Type.Union([
  Type.Literal('postType'),
  Type.Literal('data'),
  Type.Literal('page'),
  Type.Literal('component'),
  Type.Literal('layout'),
])

export type DataTableKind = Static<typeof DataTableKindSchema>
