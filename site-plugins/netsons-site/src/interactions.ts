import { installDisclosureBehavior } from './disclosureBehavior'
import { installScrollStateBehavior } from './scrollStateBehavior'
import { installScrollRailBehavior } from './navigation/runtime'
import { installTabsBehavior } from './navigation/runtime'
import { installSectionNavBehavior } from './navigation/runtime'
function install(){
 installDisclosureBehavior(document)
 installScrollStateBehavior(document)
 installScrollRailBehavior(document)
 installTabsBehavior(document)
 installSectionNavBehavior(document)
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install()
