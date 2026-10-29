import { Children } from 'react'
import type { ModuleComponentProps } from '@core/module-engine'
import { htmlAttributesForReact, MODULE_GENERATED_ATTRIBUTE_NAMES } from '@core/htmlAttributes'
import type { ScrollRailProps, ScrollControlsProps, ScrollButtonProps, SectionNavProps, TabsProps, TabProps, TabPanelProps, TabLinkProps } from './props'
import { safeUrl } from '@modules/base/utils/escape'
import { anchorRel } from '@modules/base/shared/anchorTarget'

/** Design canvas preserves authored DOM and styles; scrolling controls activate in live preview/publication. */
export function ScrollRailEditor({ props, children, mcClassName, nodeWrapperProps }: ModuleComponentProps<ScrollRailProps>) {
  return <div {...nodeWrapperProps} {...htmlAttributesForReact(props.htmlAttributes)} className={mcClassName} data-instatic-scroll-rail="" data-instatic-scroll-step={props.stepRatio} data-instatic-scroll-minimum={props.minimumStep} data-instatic-scroll-drag={String(props.dragEnabled)}>{children}</div>
}
export function ScrollControlsEditor({ props, children, mcClassName, nodeWrapperProps }: ModuleComponentProps<ScrollControlsProps>) {
  return <div {...nodeWrapperProps} {...htmlAttributesForReact(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.scroll-controls'])} className={mcClassName} data-instatic-scroll-controls="">{children}</div>
}
export function ScrollButtonEditor({ props, mcClassName, nodeWrapperProps }: ModuleComponentProps<ScrollButtonProps>) {
  return <button {...nodeWrapperProps} {...htmlAttributesForReact(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.scroll-button'])} type="button" disabled={props.disabled} className={mcClassName} data-instatic-scroll-direction={props.direction}>{props.label}</button>
}
export function SectionNavEditor({ props, children, mcClassName, nodeWrapperProps }: ModuleComponentProps<SectionNavProps>) {
  return <nav {...nodeWrapperProps} {...htmlAttributesForReact(props.htmlAttributes)} className={mcClassName} data-instatic-section-nav="" data-instatic-section-offset={props.activationOffset}>{children}</nav>
}

export function TabsEditor({ props, children, mcClassName, nodeWrapperProps }: ModuleComponentProps<TabsProps>) {
  return <div {...nodeWrapperProps} {...htmlAttributesForReact(props.htmlAttributes)} className={mcClassName} data-instatic-tabs="" data-instatic-tabs-group={props.groupId||undefined}>{children}</div>
}
export function TabEditor({ props, children, mcClassName, nodeWrapperProps }: ModuleComponentProps<TabProps>) {
  return <button {...nodeWrapperProps} {...htmlAttributesForReact(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.tab'])} type="button" role="tab" aria-selected={props.initiallySelected} tabIndex={props.initiallySelected ? 0 : -1} className={mcClassName} data-instatic-tab="" data-instatic-tab-key={props.tabKey||undefined}>{Children.count(children) ? children : props.label}</button>
}
export function TabLinkEditor({props,children,mcClassName,nodeWrapperProps}:ModuleComponentProps<TabLinkProps>){
  return <a {...nodeWrapperProps} {...htmlAttributesForReact(props.htmlAttributes,MODULE_GENERATED_ATTRIBUTE_NAMES['base.tab-link'])} href={safeUrl(props.href)} target={props.target} rel={anchorRel(props.target)??undefined} className={mcClassName} data-instatic-tab-link={props.groupId} data-instatic-target-tab={props.tabKey}>{Children.count(children)?children:props.text}</a>
}
export function TabPanelEditor({ props, children, mcClassName, nodeWrapperProps }: ModuleComponentProps<TabPanelProps>) {
  return <div {...nodeWrapperProps} {...htmlAttributesForReact(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.tab-panel'])} className={mcClassName} role="tabpanel" hidden={props.initiallyHidden} data-instatic-tab-panel="">{children}</div>
}
