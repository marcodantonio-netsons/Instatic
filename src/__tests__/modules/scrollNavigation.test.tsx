import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'
import '@modules/base'
import { TabEditor } from '@modules/base/scrollNavigation'
import { registry } from '@core/module-engine'
import { publishPage, assertScrollNavigationForest, ScrollNavigationConfigurationError } from '@core/publisher'
import { parseValue } from '@core/utils/typeboxHelpers'
import { VisualComponentSchema } from '@core/visualComponents'
import { ScrollRailModule, ScrollControlsModule, ScrollButtonModule, SectionNavModule, TabsModule, TabModule, TabPanelModule, TabLinkModule, installScrollRailBehavior, installSectionNavBehavior, installTabsBehavior, SCROLL_RAIL_RUNTIME_JS, SECTION_NAV_RUNTIME_JS, TABS_RUNTIME_JS } from '@modules/base/scrollNavigation'
import { makePage, makeSite } from '../publisher/helpers'

const releases: Array<() => void> = []
afterEach(() => { cleanup(); releases.splice(0).forEach(release => release()); document.body.replaceChildren(); document.documentElement.removeAttribute('data-instatic-motion') })
const settle = () => new Promise(resolve => window.setTimeout(resolve, 30))
function railHtml() {
  return ScrollRailModule.render({ ...ScrollRailModule.defaults, htmlAttributes: { tabindex: '0', 'aria-label': 'Offers' } }, ['<a href="/offer">Offer</a>']).html + ScrollControlsModule.render(ScrollControlsModule.defaults, [ScrollButtonModule.render({ ...ScrollButtonModule.defaults, label: '‹', direction: 'previous', htmlAttributes: { 'aria-label': 'Previous offers' } }, []).html + ScrollButtonModule.render({ ...ScrollButtonModule.defaults, label: '›', htmlAttributes: { 'aria-label': 'Next offers' } }, []).html]).html
}
function dimensions(rail: HTMLElement, width = 400, scrollWidth = 900) {
  Object.defineProperty(rail, 'clientWidth', { configurable: true, value: width })
  Object.defineProperty(rail, 'scrollWidth', { configurable: true, value: scrollWidth })
  const moves: ScrollToOptions[] = []
  Object.defineProperty(rail, 'scrollBy', { configurable: true, value: (options: ScrollToOptions) => moves.push(options) })
  Object.defineProperty(rail, 'setPointerCapture', { configurable: true, value: () => {} })
  Object.defineProperty(rail, 'hasPointerCapture', { configurable: true, value: () => true })
  Object.defineProperty(rail, 'releasePointerCapture', { configurable: true, value: () => {} })
  return moves
}
function tabsHtml(groupId = '') {
  const tabs = [0,1,2].map(index => TabModule.render({ ...TabModule.defaults, label: 'Tab ' + index, tabKey: groupId ? 'key-' + index : '', initiallySelected: index === 0 }, []).html).join('')
  const panels = [0,1,2].map(index => TabPanelModule.render({ ...TabPanelModule.defaults, initiallyHidden: index !== 0 }, ['<a href="/panel-' + index + '">Panel ' + index + '</a>']).html)
  return TabsModule.render({...TabsModule.defaults,groupId}, ['<div role="tablist" aria-label="Services">' + tabs + '</div>', ...panels]).html
}
describe('generic scroll rails', () => {
  it('pairs adjacent controls structurally, preserves labels and native enabled edge behavior', () => {
    document.body.innerHTML = railHtml() + '<button id="outside">Outside</button>'
    const rail = document.querySelector<HTMLElement>('[data-instatic-scroll-rail]')!, moves = dimensions(rail)
    const controls = document.querySelector<HTMLElement>('[data-instatic-scroll-controls]')!
    expect(controls.hidden).toBe(true)
    releases.push(installScrollRailBehavior(document))
    expect(controls.hidden).toBe(false)
    const buttons = controls.querySelectorAll('button')
    expect(buttons[0].getAttribute('aria-label')).toBe('Previous offers')
    expect(buttons[0].getAttribute('aria-controls')).toBe(rail.id)
    fireEvent.click(buttons[1]); fireEvent.click(buttons[0]); fireEvent.click(document.getElementById('outside')!)
    expect(moves.map(move => move.left)).toEqual([328,-328])
    expect(buttons[0].disabled).toBe(false)
    expect(buttons[1].disabled).toBe(false)
    expect(buttons[0].type).toBe('button')
    document.documentElement.setAttribute('data-instatic-motion','reduced')
    fireEvent.click(buttons[1]); expect(moves[2].behavior).toBe('instant')
  })
  it('updates overflow after resize and supports late inserted content', async () => {
    document.body.innerHTML = railHtml()
    const rail = document.querySelector<HTMLElement>('[data-instatic-scroll-rail]')!
    dimensions(rail,800,500)
    releases.push(installScrollRailBehavior(document))
    const controls = document.querySelector<HTMLElement>('[data-instatic-scroll-controls]')!
    expect(controls.hidden).toBe(true)
    dimensions(rail,300,500); window.dispatchEvent(new Event('resize')); await settle()
    expect(controls.hidden).toBe(false)
    const late = document.createElement('section'); late.innerHTML = railHtml(); document.body.append(late)
    const lateRail = late.querySelector<HTMLElement>('[data-instatic-scroll-rail]')!; dimensions(lateRail)
    await settle()
    expect(late.querySelector<HTMLElement>('[data-instatic-scroll-controls]')!.hidden).toBe(false)
    expect(lateRail.id).not.toBe(rail.id)
  })
  it('pointer dragging suppresses the following link click and releases capture', () => {
    document.body.innerHTML=railHtml()
    const rail=document.querySelector<HTMLElement>('[data-instatic-scroll-rail]')!; dimensions(rail); releases.push(installScrollRailBehavior(document))
    const link=rail.querySelector('a')!
    const pointer = (type:string,x:number) => new window.PointerEvent(type,{pointerId:4,pointerType:'mouse',button:0,clientX:x,bubbles:true,cancelable:true})
    link.dispatchEvent(pointer('pointerdown',100)); link.dispatchEvent(pointer('pointermove',60))
    expect(rail.getAttribute('data-instatic-dragging')).toBe('true'); expect(rail.scrollLeft).toBe(40)
    link.dispatchEvent(pointer('pointerup',60)); expect(rail.hasAttribute('data-instatic-dragging')).toBe(false)
    const click = new MouseEvent('click',{bubbles:true,cancelable:true}); link.dispatchEvent(click); expect(click.defaultPrevented).toBe(true)
    const ordinary = new MouseEvent('click',{bubbles:true,cancelable:true}); link.dispatchEvent(ordinary); expect(ordinary.defaultPrevented).toBe(false)
  })
  it('keeps two actual instances of one Visual Component independent, without persisted IDs', () => {
    const definitionPage=makePage({root:{moduleId:'base.body',children:['rail','controls']},rail:{moduleId:'base.scroll-rail',children:['offer'],props:{htmlAttributes:{tabindex:'0','aria-label':'Offers'}}},offer:{moduleId:'base.link',props:{href:'/offer',text:'Offer'}},controls:{moduleId:'base.scroll-controls',children:['prev','next']},prev:{moduleId:'base.scroll-button',props:{direction:'previous',label:'Previous'}},next:{moduleId:'base.scroll-button',props:{direction:'next',label:'Next'}}})
    const component=parseValue(VisualComponentSchema,{id:'offers',name:'Offers',tree:{nodes:definitionPage.nodes,rootNodeId:definitionPage.rootNodeId},params:[],classIds:[],createdAt:0})
    const page=makePage({root:{moduleId:'base.body',children:['one','two']},one:{moduleId:'base.visual-component-ref',props:{componentId:component.id,propOverrides:{}}},two:{moduleId:'base.visual-component-ref',props:{componentId:component.id,propOverrides:{}}}})
    const site=makeSite({pages:[page],visualComponents:[component]})
    const published=publishPage(page,site,registry)
    expect(published.jsModuleIds).toEqual(['base.scroll-rail'])
    document.body.innerHTML=published.html
    const rails=document.querySelectorAll<HTMLElement>('[data-instatic-scroll-rail]'); expect(rails).toHaveLength(2)
    const first=dimensions(rails[0]),second=dimensions(rails[1]); releases.push(installScrollRailBehavior(document))
    expect(rails[0].id).not.toBe(rails[1].id)
    const controls=document.querySelectorAll<HTMLElement>('[data-instatic-scroll-controls]')
    fireEvent.click(controls[1].querySelectorAll('button')[1]); expect(first).toHaveLength(0); expect(second).toHaveLength(1)
    expect(controls[1].querySelector('button')!.getAttribute('aria-controls')).toBe(rails[1].id)
    expect(SCROLL_RAIL_RUNTIME_JS).not.toContain('netsons')
  })
})
describe('section navigation and tabs',()=>{
  it('selects a named tab through an external semantic fragment link, preserving new-tab gestures and child markup',()=>{
    const link=TabLinkModule.render({...TabLinkModule.defaults,groupId:'offers',tabKey:'key-2',href:'#offers'},['<strong>Cloud</strong>']).html
    const other=TabLinkModule.render({...TabLinkModule.defaults,groupId:'offers',tabKey:'key-1',href:'#offers',target:'_blank'},['Other']).html
    document.body.innerHTML=link+other+'<section id="offers">'+tabsHtml('offers')+'</section>'+tabsHtml('separate')
    releases.push(installTabsBehavior(document))
    const anchor=document.querySelector<HTMLAnchorElement>('a[data-instatic-tab-link]')!,owner=document.querySelector<HTMLElement>('[data-instatic-tabs-group="offers"]')!,tabs=owner.querySelectorAll('[data-instatic-tab]'),panels=owner.querySelectorAll<HTMLElement>('[data-instatic-tab-panel]')
    const modified=new MouseEvent('click',{bubbles:true,cancelable:true,button:0,ctrlKey:true});anchor.dispatchEvent(modified)
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');expect(modified.defaultPrevented).toBe(false)
    const click=new MouseEvent('click',{bubbles:true,cancelable:true,button:0});anchor.dispatchEvent(click)
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');expect(panels[2].hidden).toBe(false);expect(click.defaultPrevented).toBe(false)
    expect(anchor.getAttribute('href')).toBe('#offers');expect(anchor.innerHTML).toBe('<strong>Cloud</strong>')
    const blank=document.querySelectorAll<HTMLAnchorElement>('a[data-instatic-tab-link]')[1];blank.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0}))
    expect(tabs[2].getAttribute('aria-selected')).toBe('true');expect(blank.rel).toBe('noopener noreferrer')
    expect(document.querySelector('[data-instatic-tabs-group="separate"] [data-instatic-tab]')!.getAttribute('aria-selected')).toBe('true')
  })
  it('validates named group/key/fragment references after native composition',()=>{
    const page=makePage({root:{moduleId:'base.body',children:['link','section']},link:{moduleId:'base.tab-link',props:{groupId:'offers',tabKey:'web',href:'#offers'}},section:{moduleId:'base.container',props:{htmlAttributes:{id:'offers'}},children:['tabs']},tabs:{moduleId:'base.tabs',props:{groupId:'offers'},children:['list','panel']},list:{moduleId:'base.container',props:{htmlAttributes:{role:'tablist'}},children:['tab']},tab:{moduleId:'base.tab',props:{tabKey:'web',initiallySelected:true,label:'Web'}},panel:{moduleId:'base.tab-panel',props:{initiallyHidden:false}}})
    expect(()=>assertScrollNavigationForest({nodes:page.nodes,rootNodeIds:[page.rootNodeId]})).not.toThrow()
    page.nodes.link.props.tabKey='missing'
    expect(()=>assertScrollNavigationForest({nodes:page.nodes,rootNodeIds:[page.rootNodeId]})).toThrow('identify one tab')
    page.nodes.link.props.tabKey='web';page.nodes.link.props.href='#absent'
    expect(()=>assertScrollNavigationForest({nodes:page.nodes,rootNodeIds:[page.rootNodeId]})).toThrow('identify one rendered target')
  })
  it('keeps an authored tab label visible in canvas with an empty children array',()=>{
    const view=render(<TabEditor props={{...TabModule.defaults,label:'Cloud services',initiallySelected:true}} nodeId="tab" isSelected={false} mcClassName="serviceTab">{[]}</TabEditor>)
    expect(view.getByRole('tab').textContent).toBe('Cloud services')
    expect(view.getByRole('tab').className).toBe('serviceTab')
    expect(view.getByRole('tab').getAttribute('aria-selected')).toBe('true')
  })
  it('executes the published self-contained module assets without imports or injected globals',()=>{
    document.body.innerHTML=railHtml()+tabsHtml()+SectionNavModule.render(SectionNavModule.defaults,['<a href="#section">Section</a>']).html+'<section id="section"></section>'
    dimensions(document.querySelector<HTMLElement>('[data-instatic-scroll-rail]')!)
    for(const script of [SCROLL_RAIL_RUNTIME_JS,SECTION_NAV_RUNTIME_JS,TABS_RUNTIME_JS]) {
      const release:unknown=new Function('document','return '+script)(document)
      expect(typeof release).toBe('function')
      if(typeof release!=='function')throw new Error('Published installer did not return its cleanup lease')
      releases.push(()=>release())
    }
    expect(document.querySelector<HTMLElement>('[data-instatic-scroll-controls]')!.hidden).toBe(false)
    expect(document.querySelector('[data-instatic-tab]')!.getAttribute('aria-controls')).toBe(document.querySelector('[data-instatic-tab-panel]')!.id)
    expect(document.querySelector('nav a')!.getAttribute('aria-current')).toBe('location')
  })

  it('keeps ordinary fragment links and updates aria-current using authored offset',async()=>{
    document.body.innerHTML=SectionNavModule.render(SectionNavModule.defaults,['<a href="#first">First</a><a href="#second">Second</a>']).html+'<section id="first"></section><section id="second"></section>'
    let secondTop=500
    Object.defineProperty(document.getElementById('first')!,'getBoundingClientRect',{value:()=>({top:100})})
    Object.defineProperty(document.getElementById('second')!,'getBoundingClientRect',{value:()=>({top:secondTop})})
    releases.push(installSectionNavBehavior(document))
    const links=document.querySelectorAll('nav a');expect(links[0].getAttribute('aria-current')).toBe('location');expect(links[1].hasAttribute('aria-current')).toBe(false)
    secondTop=159;window.dispatchEvent(new Event('scroll'));await settle()
    expect(links[1].getAttribute('aria-current')).toBe('location');expect(links[0].hasAttribute('aria-current')).toBe(false);expect(links[1].getAttribute('href')).toBe('#second')
  })
  it('tabs activate on click/Arrow/Home/End, preserve all panels and isolate instances',()=>{
    document.body.innerHTML=tabsHtml()+tabsHtml()
    releases.push(installTabsBehavior(document))
    const owners=document.querySelectorAll<HTMLElement>('[data-instatic-tabs]'), tabs=owners[0].querySelectorAll<HTMLButtonElement>('[data-instatic-tab]'),panels=owners[0].querySelectorAll<HTMLElement>('[data-instatic-tab-panel]')
    expect(new Set(Array.from(document.querySelectorAll('[id]')).map(node=>node.id)).size).toBe(12)
    expect(tabs[0].getAttribute('aria-controls')).toBe(panels[0].id)
    fireEvent.keyDown(tabs[0],{key:'ArrowLeft'});expect(document.activeElement).toBe(tabs[2]);expect(panels[2].hidden).toBe(false);expect(tabs[0].tabIndex).toBe(-1)
    fireEvent.keyDown(tabs[2],{key:'Home'});expect(document.activeElement).toBe(tabs[0])
    fireEvent.keyDown(tabs[0],{key:'End'});expect(document.activeElement).toBe(tabs[2])
    fireEvent.keyDown(tabs[2],{key:'ArrowRight'});expect(document.activeElement).toBe(tabs[0])
    fireEvent.click(tabs[1]);expect(panels[1].hidden).toBe(false);expect(panels[0].hidden).toBe(true)
    expect(owners[1].querySelector('[data-instatic-tab]')!.getAttribute('aria-selected')).toBe('true')
    expect(document.querySelectorAll('[data-instatic-tab-panel]')).toHaveLength(6)
    expect(TABS_RUNTIME_JS).not.toContain('netsons')
  })
  it('rejects malformed authored relationships instead of silently masking them',()=>{
    const broken=makePage({root:{moduleId:'base.body',children:['controls']},controls:{moduleId:'base.scroll-controls',children:['next']},next:{moduleId:'base.scroll-button',props:{direction:'next',label:'Next'}}})
    expect(()=>assertScrollNavigationForest({nodes:broken.nodes,rootNodeIds:[broken.rootNodeId]})).toThrow(ScrollNavigationConfigurationError)
    const invalid=makePage({root:{moduleId:'base.body',children:['tabs']},tabs:{moduleId:'base.tabs',children:['list','panel']},list:{moduleId:'base.container',props:{htmlAttributes:{role:'tablist'}},children:['tab']},tab:{moduleId:'base.tab',props:{initiallySelected:false,label:'One'}},panel:{moduleId:'base.tab-panel',props:{initiallyHidden:true}}})
    expect(()=>assertScrollNavigationForest({nodes:invalid.nodes,rootNodeIds:[invalid.rootNodeId]})).toThrow('exactly one initial selection')
  })
})
