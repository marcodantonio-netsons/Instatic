import { Value } from '@sinclair/typebox/value'
import type { Static, TObject } from '@sinclair/typebox'
import type { PluginModuleDefinition } from '@instatic/plugin-sdk'
import { normalizeRenderProps } from './normalize'

type Definition<T extends TObject> = Omit<PluginModuleDefinition, 'propsSchema' | 'defaults' | 'render' | 'category'> & {
  propsSchema: T
  render(props: Static<T>, children: string[]): ReturnType<PluginModuleDefinition['render']>
}

/** Validate render inputs locally too: older official hosts omit schema metadata. */
export function defineSiteModule<T extends TObject>(definition: Definition<T>): PluginModuleDefinition {
  const urls = Object.entries(definition.schema).filter(([, control]) => control.type === 'url' || control.type === 'image').map(([key]) => key)
  return {
    ...definition,
    category: 'Netsons',
    defaults: Object.assign({}, Value.Create(definition.propsSchema), { routePath: '{route.path}' }),
    render: (props, children) => definition.render(normalizeRenderProps(definition.propsSchema, props, urls), children),
  }
}
