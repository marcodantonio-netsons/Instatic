import { normalizeRenderProps } from './shared/normalize'
import { htmlAttributesAttr } from './shared/attributeEmitter'
import { resolveHtmlTag } from './shared/tags'
import { escapeHtml } from './shared/htmlSafety'
import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { PluginModuleDefinition } from '@instatic/plugin-sdk'
const PropsSchema=Type.Object({tag:Type.String({default:'div'}),customTag:Type.String({default:''}),targetId:Type.String({default:'',pattern:'^$|^[A-Za-z][A-Za-z0-9_.:-]*$'}),edge:Type.Union([Type.Literal('start'),Type.Literal('end')],{default:'end'}),offset:Type.Number({default:0}),htmlAttributes:Type.Record(Type.String(),Type.String(),{default:{}})})

const generated=new Set(['data-instatic-scroll-state','data-instatic-scroll-target','data-instatic-scroll-edge','data-instatic-scroll-offset','data-instatic-scroll-motion'])
const module:PluginModuleDefinition={
 id:'netsons.site.scroll-state',name:'Scroll state',category:'Netsons',version:'1.0.0',htmlTag:'div',canHaveChildren:true,propsSchema:PropsSchema,defaults:{...Value.Create(PropsSchema),routePath:'{route.path}'},
 schema:{targetId:{type:'text',label:'Target element ID'},edge:{type:'select',label:'Target edge',options:[{label:'Start',value:'start'},{label:'End',value:'end'}]},offset:{type:'number',label:'Viewport offset (px)'}},
 render(input,children){
  const props=normalizeRenderProps(PropsSchema,input)
  if(!Value.Check(PropsSchema,props))throw Error('Invalid scroll state properties')
  const tag=resolveHtmlTag(props.tag,props.customTag)
  const authored=htmlAttributesAttr(props.htmlAttributes,[...generated])
  const runtime={'data-instatic-scroll-state':'before','data-instatic-scroll-target':props.targetId,'data-instatic-scroll-edge':props.edge,'data-instatic-scroll-offset':String(props.offset)}
  return {html:`<${tag}${authored}${Object.entries(runtime).map(([key,value])=>` ${key}="${escapeHtml(value)}"`).join('')}>${children.join('')}</${tag}>`}
 },
}
export default module
