import { registry, type ModuleDefinition } from '@core/module-engine'
import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import { SquareSolidIcon } from 'pixel-art-icons/icons/square-solid'
import { ConditionEditor } from './ConditionEditor'

const PropsSchema = Type.Object({ show: Type.Boolean({ default: true }), invert: Type.Boolean({ default: false }) })
export const ConditionModule: ModuleDefinition<Static<typeof PropsSchema>> = {
  id: 'base.condition', name: 'Condition', description: 'Render its content when an authored or bound boolean is true.',
  category: 'Layout', version: '1.0.0', icon: SquareSolidIcon, trusted: true, canHaveChildren: true,
  schema: { show: { type: 'toggle', label: 'Show content' }, invert: { type: 'toggle', label: 'Invert condition' } }, propsSchema: PropsSchema, defaults: Value.Create(PropsSchema),
  component: ConditionEditor, shouldRenderChildren: (props) => props.show !== props.invert, render: (props, children) => ({ html: props.show !== props.invert ? children.join('') : '' }),
}
registry.registerOrReplace(ConditionModule)
