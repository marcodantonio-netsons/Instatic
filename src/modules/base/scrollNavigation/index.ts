import { registry, type ModuleDefinition } from '@core/module-engine'
import { Value, Type } from '@core/utils/typeboxHelpers'
import { htmlAttributesAttr } from '@core/publisher'
import { MODULE_GENERATED_ATTRIBUTE_NAMES } from '@core/htmlAttributes'
import { htmlAttributesControl } from '@modules/base/shared/htmlAttributes'
import { ArrowsHorizontalIcon } from 'pixel-art-icons/icons/arrows-horizontal'
import { ScrollRailEditor, ScrollControlsEditor, ScrollButtonEditor, SectionNavEditor, TabsEditor, TabEditor, TabPanelEditor, TabLinkEditor } from './ScrollNavigationEditor'
import { ScrollRailPropsSchema, ScrollControlsPropsSchema, ScrollButtonPropsSchema, SectionNavPropsSchema, TabsPropsSchema, TabPropsSchema, TabPanelPropsSchema, TabLinkPropsSchema, type TabLinkProps, type TabsProps, type TabProps, type TabPanelProps, type ScrollRailProps, type ScrollControlsProps, type ScrollButtonProps, type SectionNavProps } from './props'
import { installScrollRailBehavior } from './scrollBehavior'
import { installSectionNavBehavior } from './sectionBehavior'
import { installTabsBehavior } from './tabBehavior'
import { safeUrl } from '@modules/base/utils/escape'
import { anchorRel } from '@modules/base/shared/anchorTarget'

export { ScrollRailPropsSchema, ScrollControlsPropsSchema, ScrollButtonPropsSchema, SectionNavPropsSchema, TabsPropsSchema, TabPropsSchema, TabPanelPropsSchema, TabLinkPropsSchema } from './props'
export type { ScrollRailProps, ScrollControlsProps, ScrollButtonProps, SectionNavProps, TabsProps, TabProps, TabPanelProps, TabLinkProps } from './props'
export { installScrollRailBehavior } from './scrollBehavior'
export { installSectionNavBehavior } from './sectionBehavior'
export { installTabsBehavior } from './tabBehavior'
export { TabEditor } from './ScrollNavigationEditor'
export const SCROLL_RAIL_RUNTIME_JS = `(${installScrollRailBehavior.toString()})(document);`
export const TABS_RUNTIME_JS = `(${installTabsBehavior.toString()})(document);`
export const SECTION_NAV_RUNTIME_JS = `(${installSectionNavBehavior.toString()})(document);`

