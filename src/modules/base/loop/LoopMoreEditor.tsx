import React from 'react'
import type { ModuleComponentProps } from '@core/module-engine'
import { htmlAttributesForReact } from '@core/htmlAttributes'

/** The authored native button keeps ordinary class and child editing. */
export function LoopMoreEditor({ props, children, mcClassName, nodeWrapperProps }: ModuleComponentProps) {
  return React.createElement('button', {
    ...nodeWrapperProps, ...htmlAttributesForReact(props.htmlAttributes), type: 'button', className: mcClassName,
  }, React.Children.count(children) ? children : String(props.label))
}
