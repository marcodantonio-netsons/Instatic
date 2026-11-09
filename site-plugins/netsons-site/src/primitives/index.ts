import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { PluginModuleDefinition } from '@instatic/plugin-sdk'
import { TextPropsSchema } from './text/props'
import { LinkPropsSchema } from './link/props'
import { ButtonPropsSchema } from './button/props'
import { ContainerPropsSchema } from './container/props'
import { normalizeRenderProps } from '../shared/normalize'
import { htmlAttributesAttr } from '../shared/attributeEmitter'
import { escapeHtml,safeUrl } from '../shared/htmlSafety'
import { anchorHtmlAttributes,ANCHOR_TARGET_OPTIONS } from '../shared/anchors'
import { resolveHtmlTag,VOID_HTML_ELEMENTS } from '../shared/tags'
import { languageFromPath } from '../localization'
import { formatNumber } from '../numbers'
import rawFormats from '../numbers/projections.json'
import { NumberOptionsSchema } from '../numbers'
const formatsSchema=Type.Record(Type.String(),Type.Object({field:Type.String(),options:NumberOptionsSchema}))
if(!Value.Check(formatsSchema,rawFormats))throw Error('Invalid price-format catalogue')
const formats:Record<string,typeof formatsSchema.static[string]>=rawFormats
const textSchema=Type.Object({...TextPropsSchema.properties,numericValue:Type.Union([Type.String(),Type.Number()],{default:''}),numberFormatId:Type.String({default:''})})
const routeDefaults={routePath:'{route.path}'}
export const TextModule:PluginModuleDefinition={
 id:'netsons.site.text',name:'Localized text',category:'Netsons',version:'1.0.0',canHaveChildren:false,
 defaults:{...Value.Create(textSchema),...routeDefaults},propsSchema:textSchema,
 schema:{text:{type:'textarea',label:'Text or language key'},tag:{type:'select',label:'Tag',options:['none','p','h1','h2','h3','h4','h5','h6','span','div','small','strong','em'].map(value=>({label:value,value}))},numericValue:{type:'text',label:'Bound numeric value'},numberFormatId:{type:'select',label:'Number format',options:[{label:'Plain text',value:''},...Object.keys(formats).map(value=>({label:formats[value].field+' '+(formats[value].options.locale??'page locale'),value}))]}},
 render(input){
  const p=normalizeRenderProps(textSchema,input)
  if(!Value.Check(textSchema,p))throw Error('Invalid text props')
  let text=p.text
  if(p.numberFormatId&&p.numericValue!==''){
   if(!Object.hasOwn(formats,p.numberFormatId))throw Error('Unknown price format '+p.numberFormatId)
   text=escapeHtml(formatNumber(p.numericValue,languageFromPath(String(input.routePath)),formats[p.numberFormatId].options))
  }
  if(p.tag==='none')return {html:text}
  return {html:`<${p.tag}${htmlAttributesAttr(p.htmlAttributes)}>${text.replace(/\n/g,'<br>')}</${p.tag}>`}
 },
}
export const LinkModule:PluginModuleDefinition={
 id:'netsons.site.link',name:'Localized link',category:'Netsons',version:'1.0.0',canHaveChildren:true,htmlTag:'a',
 defaults:{...Value.Create(LinkPropsSchema),...routeDefaults},propsSchema:LinkPropsSchema,
 schema:{href:{type:'url',label:'URL or language key'},text:{type:'text',label:'Link text'},target:{type:'select',label:'Target',options:[...ANCHOR_TARGET_OPTIONS]}},
 render(input,children){
  const p=normalizeRenderProps(LinkPropsSchema,input,['href'])
  if(!Value.Check(LinkPropsSchema,p))throw Error('Invalid link props')
  const {attributes,rel}=anchorHtmlAttributes(p.htmlAttributes,p.target)
  return {html:`<a${htmlAttributesAttr(attributes)} href="${safeUrl(p.href)}" target="${p.target}"${rel?` rel="${escapeHtml(rel)}"`:''}>${children.length?children.join(''):p.text}</a>`}
 },
}
export const ButtonModule:PluginModuleDefinition={
 id:'netsons.site.button',name:'Localized button',category:'Netsons',version:'1.0.0',canHaveChildren:false,
 defaults:{...Value.Create(ButtonPropsSchema),...routeDefaults},propsSchema:ButtonPropsSchema,
 schema:{label:{type:'text',label:'Label'},href:{type:'url',label:'URL or language key'},target:{type:'select',label:'Target',options:[...ANCHOR_TARGET_OPTIONS]},disabled:{type:'toggle',label:'Disabled'},buttonType:{type:'select',label:'Button type',options:[{label:'Button',value:'button'},{label:'Reset',value:'reset'}]}},
 render(input){
  const p=normalizeRenderProps(ButtonPropsSchema,input,['href'])
  if(!Value.Check(ButtonPropsSchema,p))throw Error('Invalid button props')
  const href=safeUrl(p.href)
  if(href&&href!=='#'){
   const {attributes,rel}=anchorHtmlAttributes(p.htmlAttributes,p.target)
   return {html:`<a${htmlAttributesAttr(attributes)} href="${href}" target="${p.target}"${rel?` rel="${escapeHtml(rel)}"`:''}>${p.label}</a>`}
  }
  return {html:`<button${htmlAttributesAttr(p.htmlAttributes)} type="${p.buttonType}"${p.disabled?' disabled aria-disabled="true"':''}>${p.label}</button>`}
 },
}
export const ContainerModule:PluginModuleDefinition={
 id:'netsons.site.container',name:'Localized container',category:'Netsons',version:'1.0.0',canHaveChildren:true,
 defaults:{...Value.Create(ContainerPropsSchema),...routeDefaults},propsSchema:ContainerPropsSchema,
 schema:{tag:{type:'select',label:'Tag',options:['div','section','article','main','header','footer','nav','ul','ol','li','custom'].map(value=>({label:value,value}))},customTag:{type:'text',label:'Custom tag'}},
 render(input,children){
  const p=normalizeRenderProps(ContainerPropsSchema,input)
  if(!Value.Check(ContainerPropsSchema,p))throw Error('Invalid container props')
  const tag=resolveHtmlTag(p.tag,p.customTag),attrs=htmlAttributesAttr(p.htmlAttributes)
  return {html:VOID_HTML_ELEMENTS.has(tag.toLowerCase())?`<${tag}${attrs}>`:`<${tag}${attrs}>${children.join('')}</${tag}>`}
 },
}
const ConditionSchema=Type.Object({show:Type.Boolean({default:true}),invert:Type.Boolean({default:false}),whenLanguage:Type.Union(['','it','en','de','fr','es','pt','nl','pl','ro'].map(value=>Type.Literal(value)),{default:''})})
export const ConditionModule:PluginModuleDefinition={
 id:'netsons.site.condition',name:'Condition',category:'Netsons',version:'1.0.0',canHaveChildren:true,defaults:{...Value.Create(ConditionSchema),...routeDefaults},propsSchema:ConditionSchema,schema:{show:{type:'toggle',label:'Show content'},invert:{type:'toggle',label:'Invert'},whenLanguage:{type:'select',label:'Page language',options:['','it','en','de','fr','es','pt','nl','pl','ro'].map(value=>({label:value||'Any language',value}))}},
 render(input,children){const props=normalizeRenderProps(ConditionSchema,input);if(!Value.Check(ConditionSchema,props))throw Error('Invalid condition');const matches=props.show&&(!props.whenLanguage||props.whenLanguage===languageFromPath(String(input.routePath)));return {html:matches!==props.invert?children.join(''):''}},
}
export default [TextModule,LinkModule,ButtonModule,ContainerModule,ConditionModule]
