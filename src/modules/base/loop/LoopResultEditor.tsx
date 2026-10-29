import React from 'react'
import type { ModuleComponentProps } from '@core/module-engine'
import { resolveHtmlTag, htmlAttributesForReact } from '@core/htmlAttributes'
import { CanvasModulePlaceholder } from '@ui/components/CanvasModulePlaceholder'
import { BoxStackSolidIcon } from 'pixel-art-icons/icons/box-stack-solid'

export function LoopCountEditor({ mcClassName, nodeWrapperProps }: ModuleComponentProps) {
  return <CanvasModulePlaceholder {...nodeWrapperProps} className={mcClassName} icon={<BoxStackSolidIcon size={16} color="currentColor" />} label="Loop result count" />
}

export function LoopConditionalEditor({ props, children, mcClassName, nodeWrapperProps }: ModuleComponentProps) {
  return React.createElement(resolveHtmlTag(props.tag, props.customTag), {
    ...nodeWrapperProps, ...htmlAttributesForReact(props.htmlAttributes), className: mcClassName,
  }, children)
}
