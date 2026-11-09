import { Value } from '@sinclair/typebox/value'
import type { TSchema, Static } from '@sinclair/typebox'
import { languageFromPath,localizeRenderProps } from '../localization'
export function normalizeRenderProps<T extends TSchema>(schema:T,props:Record<string,unknown>,urlKeys:readonly string[]=[]):Static<T> & Record<string,unknown>{
 if(typeof props.routePath !== 'string' || !props.routePath.startsWith('/'))throw Error('Unresolved module route path: '+String(props.routePath))
 const language=languageFromPath(props.routePath)
 const localized=localizeRenderProps(props,language,urlKeys)
 const defaulted:unknown=Value.Default(schema,localized)
 if(!Value.Check(schema,defaulted))throw Error('Invalid module properties')
 const parsed=Value.Parse(schema,defaulted)
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Module props must resolve to an object')
 return Object.assign({},localized,parsed)
}
