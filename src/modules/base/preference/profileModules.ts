import { registry, type ModuleDefinition } from '@core/module-engine'
import { Value } from '@core/utils/typeboxHelpers'
import { htmlAttributesAttr } from '@core/publisher'
import { MODULE_GENERATED_ATTRIBUTE_NAMES } from '@core/htmlAttributes'
import { htmlAttributesControl } from '@modules/base/shared/htmlAttributes'
import { SettingsCogSolidIcon } from 'pixel-art-icons/icons/settings-cog-solid'
import { PreferenceTogglePropsSchema, PreferenceTogglePublishSchema, PreferenceOutputPropsSchema, PreferenceOutputPublishSchema, type PreferenceToggleProps, type PreferenceOutputProps } from './profileProps'
import { PreferenceToggleEditor, PreferenceOutputEditor } from './PreferenceProfileEditors'
import { preferenceToggleData, preferenceOutputData, profileDataAttributes } from './profileData'
import { PreferenceFeedbackPropsSchema } from './props'

const feedbackControls = Object.fromEntries(Object.keys(PreferenceFeedbackPropsSchema.properties).map(key => [key, { type: 'text' as const, label: key.replace(/Status$/, ' status') }]))
const activeProfileControl = { type: 'preferenceValues' as const, label: 'Active preferences' }
const inactiveProfileControl = { type: 'preferenceValues' as const, label: 'Inactive preferences' }

export const PreferenceToggleModule: ModuleDefinition<PreferenceToggleProps> = {
  id: 'base.preference-toggle', name: 'Preference toggle', description: 'Atomically switch an authored group of visitor preferences.',
  category: 'Interactive', version: '1.0.0', trusted: true, icon: SettingsCogSolidIcon, canHaveChildren: true, htmlTag: 'button',
  propsSchema: PreferenceTogglePropsSchema, publishSchema: PreferenceTogglePublishSchema, defaults: { ...Value.Create(PreferenceTogglePropsSchema), on: { theme: 'alt' }, off: { theme: 'default' } }, component: PreferenceToggleEditor,
  schema: { on: activeProfileControl, off: inactiveProfileControl, labelOn: { type: 'text', label: 'Active text' }, labelOff: { type: 'text', label: 'Inactive text' }, ariaLabelOn: { type: 'text', label: 'Active accessible label' }, ariaLabelOff: { type: 'text', label: 'Inactive accessible label' }, titleOn: { type: 'text', label: 'Active title' }, titleOff: { type: 'text', label: 'Inactive title' }, ...feedbackControls, htmlAttributes: htmlAttributesControl() },
  render(props, children) {
    return { html: `<button type="button" disabled aria-pressed="false"${props.ariaLabelOff ? ` aria-label="${props.ariaLabelOff}"` : ''}${props.titleOff ? ` title="${props.titleOff}"` : ''}${profileDataAttributes(preferenceToggleData(props))}${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.preference-toggle'])}>${props.labelOff}${children.join('')}</button>` }
  },
}

export const PreferenceOutputModule: ModuleDefinition<PreferenceOutputProps> = {
  id: 'base.preference-output', name: 'Preference text', description: 'Display authored text matching a selected preference group.',
  category: 'Interactive', version: '1.0.0', trusted: true, icon: SettingsCogSolidIcon, canHaveChildren: false, htmlTag: props => props.tag,
  propsSchema: PreferenceOutputPropsSchema, publishSchema: PreferenceOutputPublishSchema, defaults: { ...Value.Create(PreferenceOutputPropsSchema), when: { theme: 'alt' } }, component: PreferenceOutputEditor,
  schema: { tag: { type: 'select', label: 'HTML element', options: ['p','h1','h2','h3','h4','h5','h6','span','div','small','strong','em'].map(value => ({ value, label: value })) }, when: { type: 'preferenceValues', label: 'Matching preferences' }, textOn: { type: 'text', label: 'Matching text' }, textOff: { type: 'text', label: 'Other text' }, htmlAttributes: htmlAttributesControl() },
  render(props) {
    return { html: `<${props.tag}${profileDataAttributes(preferenceOutputData(props))}${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.preference-output'])}>${props.textOff}</${props.tag}>` }
  },
}

registry.registerOrReplace(PreferenceToggleModule)
registry.registerOrReplace(PreferenceOutputModule)
