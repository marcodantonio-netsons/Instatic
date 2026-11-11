import { defineSiteModule } from '../shared/defineModule'
import { htmlAttributesAttr } from '../shared/attributeEmitter'
import { MODULE_GENERATED_ATTRIBUTE_NAMES } from '../shared/generatedAttributes'
import { ScrollRailPropsSchema, ScrollControlsPropsSchema, ScrollButtonPropsSchema, SectionNavPropsSchema, TabsPropsSchema, TabPropsSchema, TabPanelPropsSchema, TabLinkPropsSchema } from './props'
import { safeUrl } from '../shared/htmlSafety'
const anchorRel=(target:string)=>target==='_blank'?'noopener noreferrer':''

export { ScrollRailPropsSchema, ScrollControlsPropsSchema, ScrollButtonPropsSchema, SectionNavPropsSchema, TabsPropsSchema, TabPropsSchema, TabPanelPropsSchema, TabLinkPropsSchema } from './props'
export type { ScrollRailProps, ScrollControlsProps, ScrollButtonProps, SectionNavProps, TabsProps, TabProps, TabPanelProps, TabLinkProps } from './props'
export { installScrollRailBehavior } from './scrollBehavior'
export { installSectionNavBehavior } from './sectionBehavior'
export { installTabsBehavior } from './tabBehavior'

export const ScrollRailModule = defineSiteModule({
  id: 'netsons.site.scroll-rail', name: 'Scroll rail', description: 'A horizontal scrolling region with optional adjacent controls and pointer dragging.', version: '1.0.0',  canHaveChildren: true, htmlTag: 'div',
  propsSchema: ScrollRailPropsSchema,
  schema: {
    stepRatio: { type: 'number', label: 'Step / viewport width', min: 0.01, max: 2, step: 0.01 },
    minimumStep: { type: 'number', label: 'Minimum step (px)', min: 0 },
    dragEnabled: { type: 'toggle', label: 'Pointer dragging' },

  },
  render: (props, children) => ({ html: `<div${htmlAttributesAttr(props.htmlAttributes)} data-instatic-scroll-rail="" data-instatic-scroll-step="${props.stepRatio}" data-instatic-scroll-minimum="${props.minimumStep}" data-instatic-scroll-drag="${props.dragEnabled}">${children.join('')}</div>` }),
})
export const ScrollControlsModule = defineSiteModule({
  id: 'netsons.site.scroll-controls', name: 'Scroll controls', description: 'Controls immediately following their sibling Scroll rail; shown only when it overflows.', version: '1.0.0',  canHaveChildren: true, htmlTag: 'div',
  propsSchema: ScrollControlsPropsSchema,
  schema: {  },
  render: (props, children) => ({ html: `<div${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.scroll-controls'])} data-instatic-scroll-controls="" hidden>${children.join('')}</div>` }),
})
export const ScrollButtonModule = defineSiteModule({
  id: 'netsons.site.scroll-button', name: 'Scroll button', description: 'Moves the rail paired with its containing Scroll controls.', version: '1.0.0',  canHaveChildren: false, htmlTag: 'button',
  propsSchema: ScrollButtonPropsSchema,
  schema: {
    direction: { type: 'select', label: 'Direction', options: [{ value: 'previous', label: 'Previous' }, { value: 'next', label: 'Next' }] },
    label: { type: 'text', label: 'Label' },
    disabled: { type: 'toggle', label: 'Disabled' },

  },
  render: (props) => ({ html: `<button${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.scroll-button'])} type="button" data-instatic-scroll-direction="${props.direction}"${props.disabled ? ' disabled' : ''}>${props.label}</button>` }),
})
export const SectionNavModule = defineSiteModule({
  id: 'netsons.site.section-nav', name: 'Section navigation', description: 'Native fragment links with a current-section marker while scrolling.', version: '1.0.0',  canHaveChildren: true, htmlTag: 'nav',
  propsSchema: SectionNavPropsSchema,
  schema: { activationOffset: { type: 'number', label: 'Activation offset (px)', min: 0 },  },
  render: (props, children) => ({ html: `<nav${htmlAttributesAttr(props.htmlAttributes)} data-instatic-section-nav="" data-instatic-section-offset="${props.activationOffset}">${children.join('')}</nav>` }),
})
export const TabsModule = defineSiteModule({
  id: 'netsons.site.tabs', name: 'Tabs', description: 'One tab list followed by one ordered panel per tab.', version: '1.0.0',  canHaveChildren: true, htmlTag: 'div',
  propsSchema: TabsPropsSchema,
  schema: { groupId:{type:'text',label:'Group ID for tab links'}, },
  render: (props, children) => ({ html: `<div${htmlAttributesAttr(props.htmlAttributes)} data-instatic-tabs=""${props.groupId?` data-instatic-tabs-group="${props.groupId}"`:''}>${children.join('')}</div>` }),
})
export const TabModule = defineSiteModule({
  id: 'netsons.site.tab', name: 'Tab', description: 'A tab in the owning Tabs tab list; the selected tab is the keyboard entry point.', version: '1.0.0',  canHaveChildren: true, htmlTag: 'button',
  propsSchema: TabPropsSchema,
  schema: { label: { type: 'text', label: 'Label' }, initiallySelected: { type: 'toggle', label: 'Initially selected' },tabKey:{type:'text',label:'Tab key for links'},  },
  render: (props, children) => ({ html: `<button${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.tab'])} type="button" role="tab" aria-selected="${props.initiallySelected}" tabindex="${props.initiallySelected ? 0 : -1}" data-instatic-tab=""${props.tabKey?` data-instatic-tab-key="${props.tabKey}"`:''}>${children.length ? children.join('') : props.label}</button>` }),
})
export const TabLinkModule = defineSiteModule({
  id:'netsons.site.tab-link',name:'Tab link',description:'An ordinary fragment link which selects an authored tab before navigating.',version:'1.0.0',canHaveChildren:true,htmlTag:'a',
  propsSchema:TabLinkPropsSchema,
  schema:{href:{type:'url',label:'Link URL'},text:{type:'text',label:'Text'},groupId:{type:'text',label:'Target group ID'},tabKey:{type:'text',label:'Target tab key'},target:{type:'select',label:'Open in',options:[{label:'Same tab',value:'_self'},{label:'New tab',value:'_blank'}]},},
  render:(props,children)=>({html:`<a href="${safeUrl(props.href)}" target="${props.target}"${anchorRel(props.target)?` rel="${anchorRel(props.target)}"`:''}${htmlAttributesAttr(props.htmlAttributes,MODULE_GENERATED_ATTRIBUTE_NAMES['base.tab-link'])} data-instatic-tab-link="${props.groupId}" data-instatic-target-tab="${props.tabKey}">${children.length?children.join(''):props.text}</a>`}),
})
export const TabPanelModule = defineSiteModule({
  id: 'netsons.site.tab-panel', name: 'Tab panel', description: 'An ordered panel under Tabs; only the selected tab’s panel is shown.', version: '1.0.0',  canHaveChildren: true, htmlTag: 'div',
  propsSchema: TabPanelPropsSchema,
  schema: { initiallyHidden: { type: 'toggle', label: 'Initially hidden' },  },
  render: (props, children) => ({ html: `<div${htmlAttributesAttr(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.tab-panel'])} role="tabpanel" data-instatic-tab-panel=""${props.initiallyHidden ? ' hidden' : ''}>${children.join('')}</div>` }),
})
export default [ScrollRailModule,ScrollControlsModule,ScrollButtonModule,SectionNavModule,TabsModule,TabModule,TabLinkModule,TabPanelModule]
