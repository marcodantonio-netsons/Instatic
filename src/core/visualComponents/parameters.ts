import { Type, type Static } from '@sinclair/typebox'
import type { DynamicPropBinding } from '@core/page-tree-schema'
import { isSafeUrl } from '@core/html-sanitize'
import { parseTokenString, readFrame, resolveDynamicProps, type TemplateRenderDataContext } from '@core/templates'
import type { InstantiatedVC } from './instantiate'
import type { VisualComponent, VCParam } from './schemas'

export const VisualComponentParameterIssueSchema = Type.Object({
  componentId: Type.String(),
  refId: Type.String(),
  parameterId: Type.String(),
  parameterName: Type.String(),
  path: Type.String(),
  reason: Type.Union([Type.Literal('missing'), Type.Literal('invalid'), Type.Literal('unresolved')]),
  message: Type.String(),
})
export type VisualComponentParameterIssue = Static<typeof VisualComponentParameterIssueSchema>

export class VisualComponentParameterError extends Error {
  readonly path: string
  readonly issue: VisualComponentParameterIssue

  constructor(issue: VisualComponentParameterIssue) {
    super(`${issue.message} (${issue.path})`)
    this.name = 'VisualComponentParameterError'
    this.path = issue.path
    this.issue = issue
  }
}

function valueIssue(param: VCParam, value: unknown): 'missing' | 'invalid' | null {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) return 'missing'
  switch (param.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'invalid'
    case 'boolean':
      return typeof value === 'boolean' ? null : 'invalid'
    case 'enum':
      return typeof value === 'string' && param.enumOptions?.includes(value) ? null : 'invalid'
    case 'url':
    case 'image':
      return typeof value === 'string' && isSafeUrl(value) ? null : 'invalid'
    default:
      return typeof value === 'string' ? null : 'invalid'
  }
}

/**
 * Inspect one materialized instance using the renderer's real data context.
 * Structural walkers may instantiate drafts without asserting this contract.
 * Values are resolved for inspection only: the raw values in the tree still
 * flow through the normal node binding resolver exactly once.
 *
 * A missing frame is distinct from an available frame with an empty field.
 * Preview reports the former as unresolved; publication rejects every issue.
 */
export function inspectVCRequiredParameters(
  vc: VisualComponent,
  instance: InstantiatedVC,
  refId: string,
  context: TemplateRenderDataContext | undefined,
  overridesBinding?: DynamicPropBinding,
): VisualComponentParameterIssue[] {
  const issues: VisualComponentParameterIssue[] = []
  for (const param of vc.params) {
    if (!param.required) continue
    let reason: VisualComponentParameterIssue['reason'] | null
    if (param.type === 'slot') {
      reason = instance.slotContentByName[param.name]?.length ? null : 'missing'
    } else {
      const value = instance.parameterValues.get(param.id)
      const tokens = typeof value === 'string' ? parseTokenString(value) : []
      const missingFrame = (overridesBinding && (!context || !readFrame(overridesBinding.source, context)))
        || tokens.some((token) => token.kind === 'token' && (!context || !readFrame(token.source, context)))
      if (missingFrame) {
        reason = 'unresolved'
      } else {
        const resolved = resolveDynamicProps({ value }, undefined, context).value
        reason = valueIssue(param, resolved)
      }
    }
    if (!reason) continue
    const path = param.type === 'slot'
      ? `nodes.${refId}.children.${param.name}`
      : `nodes.${refId}.props.propOverrides.${param.id}`
    const description = reason === 'missing'
      ? 'is required and has no value'
      : reason === 'invalid'
        ? `has an invalid ${param.type} value`
        : 'requires a real render context'
    issues.push({
      componentId: vc.id,
      refId,
      parameterId: param.id,
      parameterName: param.name,
      path,
      reason,
      message: `Component "${vc.name}" parameter "${param.name}" ${description}`,
    })
  }
  return issues
}

/** Public rendering has no pending state: an unresolved required value is an error. */
export function assertVCRequiredParameters(
  vc: VisualComponent,
  instance: InstantiatedVC,
  refId: string,
  context: TemplateRenderDataContext | undefined,
  overridesBinding?: DynamicPropBinding,
): void {
  const issue = inspectVCRequiredParameters(vc, instance, refId, context, overridesBinding)[0]
  if (issue) throw new VisualComponentParameterError(issue)
}
