/** Wire shapes for native authoring previews; they convey requested content, never authority. */
import { Type, type Static } from '@core/utils/typeboxHelpers'
import { SiteShellSchema, PageSchema } from '@core/page-tree'
import { VisualComponentSchema } from '@core/visual-components-schema'
import { SavedLayoutSchema } from '@core/layouts-schema'
import { DataRowCellsSchema } from '@core/data/schemas'

const Identifier = Type.String({ minLength: 1 })
const EntryLocator = Type.Object({ tableId: Identifier, rowId: Identifier }, { additionalProperties: false })

/** Reuses the native persisted leaves; malformed documents are not repaired into previews. */
export const RenderPreviewSiteSchema = Type.Composite([SiteShellSchema, Type.Object({
  pages: Type.Array(PageSchema), visualComponents: Type.Array(VisualComponentSchema), layouts: Type.Array(SavedLayoutSchema),
})])
export type RenderPreviewSite = Static<typeof RenderPreviewSiteSchema>

export const AuthoringRenderContextSchema = Type.Union([
  Type.Object({ kind: Type.Literal('entry'), rowId: Identifier,
    cells: Type.Optional(DataRowCellsSchema), language: Type.Optional(Identifier),
  }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('page'), pageId: Identifier, site: RenderPreviewSiteSchema,
    entry: Type.Optional(EntryLocator), language: Type.Optional(Identifier),
    breakpointId: Type.Optional(Identifier),
  }, { additionalProperties: false }),
])
export type AuthoringRenderContext = Static<typeof AuthoringRenderContextSchema>

/** Emitted by the renderer configuration, never authored as a module prop. */
export const FragmentTransportSchema = Type.Union([
  Type.Object({ kind: Type.Literal('public') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('authoring'), endpoint: Type.Literal('/admin/api/cms/runtime/fragment'),
    branchId: Identifier, context: AuthoringRenderContextSchema,
  }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('branchPreview'), endpoint: Type.Literal('/_instatic/preview/fragment') }, { additionalProperties: false }),
])
export type FragmentTransport = Static<typeof FragmentTransportSchema>

const FragmentLocation = {
  nodeId: Type.String({ minLength: 1, maxLength: 512 }),
  locator: Type.String({ minLength: 1, maxLength: 16_384 }),
  generation: Identifier, pagePath: Type.String({ minLength: 1 }),
}
const FragmentOperations = [
  Type.Object({ ...FragmentLocation, operation: Type.Literal('hole') }, { additionalProperties: false }),
  Type.Object({ ...FragmentLocation, operation: Type.Literal('loop'),
    pageNumber: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
  }, { additionalProperties: false }),
]
export const RenderFragmentLocationSchema = Type.Union(FragmentOperations)
export type RenderFragmentLocation = Static<typeof RenderFragmentLocationSchema>
export const AuthoringRenderFragmentRequestSchema = Type.Union(FragmentOperations.map(operation => Type.Composite([
  operation, Type.Object({ context: AuthoringRenderContextSchema }),
])))
export type AuthoringRenderFragmentRequest = Static<typeof AuthoringRenderFragmentRequestSchema>

export const RuntimePreviewRequestSchema = Type.Object({
  pageId: Identifier, site: RenderPreviewSiteSchema, breakpointId: Type.Optional(Identifier),
  entry: Type.Optional(EntryLocator), language: Type.Optional(Identifier),
}, { additionalProperties: false })
export type RuntimePreviewRequest = Static<typeof RuntimePreviewRequestSchema>