export const ScrollRailModule: ModuleDefinition<ScrollRailProps> = {
  id: 'base.scroll-rail', name: 'Scroll rail', description: 'A horizontal scrolling region with optional adjacent controls and pointer dragging.',
  category: 'Interactive', version: '1.0.0', icon: ArrowsHorizontalIcon, trusted: true, canHaveChildren: true, htmlTag: 'div',
  propsSchema: ScrollRailPropsSchema, defaults: Value.Create(ScrollRailPropsSchema), component: ScrollRailEditor,
  schema: {
    stepRatio: { type: 'number', label: 'Step / viewport width', min: 0.01, max: 2, step: 0.01 },
    minimumStep: { type: 'number', label: 'Minimum step (px)', min: 0 },
    dragEnabled: { type: 'toggle', label: 'Pointer dragging' },
    htmlAttributes: htmlAttributesControl(),
  },
  assets: { js: SCROLL_RAIL_RUNTIME_JS },
  render: (props, children) => ({ html: `<div${htmlAttributesAttr(props.htmlAttributes)} data-instatic-scroll-rail="" data-instatic-scroll-step="${props.stepRatio}" data-instatic-scroll-minimum="${props.minimumStep}" data-instatic-scroll-drag="${props.dragEnabled}">${children.join('')}</div>` }),
}
export const ScrollControlsModule: ModuleDefinition<ScrollControlsProps> = {
  id: 'base.scroll-controls', name: 'Scroll controls', description: 'Controls immediately following their sibling Scroll rail; shown only when it overflows.',
  category: 'Interactive', version: '1.0.0', icon: ArrowsHorizontalIcon, trusted: true, canHaveChildren: true, htmlTag: 'div',
  propsSchema: ScrollControlsPropsSchema, defaults: Value.Create(ScrollControlsPropsSchema), component: ScrollControlsEditor,
  schema: { htmlAttributes: htmlAttributesControl() },
  assets: { css: '[data-instatic-scroll-controls][hidden]{display:none}' },
  render: (props, children) => ({ html: `<div${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.scroll-controls'])} data-instatic-scroll-controls="" hidden>${children.join('')}</div>` }),
}
export const ScrollButtonModule: ModuleDefinition<ScrollButtonProps> = {
  id: 'base.scroll-button', name: 'Scroll button', description: 'Moves the rail paired with its containing Scroll controls.',
  category: 'Interactive', version: '1.0.0', icon: ArrowsHorizontalIcon, trusted: true, canHaveChildren: false, htmlTag: 'button',
  propsSchema: ScrollButtonPropsSchema, defaults: Value.Create(ScrollButtonPropsSchema), component: ScrollButtonEditor,
  publishSchema: Type.Object({ props: Type.Object({ label: Type.String({ minLength: 1, pattern: '\\S' }) }) }),
  schema: {
    direction: { type: 'select', label: 'Direction', options: [{ value: 'previous', label: 'Previous' }, { value: 'next', label: 'Next' }] },
    label: { type: 'text', label: 'Label', category: 'content' },
    disabled: { type: 'toggle', label: 'Disabled' },
    htmlAttributes: htmlAttributesControl(),
  },
  render: (props) => ({ html: `<button${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.scroll-button'])} type="button" data-instatic-scroll-direction="${props.direction}"${props.disabled ? ' disabled' : ''}>${props.label}</button>` }),
}
export const SectionNavModule: ModuleDefinition<SectionNavProps> = {
  id: 'base.section-nav', name: 'Section navigation', description: 'Native fragment links with a current-section marker while scrolling.',
  category: 'Interactive', version: '1.0.0', icon: ArrowsHorizontalIcon, trusted: true, canHaveChildren: true, htmlTag: 'nav',
  propsSchema: SectionNavPropsSchema, defaults: Value.Create(SectionNavPropsSchema), component: SectionNavEditor,
  schema: { activationOffset: { type: 'number', label: 'Activation offset (px)', min: 0 }, htmlAttributes: htmlAttributesControl() },
  assets: { js: SECTION_NAV_RUNTIME_JS },
  render: (props, children) => ({ html: `<nav${htmlAttributesAttr(props.htmlAttributes)} data-instatic-section-nav="" data-instatic-section-offset="${props.activationOffset}">${children.join('')}</nav>` }),
}
export const TabsModule: ModuleDefinition<TabsProps> = {
  id: 'base.tabs', name: 'Tabs', description: 'One tab list followed by one ordered panel per tab.',
  category: 'Interactive', version: '1.0.0', icon: ArrowsHorizontalIcon, trusted: true, canHaveChildren: true, htmlTag: 'div',
  propsSchema: TabsPropsSchema, defaults: Value.Create(TabsPropsSchema), component: TabsEditor,
  schema: { groupId:{type:'text',label:'Group ID for tab links',normalize:'identifier',category:'layout'},htmlAttributes: htmlAttributesControl() }, assets: { js: TABS_RUNTIME_JS },
  render: (props, children) => ({ html: `<div${htmlAttributesAttr(props.htmlAttributes)} data-instatic-tabs=""${props.groupId?` data-instatic-tabs-group="${props.groupId}"`:''}>${children.join('')}</div>` }),
}
export const TabModule: ModuleDefinition<TabProps> = {
  id: 'base.tab', name: 'Tab', description: 'A tab in the owning Tabs tab list; the selected tab is the keyboard entry point.',
  category: 'Interactive', version: '1.0.0', icon: ArrowsHorizontalIcon, trusted: true, canHaveChildren: true, htmlTag: 'button',
  propsSchema: TabPropsSchema, defaults: Value.Create(TabPropsSchema), component: TabEditor,
  schema: { label: { type: 'text', label: 'Label', category: 'content' }, initiallySelected: { type: 'toggle', label: 'Initially selected' },tabKey:{type:'text',label:'Tab key for links',normalize:'identifier',category:'layout'}, htmlAttributes: htmlAttributesControl() },
  render: (props, children) => ({ html: `<button${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.tab'])} type="button" role="tab" aria-selected="${props.initiallySelected}" tabindex="${props.initiallySelected ? 0 : -1}" data-instatic-tab=""${props.tabKey?` data-instatic-tab-key="${props.tabKey}"`:''}>${children.length ? children.join('') : props.label}</button>` }),
}
export const TabLinkModule:ModuleDefinition<TabLinkProps>={
  id:'base.tab-link',name:'Tab link',description:'An ordinary fragment link which selects an authored tab before navigating.',category:'Interactive',version:'1.0.0',icon:ArrowsHorizontalIcon,trusted:true,canHaveChildren:true,htmlTag:'a',
  propsSchema:TabLinkPropsSchema,defaults:Value.Create(TabLinkPropsSchema),component:TabLinkEditor,
  schema:{href:{type:'url',label:'Link URL'},text:{type:'text',label:'Text',category:'content'},groupId:{type:'text',label:'Target group ID',normalize:'identifier',category:'layout'},tabKey:{type:'text',label:'Target tab key',normalize:'identifier',category:'layout'},target:{type:'select',label:'Open in',options:[{label:'Same tab',value:'_self'},{label:'New tab',value:'_blank'}]},htmlAttributes:htmlAttributesControl()},
  render:(props,children)=>({html:`<a href="${safeUrl(props.href)}" target="${props.target}"${anchorRel(props.target)?` rel="${anchorRel(props.target)}"`:''}${htmlAttributesAttr(props.htmlAttributes,MODULE_GENERATED_ATTRIBUTE_NAMES['base.tab-link'])} data-instatic-tab-link="${props.groupId}" data-instatic-target-tab="${props.tabKey}">${children.length?children.join(''):props.text}</a>`}),
}
export const TabPanelModule: ModuleDefinition<TabPanelProps> = {
  id: 'base.tab-panel', name: 'Tab panel', description: 'An ordered panel under Tabs; only the selected tab’s panel is shown.',
  category: 'Interactive', version: '1.0.0', icon: ArrowsHorizontalIcon, trusted: true, canHaveChildren: true, htmlTag: 'div',
  propsSchema: TabPanelPropsSchema, defaults: Value.Create(TabPanelPropsSchema), component: TabPanelEditor,
  schema: { initiallyHidden: { type: 'toggle', label: 'Initially hidden' }, htmlAttributes: htmlAttributesControl() },
  assets: { css: '[data-instatic-tab-panel][hidden]{display:none}' },
  render: (props, children) => ({ html: `<div${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.tab-panel'])} role="tabpanel" data-instatic-tab-panel=""${props.initiallyHidden ? ' hidden' : ''}>${children.join('')}</div>` }),
}
registry.registerOrReplace(ScrollRailModule)
registry.registerOrReplace(ScrollControlsModule)
registry.registerOrReplace(ScrollButtonModule)
registry.registerOrReplace(SectionNavModule)
registry.registerOrReplace(TabsModule)
registry.registerOrReplace(TabModule)
registry.registerOrReplace(TabPanelModule)
registry.registerOrReplace(TabLinkModule)
