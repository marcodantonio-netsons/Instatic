import { expect, it } from 'bun:test'
import '@modules/base'
import { registry } from '@core/module-engine'
import { publishPage } from '@core/publisher'
import { makeNode, makePage, makeSite } from '../fixtures'

it('prunes inactive structural content before child binding validation and asset collection', () => {
  const page=makePage({nodes:{
    root:makeNode({id:'root',moduleId:'base.body',children:['condition']}),
    condition:makeNode({id:'condition',moduleId:'base.condition',props:{show:false},children:['unavailable-binding']}),
    'unavailable-binding':makeNode({id:'unavailable-binding',moduleId:'base.condition',props:{show:'{currentEntry.missing}'},children:['text']}),
    text:makeNode({id:'text',moduleId:'base.text',props:{text:'Inactive child'}}),
  }})
  const site=makeSite({pages:[page]})
  let bindingReads=0
  const options={templateContext:{entryStack:[{id:'entry',fields:{
    get missing(){ bindingReads++; return undefined },
  }}]}}
  expect(publishPage(page,site,registry,options).html).not.toContain('Inactive child')
  expect(bindingReads).toBe(0)
  page.nodes.condition.props.show=true
  // The active child resolves its missing binding, then official per-property
  // repair replaces the non-boolean token with the module's show:true default.
  expect(publishPage(page,site,registry,options).html).toContain('Inactive child')
  expect(bindingReads).toBeGreaterThan(0)
})
