import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  VisitorPreferenceNameSchema,
  VisitorPreferenceOverridesSchema,
  VisitorPreferencePatchSchema,
  VisitorPreferencesRuntimeConfigSchema,
} from '../shared/preferences/schema'
import type { VisitorPreferencesValidators } from './runtime'

const config = TypeCompiler.Compile(VisitorPreferencesRuntimeConfigSchema)
const overrides = TypeCompiler.Compile(VisitorPreferenceOverridesSchema)
const name = TypeCompiler.Compile(VisitorPreferenceNameSchema)
const patch = TypeCompiler.Compile(VisitorPreferencePatchSchema)

/** Validators generated from the same TypeBox schemas used at module boundaries. */
export const visitorPreferencesValidators: VisitorPreferencesValidators = {
  config: value => config.Check(value),
  overrides: value => overrides.Check(value),
  name: value => name.Check(value),
  patch: value => patch.Check(value),
}

/** Static validator functions for the browser asset; no schema library ships to visitors. */
export const visitorPreferencesValidatorCode = {
  config: config.Code(),
  overrides: overrides.Code(),
  name: name.Code(),
  patch: patch.Code(),
}
