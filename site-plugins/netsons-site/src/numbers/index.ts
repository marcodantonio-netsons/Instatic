import { NumberFormat } from './generated/intl.js'
import { Type,type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { translate } from '../localization'
export const NumberOptionsSchema=Type.Object({locale:Type.Optional(Type.String({minLength:1})),minimumFractionDigits:Type.Optional(Type.Integer({minimum:0,maximum:20})),maximumFractionDigits:Type.Optional(Type.Integer({minimum:0,maximum:20})),useGrouping:Type.Optional(Type.Boolean()),templateKey:Type.Optional(Type.String({minLength:1}))},{additionalProperties:false})
export type NumberOptions=Static<typeof NumberOptionsSchema>
const formatters=new Map<string,Intl.NumberFormat>()
export function formatNumber(value:unknown,language:string,options:NumberOptions={}):string{
 if(!Value.Check(NumberOptionsSchema,options))throw Error('Invalid number format options')
 const number=typeof value==='number'?value:typeof value==='string'&&value.trim()!==''?Number(value.trim()):NaN
 if(!Number.isFinite(number))throw Error('Numeric binding requires a finite number')
 const locale=options.locale??language
 if(!locale||NumberFormat.supportedLocalesOf([locale]).length!==1)throw Error('Unsupported number locale '+locale)
 const {templateKey,locale:override,...digits}=options
 const key=JSON.stringify([locale,digits]);let formatter=formatters.get(key)
 if(!formatter){formatter=new NumberFormat(locale,{style:'decimal',...digits});formatters.set(key,formatter);if(formatters.size>64)formatters.delete(formatters.keys().next().value!)}
 const formatted=formatter.format(number)
 if(templateKey===undefined)return formatted
 const template=translate(language,templateKey)
 if((template.match(/\{value\}/g)?.length??0)!==1)throw Error('Numeric translation template requires exactly one {value}')
 return template.replace('{value}',formatted)
}
