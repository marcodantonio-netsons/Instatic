import { escapeHtml } from '../shared/htmlSafety'
import { gunzipSync,strFromU8 } from 'fflate'
import { Value } from '@sinclair/typebox/value'
import { catalogues } from './generatedCatalogues'
import { LanguageCatalogueSchema, type TranslationMessages as Messages } from './schema'
const cached=new Map<string,Messages>()
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function decodeBase64(text:string):Uint8Array{
 if(text.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))throw Error('Invalid compressed language asset')
 const result=new Uint8Array(text.length/4*3-(text.endsWith('==')?2:text.endsWith('=')?1:0))
 let offset=0
 for(let i=0;i<text.length;i+=4){const a=alphabet.indexOf(text[i]),b=alphabet.indexOf(text[i+1]),c=alphabet.indexOf(text[i+2]),d=alphabet.indexOf(text[i+3]);const n=(a<<18)|(b<<12)|((c<0?0:c)<<6)|(d<0?0:d);result[offset++]=n>>16;if(offset<result.length)result[offset++]=(n>>8)&255;if(offset<result.length)result[offset++]=n&255}
 return result
}
export function languageMessages(language:string):Messages{
 const hit=cached.get(language)
 if(hit){cached.delete(language);cached.set(language,hit);return hit}
 if(!Object.hasOwn(catalogues,language))throw Error('Unknown language '+language)
 const value:unknown=JSON.parse(strFromU8(gunzipSync(decodeBase64(catalogues[language]))))
 if(!Value.Check(LanguageCatalogueSchema,value)||value.language!==language)throw Error('Invalid language asset '+language)
 const messages:Messages=value.messages;cached.set(language,messages)
 if(cached.size>3)cached.delete(cached.keys().next().value!)
 return messages
}
export function translate(language:string,key:string):string{
 if(!/^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z][A-Za-z0-9_-]*)*$/.test(key))throw Error('Invalid translation key '+key)
 let value:string|Messages=languageMessages(language)
 for(const part of key.split('.')){if(typeof value==='string'||!Object.hasOwn(value,part))throw Error('Missing translation '+language+':'+key);value=value[part]}
 if(typeof value!=='string')throw Error('Translation does not address text '+key)
 return value
}

const languages=new Set(Object.keys(catalogues))
const copyPattern=/\{i18n\.([A-Za-z][A-Za-z0-9_.-]*)\}/g
const nativePattern=/\{((?:currentEntry|parentEntry|page|site|route)\.[^{}]+)\}/g
const entities:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#x27;':"'",'&#39;':"'"}
function unescapeHtml(value:string):string{return value.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g,entity=>entities[entity])}
/** Locale routing is explicit: the default Italian pages have no language prefix. */
export function languageFromPath(path:string):string{
 if(typeof path!=='string'||!path.startsWith('/'))throw Error('A resolved route path is required')
 const prefix=path.split('/')[1]
 return languages.has(prefix)?prefix:'it'
}
/** Public primitive props forward only the scalar native tokens a copy template uses. */
export function nativeArgumentName(token:string):string{
 const body=token.startsWith('{')&&token.endsWith('}')?token.slice(1,-1):token
 return 'arg_'+Array.from(body).map(character=>/[A-Za-z0-9]/.test(character)?character:'_'+character.codePointAt(0)!.toString(16)+'_').join('')
}
function renderCopy(key:string,language:string,args:Readonly<Record<string,unknown>>,escaped:boolean):string{
 const template=translate(language,key)
 let result='',offset=0
 for(const match of template.matchAll(nativePattern)){
  const literal=template.slice(offset,match.index)
  result+=escaped?escapeHtml(literal):literal
  const argument=args[nativeArgumentName(match[1])]
  if(!['string','number','boolean'].includes(typeof argument))throw Error('Missing translation argument '+match[1])
  result+=escaped?String(argument):unescapeHtml(String(argument))
  offset=match.index!+match[0].length
 }
 const rest=template.slice(offset)
 return result+(escaped?escapeHtml(rest):rest)
}
/** Raw structured props are not HTML-escaped by the official module boundary. */
export function localizeProps(value:unknown,language:string,args:Readonly<Record<string,unknown>>={}):unknown{
 if(typeof value==='string')return value.replace(copyPattern,(_token,key:string)=>renderCopy(key,language,args,false))
 if(Array.isArray(value))return value.map(item=>localizeProps(item,language,args))
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,localizeProps(item,language,args)]))
 return value
}
/** Preserve already-escaped literals; escape only newly inserted translated text. */
export function localizeRenderProps(props:Readonly<Record<string,unknown>>,language:string,urlKeys:ReadonlySet<string>|readonly string[]=[]):Record<string,unknown>{
 const urls=Array.isArray(urlKeys)?new Set(urlKeys):urlKeys as ReadonlySet<string>
 return Object.fromEntries(Object.entries(props).map(([key,value])=>{
  if(key.startsWith('arg_'))return [key,value]
  if(typeof value==='string')return [key,value.replace(copyPattern,(_token,copyKey:string)=>renderCopy(copyKey,language,props,!urls.has(key)))]
  return [key,localizeProps(value,language,props)]
 }))
}
