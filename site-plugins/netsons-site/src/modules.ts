import { withSafePreview } from './shared/preview'
import preferences from './preferences'
import { formsModules } from './forms'
import { loopControlModules } from './loopControls/modules'
import primitives from './primitives'
import { normalizeRenderProps } from './shared/normalize'
import { htmlAttributesAttr } from './shared/attributeEmitter'
import navigation from './navigation'
import scrollState from './scrollState'
import { LanguageLinkModule } from './languageLinks'
import { SvgModule } from './svg'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { PluginModuleDefinition } from '@instatic/plugin-sdk'

const PropsSchema = Type.Object({
 group: Type.String({default:''}), initiallyOpen: Type.Boolean({default:false}),
 closeOnEscape: Type.Boolean({default:true}), closeOnOutsidePointer: Type.Boolean({default:false}),
 closeOnFocusLeave: Type.Boolean({default:false}), htmlAttributes: Type.Record(Type.String(),Type.String(),{default:{}}),
})

const disclosure: PluginModuleDefinition = {
 id:'netsons.site.disclosure', name:'Disclosure', category:'Netsons', version:'1.0.0', htmlTag:'details', canHaveChildren:true,
 defaults:{...Value.Create(PropsSchema),routePath:'{route.path}'}, propsSchema:PropsSchema,
 schema:{group:{type:'text',label:'Exclusive group'},initiallyOpen:{type:'toggle',label:'Initially open'},closeOnEscape:{type:'toggle',label:'Close with Escape'},closeOnOutsidePointer:{type:'toggle',label:'Close outside'},closeOnFocusLeave:{type:'toggle',label:'Close when focus leaves'}},
 render(input,children){
  const props=normalizeRenderProps(PropsSchema,input)
  if(!Value.Check(PropsSchema,props))throw Error('Invalid disclosure props')
  const attrs=Object.fromEntries(Object.entries(props.htmlAttributes).filter(([name])=>!['open','name'].includes(name.trim().toLowerCase())))
  return {html:`<details${htmlAttributesAttr(attrs)}${props.group?` name="${props.group}"`:''}${props.initiallyOpen?' open':''} data-instatic-disclosure="" data-instatic-close-on-escape="${props.closeOnEscape}" data-instatic-close-on-outside-pointer="${props.closeOnOutsidePointer}" data-instatic-close-on-focus-leave="${props.closeOnFocusLeave}">${children.join('')}</details>`}
 },
}
export default [...[disclosure,scrollState,LanguageLinkModule,...navigation,...primitives,...formsModules,...preferences,...loopControlModules].map(withSafePreview), SvgModule]
