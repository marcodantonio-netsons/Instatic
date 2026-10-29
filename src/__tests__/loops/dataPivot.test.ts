import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { projectDataPivot, readDataPivotConfiguration, DataPivotSource } from '@core/loops'
import type { LoopItem } from '@core/loops'
import { makeSite } from '../fixtures'
import { createTestDb, type TestDb } from '../helpers/createTestDb'
const configuration = readDataPivotConfiguration({ matrixField:'matrix', keyField:'key', labelField:'label', groupField:'group', groupLabelField:'groupLabel', rawField:'raw', valueField:'annual', allowedValueFields:'monthly,annual', columnFields:'name', maxColumns:4, differencesOnly:true })
function column(id: string, values: Array<[string,string,string|null,string|null]>): LoopItem {
  return { id, fields: { name:id, matrix:values.map(([key,group,raw,value])=>({id:key,cells:{key,group,groupLabel:'Group '+group,label:key,raw,monthly:null,annual:value}})) } }
}
describe('native data comparison matrices', () => {
  it('compares raw values before display projection and marks sections after differences filtering', () => {
    const source = [column('catalog-a',[['a','one','same','annual-a'],['b','one','x',null],['c','two','z','z']]),column('catalog-b',[['a','one','same','annual-b'],['b','one','y','y'],['c','two','z','z']])]
    const before = structuredClone(source), result = projectDataPivot(source, configuration)
    expect(result.totalItems).toBe(1)
    expect(result.items[0].id).toBe('b'); expect(result.items[0].fields.startsGroup).toBe(true)
    expect(result.items[0].fields.cells).toEqual([{id:'catalog-a',displayValue:null,rawValue:'x',isEmpty:true,hasValue:false,name:'catalog-a'},{id:'catalog-b',displayValue:'y',rawValue:'y',isEmpty:false,hasValue:true,name:'catalog-b'}])
    expect(source).toEqual(before)
    expect(projectDataPivot([source[0]], configuration).totalItems).toBe(3)
    const full = projectDataPivot(source,{...configuration,differencesOnly:false},1,1)
    expect(full.totalItems).toBe(3);expect(full.items[0].fields.startsGroup).toBe(false)
  })
  it('projects an atomic semantic matrix with row-heading cells and only selected columns', () => {
    const source = [column('b',[['r','g','x','one']]),column('a',[['r','g','y',null]])]
    const result = projectDataPivot(source,{...configuration,projection:'matrix'})
    expect(result.totalItems).toBe(1)
    const matrix=result.items[0].fields
    expect(matrix.columnCount).toBe(2)
    expect((matrix.columns as Array<{id:string}>).map(cell=>cell.id)).toEqual(['row-heading','b','a'])
    expect((matrix.rows as Array<{cells:Array<{isHeading:boolean}>}>)[0].cells.map(cell=>cell.isHeading)).toEqual([true,false,false])
    expect(projectDataPivot(source,{...configuration,projection:'matrix'},1).items).toEqual([])
  })
  it('rejects unauthorized display fields, inconsistent matrices and excessive columns', () => {
    expect(()=>readDataPivotConfiguration({...configuration,valueField:'private'})).toThrow('not authorized')
    const a=column('a',[['a','group','x','x']]),b=column('b',[['other','group','y','y']])
    expect(()=>projectDataPivot([a,b],configuration)).toThrow('ordered keys')
    expect(()=>projectDataPivot([a,a,a,a,a],configuration)).toThrow('column limit')
    expect(projectDataPivot([],configuration)).toEqual({items:[],totalItems:0})
  })
})
describe('localized published matrix source', () => {
  let fixture:TestDb
  beforeAll(async()=>{
    fixture=await createTestDb()
    const fields=[{id:'name',label:'Name',type:'text'},{id:'index',label:'Order',type:'number'},{id:'matrix',label:'Matrix',type:'repeater',fields:[{id:'key',label:'Key',type:'text'},{id:'group',label:'Group',type:'text'},{id:'groupLabel',label:'Section',type:'localizedText'},{id:'label',label:'Label',type:'localizedText'},{id:'raw',label:'Raw',type:'text'},{id:'annual',label:'Value',type:'localizedText'}]}]
    await fixture.db`insert into data_tables (id,name,slug,kind,route_base,singular_label,plural_label,fields_json,system) values ('pivot-test','Matrix','pivot-test','data','','Item','Items',${fields},${false})`
    for(const [index,id] of ['z','a','unselected'].entries()) {
      const cells={name:id,index,matrix:[{id:'r',cells:{key:'r',group:'g',groupLabel:{key:'section'},label:{key:'label'},raw:id,annual:{key:'value'}}}]}
      await fixture.db`insert into data_rows (id,table_id,slug,cells_json,status) values (${id},'pivot-test',${id},${cells},'draft')`
    }
  })
  afterAll(async()=>{await fixture.cleanup()})
  it('reuses native selection, source order and repeater language projection before pivoting', async()=>{
    if(DataPivotSource.kind==='contextual')throw new Error('Expected prefetched matrix')
    const result=await DataPivotSource.fetch({db:fixture.db,site:makeSite(),filters:{...configuration,tableId:'pivot-test',rowIds:['a','z']},orderBy:'cell:index',direction:'asc',limit:100,offset:0,localization:{language:'it',translations:{section:'Risorse',label:'Memoria',value:'Incluso'}}})
    expect(result.totalItems).toBe(1);expect(result.items[0].fields.label).toBe('Memoria')
    expect(result.items[0].fields.cells).toEqual([{id:'z',displayValue:'Incluso',rawValue:'z',isEmpty:false,hasValue:true,name:'z'},{id:'a',displayValue:'Incluso',rawValue:'a',isEmpty:false,hasValue:true,name:'a'}])
  })
})
