import type { ModuleComponentProps } from '@core/module-engine'
import { CanvasModulePlaceholder } from '@ui/components/CanvasModulePlaceholder'
import { SquareSolidIcon } from 'pixel-art-icons/icons/square-solid'

export function ConditionEditor({ props, children, mcClassName, nodeWrapperProps }: ModuleComponentProps) {
  if (props.show !== props.invert) return <>{children}</>
  return <CanvasModulePlaceholder {...nodeWrapperProps} className={mcClassName} icon={<SquareSolidIcon size={16} color="currentColor" />} label="Hidden conditional content" />
}
