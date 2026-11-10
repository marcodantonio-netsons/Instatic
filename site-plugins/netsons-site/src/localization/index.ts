import { escapeHtml } from '../shared/htmlSafety'
import {
 MISSING_CATALOGUE_VALUE,
 OBJECT_CATALOGUE_VALUE,
 catalogueKeyIndexes,
 catalogueLanguages,
 catalogueStringPool,
 catalogueValueIdsByLanguage,
} from './generatedCatalogues'

const languages=new Set(catalogueLanguages)
export { catalogueLanguages }
export function translate(language:string,key:string):string{
 if(!/^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z][A-Za-z0-9_-]*)*$/.test(key))throw Error('Invalid translation key '+key)
 if(!Object.hasOwn(catalogueValueIdsByLanguage,language))throw Error('Unknown language '+language)
 const keyIndex=Object.hasOwn(catalogueKeyIndexes,key)?catalogueKeyIndexes[key]:undefined
 if(keyIndex===undefined)throw Error('Missing translation '+language+':'+key)
 const valueIndex=catalogueValueIdsByLanguage[language][keyIndex]
 if(valueIndex===MISSING_CATALOGUE_VALUE)throw Error('Missing translation '+language+':'+key)
 if(valueIndex===OBJECT_CATALOGUE_VALUE)throw Error('Translation does not address text '+key)
 return catalogueStringPool[valueIndex]!
}

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
