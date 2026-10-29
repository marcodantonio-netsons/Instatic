import { describe, expect, it, mock } from 'bun:test'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { PropertyControlRenderer } from '@site/property-controls/PropertyControlRenderer'
import { EditorPermissionsContext } from '@site/editorPermissionsContext'
import { paramTypesCompatibleWithControl } from '@site/property-controls/paramTypeCompat'
import { getDynamicBindingMode, isFieldBindable } from '@admin/shared/DataBindingPicker/bindingCompatibility'
import { VisitorPreferencePatchSchema } from '@core/visitor-preferences-schema'
import { compiledCheck } from '@core/utils/typeboxCompiler'
import { PreferenceToggleModule, PreferenceOutputModule } from '@modules/base/preference'
import { useEditorStore } from '@site/store/store'
import { DEFAULT_SITE_VISITOR_PREFERENCES } from '@core/visitor-preferences-schema'
import { makeSite } from '../publisher/helpers'

const control = { type: 'preferenceValues', label: 'Active preferences' } as const

describe('native preference property control', () => {
  it('edits a structured partial patch and preserves excluded preferences', () => {
    const changes = mock((_key: string, _value: unknown) => {})
    function Harness() {
      const [value, setValue] = useState<unknown>({ theme: 'alt' })
      return <PropertyControlRenderer propKey="on" control={control} value={value} onChange={(key, next) => { changes(key, next); setValue(next) }} />
    }
    render(<Harness />)
    expect(screen.getAllByRole('combobox')).toHaveLength(3)
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.change(screen.getByLabelText('Active preferences: Motion'), { target: { value: 'Reduced' } })
    expect(changes).toHaveBeenLastCalledWith('on', { theme: 'alt', motion: 'reduced' })
    fireEvent.change(screen.getByLabelText('Active preferences: Appearance'), { target: { value: 'Not included' } })
    expect(changes).toHaveBeenLastCalledWith('on', { motion: 'reduced' })
    fireEvent.change(screen.getByLabelText('Active preferences: Motion'), { target: { value: 'Not included' } })
    expect(changes).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('alert').textContent).toContain('at least one preference')
    for (const [, patch] of changes.mock.calls) {
      expect(typeof patch).toBe('object')
      expect(compiledCheck(VisitorPreferencePatchSchema, patch)).toBe(true)
    }
  })

  it('reports invalid stored data and replaces it only after an explicit selection', () => {
    const change = mock((_key: string, _value: unknown) => {})
    render(<PropertyControlRenderer propKey="when" control={control} value={{ theme: 'invalid', unexpected: true }} onChange={change} />)
    expect(screen.getByRole('alert').textContent).toContain('replace its invalid values')
    expect(change).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Active preferences: Decorative media'), { target: { value: 'Full' } })
    expect(change).toHaveBeenCalledWith('when', { media: 'full' })
  })

  it('uses the standard structural-permission gate and refuses scalar bindings', () => {
    const change = mock((_key: string, _value: unknown) => {})
    render(<EditorPermissionsContext value={{ canEditContent: true, canEditStructure: false, canEditStyle: false }}>
      <PropertyControlRenderer propKey="on" control={control} value={{ theme: 'alt' }} onChange={change} />
    </EditorPermissionsContext>)
    const selects = screen.getAllByRole('combobox')
    expect(selects.every(select => select.hasAttribute('disabled'))).toBe(true)
    fireEvent.change(selects[0], { target: { value: 'System' } })
    expect(change).not.toHaveBeenCalled()
    expect(paramTypesCompatibleWithControl(control)).toEqual([])
    expect(getDynamicBindingMode(control)).toBeNull()
    expect(isFieldBindable('preferenceValues', { id: 'copy', label: 'Copy', type: 'text' })).toBe(false)
  })

  it('exposes on, off and when through visible native controls', () => {
    expect(PreferenceToggleModule.schema.on).toEqual({ type: 'preferenceValues', label: 'Active preferences' })
    expect(PreferenceToggleModule.schema.off).toEqual({ type: 'preferenceValues', label: 'Inactive preferences' })
    expect(PreferenceOutputModule.schema.when).toEqual({ type: 'preferenceValues', label: 'Matching preferences' })
  })

  it('keeps temporarily mismatched or equal profiles editable without throwing in the canvas', () => {
    useEditorStore.setState({ site: makeSite({ settings: { visitorPreferences: DEFAULT_SITE_VISITOR_PREFERENCES, shortcuts: {} } }) })
    const Component = PreferenceToggleModule.component
    const props = { ...PreferenceToggleModule.defaults, on: { theme: 'alt', media: 'reduced' } as const, off: { theme: 'default' } as const }
    const canvas = render(<Component props={props} nodeId="profile" isSelected={false} />)
    expect(screen.getByText(/matching preference names and different authored profiles/)).not.toBeNull()
    canvas.rerender(<Component props={{ ...props, off: props.on }} nodeId="profile" isSelected={false} />)
    expect(screen.getByText(/matching preference names and different authored profiles/)).not.toBeNull()
    canvas.rerender(<Component props={{ ...props, off: { theme: 'default', media: 'full' }, titleOff: 'Configure preferences' }} nodeId="profile" isSelected={false}><i>Child icon</i></Component>)
    expect(screen.queryByText(/matching preference names and different authored profiles/)).toBeNull()
    const button = screen.getByRole('button')
    expect(button.title).toBe('Configure preferences')
    expect(button.querySelector('i')?.textContent).toBe('Child icon')
    expect(button.getAttribute('data-instatic-preference-on')).toBe('{"theme":"alt","media":"reduced"}')
  })
})
