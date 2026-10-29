import { escapeHtml } from '@core/publisher'
import { VisitorPreferencesValidationError } from '@core/visitor-preferences-schema'
import { preferenceCaptions } from './props'
import type { PreferenceToggleProps, PreferenceOutputProps } from './profileProps'

export function toggleProfilesAreValid(props: PreferenceToggleProps): boolean {
  const keys = Object.keys(props.on)
  return keys.length === Object.keys(props.off).length && keys.every(key => Object.hasOwn(props.off, key)) && keys.some(key => Reflect.get(props.on, key) !== Reflect.get(props.off, key))
}

export function assertToggleProfiles(props: PreferenceToggleProps) {
  if (!toggleProfilesAreValid(props)) throw new VisitorPreferencesValidationError('props.on/off')
}

export function preferenceToggleData(props: PreferenceToggleProps) {
  assertToggleProfiles(props)
  return {
    'data-instatic-preference-toggle': '',
    'data-instatic-preference-origin': 'false',
    'data-instatic-preference-on': JSON.stringify(props.on),
    'data-instatic-preference-off': JSON.stringify(props.off),
    'data-instatic-preference-label-on': props.labelOn,
    'data-instatic-preference-label-off': props.labelOff,
    'data-instatic-preference-aria-label-on': props.ariaLabelOn,
    'data-instatic-preference-aria-label-off': props.ariaLabelOff,
    'data-instatic-preference-title-on': props.titleOn,
    'data-instatic-preference-title-off': props.titleOff,
    ...Object.fromEntries(Object.entries(preferenceCaptions(props)).map(([status, caption]) => ['data-instatic-preference-status-' + status, caption])),
  }
}

export function preferenceOutputData(props: PreferenceOutputProps) {
  return {
    'data-instatic-preference-output': '',
    'data-instatic-preference-when': JSON.stringify(props.when),
    'data-instatic-preference-text-on': props.textOn,
    'data-instatic-preference-text-off': props.textOff,
  }
}

/** String props crossed escapeProps already; structured enum patches did not. */
export function profileDataAttributes(data: Record<string, string>) {
  const structured = new Set(['data-instatic-preference-on','data-instatic-preference-off','data-instatic-preference-when'])
  return Object.entries(data).map(([name, value]) => ` ${name}="${structured.has(name) ? escapeHtml(value) : value}"`).join('')
}
