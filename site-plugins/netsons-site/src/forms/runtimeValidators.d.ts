import type { Static } from '@sinclair/typebox'
import type { PropertyConditionSchema } from '../shared/forms/conditions'
import type { CheckboxGroupSchema, FormCalculationsSchema, FormValueExpressionSchema, FormValuesRequestSchema } from '../shared/forms/calculations'
import type {
  FormChallengeResponseSchema,
  FormControlBehaviorSchema,
  FormJsonResponseSchema,
  FormResponseContractSchema,
  FormSuccessResponseSchema,
  FormTransportSchema,
  FormValidationResponseSchema,
  TurnstileApiSchema,
  TurnstileConfigurationSchema,
} from '../shared/forms/schema'

export function checkCondition(value: unknown): value is Static<typeof PropertyConditionSchema>
export function checkTransport(value: unknown): value is Static<typeof FormTransportSchema>
export function checkControl(value: unknown): value is Static<typeof FormControlBehaviorSchema>
export function checkChallenge(value: unknown): value is Static<typeof FormChallengeResponseSchema>
export function checkJsonResponse(value: unknown): value is Static<typeof FormJsonResponseSchema>
export function checkTurnstileConfiguration(value: unknown): value is Static<typeof TurnstileConfigurationSchema>
export function checkTurnstileApi(value: unknown): value is Static<typeof TurnstileApiSchema>
export function checkValidationResponse(value: unknown): value is Static<typeof FormValidationResponseSchema>
export function checkSuccessResponse(value: unknown): value is Static<typeof FormSuccessResponseSchema>
export function checkResponseContract(value: unknown): value is Static<typeof FormResponseContractSchema>
export function checkCalculations(value: unknown): value is Static<typeof FormCalculationsSchema>
export function checkCheckboxGroup(value: unknown): value is Static<typeof CheckboxGroupSchema>
export function checkExpression(value: unknown): value is Static<typeof FormValueExpressionSchema>
export function checkValuesRequest(value: unknown): value is Static<typeof FormValuesRequestSchema>
