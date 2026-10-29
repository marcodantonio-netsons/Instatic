import { afterEach, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ExpressionsControl } from '@site/property-controls/ExpressionsControl'
import { paramTypesCompatibleWithControl } from '@site/property-controls/paramTypeCompat'
afterEach(cleanup)
it('edits closed expression data and refuses executable or malformed authoring', () => {
  const change = mock(() => {})
  render(<ExpressionsControl propKey="calculations" label="Values" value={{ total: { literal: 1 } }} onChange={change} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit derived values' }))
  fireEvent.change(screen.getByLabelText('Derived value expressions'), { target: { value: '{"total":"window.alert(1)"}' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply expressions' }))
  expect(screen.getByRole('alert').textContent).toContain('not accepted')
  expect(change).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Derived value expressions'), { target: { value: '{"total":{"op":"multiply","args":[{"field":"quantity"},{"literal":4}]}}' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply expressions' }))
  expect(change).toHaveBeenCalledWith('calculations', { total: { op: 'multiply', args: [{ field: 'quantity' }, { literal: 4 }] } })
  fireEvent.click(screen.getByRole('button', { name: 'Edit derived values' }))
  fireEvent.change(screen.getByLabelText('Derived value expressions'), { target: { value: '{"caption":{"op":"replace","value":{"literal":"Cost: [amount]"},"search":{"literal":"[amount]"},"replacement":{"field":"amount"}}}' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply expressions' }))
  expect(change).toHaveBeenLastCalledWith('calculations', { caption: { op: 'replace', value: { literal: 'Cost: [amount]' }, search: { literal: '[amount]' }, replacement: { field: 'amount' } } })
  expect(paramTypesCompatibleWithControl({ type: 'expressions', label: 'Values' })).toEqual([])
})
