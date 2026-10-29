import { useEffect, useRef, type ElementType } from 'react'
import type { ModuleComponentProps } from '@core/module-engine'
import { htmlAttributesForReact, MODULE_GENERATED_ATTRIBUTE_NAMES, resolveHtmlTag, VOID_HTML_ELEMENTS } from '@core/htmlAttributes'
import { scrollStateAttributes, type ScrollStateProps } from './props'
import { installScrollStateBehavior } from './behavior'

export function ScrollStateEditor({ props, children, mcClassName, nodeWrapperProps }: ModuleComponentProps<ScrollStateProps>) {
  const element = useRef<HTMLElement>(null)
  const tag = resolveHtmlTag(props.tag, props.customTag)
  const Tag = tag as ElementType
  useEffect(() => {
    const document = element.current?.ownerDocument
    return document ? installScrollStateBehavior(document) : undefined
  }, [tag])
  return <Tag
    {...nodeWrapperProps}
    {...htmlAttributesForReact(props.htmlAttributes, MODULE_GENERATED_ATTRIBUTE_NAMES['base.scroll-state'])}
    {...scrollStateAttributes(props)}
    className={mcClassName}
    ref={element}
  >{VOID_HTML_ELEMENTS.has(tag) ? undefined : children}</Tag>
}
