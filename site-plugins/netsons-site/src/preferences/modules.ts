import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { PluginModuleDefinition, PluginPropertyControl } from '@instatic/plugin-sdk'
import { htmlAttributesAttr } from '../shared/attributeEmitter'
import { escapeHtml, safeUrl } from '../shared/htmlSafety'
import { parseModuleProps, PreferenceHtmlAttributesSchema, VisitorPreferencePatchSchema, VisitorPreferenceThemeSchema, VisitorPreferenceMotionSchema, VisitorPreferenceMediaSchema } from '../shared/preferences/schema'
import { languageFromPath, localizeRenderProps } from '../localization'

const preferenceFeedback = {
  defaultStatus: Type.String({ default: '{i18n.visitorPreferences.statuses.default}' }),
  savedStatus: Type.String({ default: '{i18n.visitorPreferences.statuses.saved}' }),
  sessionStatus: Type.String({ default: '{i18n.visitorPreferences.statuses.session}' }),
  resetStatus: Type.String({ default: '{i18n.visitorPreferences.statuses.reset}' }),
  unavailableStatus: Type.String({ default: '{i18n.visitorPreferences.statuses.unavailable}' }),
  previewStatus: Type.String({ default: '{i18n.visitorPreferences.statuses.preview}' }),
  invalidStatus: Type.String({ default: '{i18n.visitorPreferences.statuses.invalid}' }),
}

const ProfileChoiceNone = Type.Literal('')
const ThemeChoice = Type.Union([ProfileChoiceNone, VisitorPreferenceThemeSchema])
const MotionChoice = Type.Union([ProfileChoiceNone, VisitorPreferenceMotionSchema])
const MediaChoice = Type.Union([ProfileChoiceNone, VisitorPreferenceMediaSchema])

const PreferenceTogglePropsSchema = Type.Object({
  onTheme: ThemeChoice,
  onMotion: MotionChoice,
  onMedia: MediaChoice,
  offTheme: ThemeChoice,
  offMotion: MotionChoice,
  offMedia: MediaChoice,
  labelOn: Type.String({ default: '{i18n.footer.states.tornaAllaModalitaStandard}' }),
  labelOff: Type.String({ default: '{i18n.footer.states.attivaLaModalitaGreen}' }),
  ariaLabelOn: Type.String({ default: '' }),
  ariaLabelOff: Type.String({ default: '' }),
  titleOn: Type.String({ default: '' }),
  titleOff: Type.String({ default: '' }),
  ...preferenceFeedback,
  htmlAttributes: PreferenceHtmlAttributesSchema,
}, { additionalProperties: false })
type PreferenceToggleProps = Static<typeof PreferenceTogglePropsSchema>

const PreferenceOutputPropsSchema = Type.Object({
  tag: Type.Union(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'small', 'strong', 'em'].map(value => Type.Literal(value)), { default: 'strong' }),
  whenTheme: ThemeChoice,
  whenMotion: MotionChoice,
  whenMedia: MediaChoice,
  textOn: Type.String({ default: '{i18n.footer.states.gradoA}' }),
  textOff: Type.String({ default: '{i18n.footer.labels.profiloStandard}' }),
  htmlAttributes: PreferenceHtmlAttributesSchema,
}, { additionalProperties: false })
type PreferenceOutputProps = Static<typeof PreferenceOutputPropsSchema>

function renderProps<T extends import('@sinclair/typebox').TSchema>(schema: T, rawProps: unknown, urlKeys: readonly string[] = []): Static<T> {
  if (!rawProps || typeof rawProps !== 'object' || Array.isArray(rawProps)) throw Error('Invalid preference module properties')
  const context = Object.fromEntries(Object.entries(rawProps))
  const path = typeof context.routePath === 'string' ? context.routePath : '/'
  const authored = Object.fromEntries(Object.entries(context).filter(([key]) => key !== 'routePath'))
  const defaulted = Value.Default(schema, authored)
  if (!Value.Check(schema, defaulted)) throw Error('Invalid preference module properties')
  const localized = localizeRenderProps(defaulted as Record<string, unknown>, languageFromPath(path), urlKeys)
  return parseModuleProps(schema, localized)
}

function profilePatch(theme: string, motion: string, media: string) {
  return parseModuleProps(VisitorPreferencePatchSchema, {
    ...(theme ? { theme } : {}),
    ...(motion ? { motion } : {}),
    ...(media ? { media } : {}),
  })
}

function profileMatchesShape(on: Record<string, unknown>, off: Record<string, unknown>): boolean {
  const keys = Object.keys(on)
  return keys.length > 0
    && keys.length === Object.keys(off).length
    && keys.every(key => Object.hasOwn(off, key))
    && keys.some(key => Reflect.get(on, key) !== Reflect.get(off, key))
}

const profileJsonNames = new Set(['data-instatic-preference-on', 'data-instatic-preference-off', 'data-instatic-preference-when'])

function preferenceDataAttributes(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([name, value]) => ` ${name}="${profileJsonNames.has(name) ? escapeHtml(value) : value}"`)
    .join('')
}

const preferenceToggleControls: Record<string, PluginPropertyControl> = {
  onTheme: { type: 'select', label: 'When active: appearance', options: [{ label: 'Not changed', value: '' }, { label: 'System', value: 'system' }, { label: 'Default', value: 'default' }, { label: 'Alternate', value: 'alt' }] },
  onMotion: { type: 'select', label: 'When active: motion', options: [{ label: 'Not changed', value: '' }, { label: 'System', value: 'system' }, { label: 'Reduced', value: 'reduced' }] },
  onMedia: { type: 'select', label: 'When active: decorative media', options: [{ label: 'Not changed', value: '' }, { label: 'Full', value: 'full' }, { label: 'Reduced', value: 'reduced' }] },
  offTheme: { type: 'select', label: 'When inactive: appearance', options: [{ label: 'Not changed', value: '' }, { label: 'System', value: 'system' }, { label: 'Default', value: 'default' }, { label: 'Alternate', value: 'alt' }] },
  offMotion: { type: 'select', label: 'When inactive: motion', options: [{ label: 'Not changed', value: '' }, { label: 'System', value: 'system' }, { label: 'Reduced', value: 'reduced' }] },
  offMedia: { type: 'select', label: 'When inactive: decorative media', options: [{ label: 'Not changed', value: '' }, { label: 'Full', value: 'full' }, { label: 'Reduced', value: 'reduced' }] },
  labelOn: { type: 'text', label: 'Active text' },
  labelOff: { type: 'text', label: 'Inactive text' },
  ariaLabelOn: { type: 'text', label: 'Active accessible label' },
  ariaLabelOff: { type: 'text', label: 'Inactive accessible label' },
  titleOn: { type: 'text', label: 'Active title' },
  titleOff: { type: 'text', label: 'Inactive title' },
  defaultStatus: { type: 'text', label: 'Default status' },
  savedStatus: { type: 'text', label: 'Saved status' },
  sessionStatus: { type: 'text', label: 'Unsaved change status' },
  resetStatus: { type: 'text', label: 'Invalid saved state status' },
  unavailableStatus: { type: 'text', label: 'Storage unavailable status' },
  previewStatus: { type: 'text', label: 'Preview status' },
  invalidStatus: { type: 'text', label: 'Invalid choice status' },
}

export const PreferenceToggleModule: PluginModuleDefinition = {
  id: 'netsons.site.preference-toggle',
  name: 'Preference toggle',
  description: 'Switch an authored group of visitor preferences.',
  category: 'Netsons',
  version: '1.0.0',
  canHaveChildren: true,
  htmlTag: 'button',
  defaults: {
    ...Value.Create(PreferenceTogglePropsSchema),
    routePath: '{route.path}',
    onTheme: 'alt', onMotion: 'reduced', onMedia: 'reduced',
    offTheme: 'default', offMotion: 'system', offMedia: 'full',
  },
  schema: preferenceToggleControls,
  render(rawProps, children) {
    const props: PreferenceToggleProps = renderProps(PreferenceTogglePropsSchema, rawProps)
    if ((!props.labelOn.trim() && !props.ariaLabelOn.trim()) || (!props.labelOff.trim() && !props.ariaLabelOff.trim())) {
      throw Error('Preference toggle needs visible or accessible text for both states')
    }
    const on = profilePatch(props.onTheme, props.onMotion, props.onMedia)
    const off = profilePatch(props.offTheme, props.offMotion, props.offMedia)
    if (!profileMatchesShape(on, off)) throw Error('Preference toggle profiles require the same preferences and must differ')
    const data: Record<string, string> = {
      'data-instatic-preference-toggle': '',
      'data-instatic-preference-origin': 'false',
      'data-instatic-preference-on': JSON.stringify(on),
      'data-instatic-preference-off': JSON.stringify(off),
      'data-instatic-preference-label-on': props.labelOn,
      'data-instatic-preference-label-off': props.labelOff,
      'data-instatic-preference-aria-label-on': props.ariaLabelOn,
      'data-instatic-preference-aria-label-off': props.ariaLabelOff,
      'data-instatic-preference-title-on': props.titleOn,
      'data-instatic-preference-title-off': props.titleOff,
      'data-instatic-preference-status-default': props.defaultStatus,
      'data-instatic-preference-status-saved': props.savedStatus,
      'data-instatic-preference-status-session': props.sessionStatus,
      'data-instatic-preference-status-reset': props.resetStatus,
      'data-instatic-preference-status-unavailable': props.unavailableStatus,
      'data-instatic-preference-status-preview': props.previewStatus,
      'data-instatic-preference-status-invalid': props.invalidStatus,
    }
    const htmlAttributes = htmlAttributesAttr(props.htmlAttributes, ['type', 'disabled', 'aria-pressed', 'aria-label', 'title'])
    const ariaLabel = props.ariaLabelOff ? ` aria-label="${props.ariaLabelOff}"` : ''
    const title = props.titleOff ? ` title="${props.titleOff}"` : ''
    return {
      html: `<button type="button" disabled aria-pressed="false"${ariaLabel}${title}${preferenceDataAttributes(data)}${htmlAttributes}>${props.labelOff}${children.join('')}</button>`,
    }
  },
}

const preferenceOutputControls: Record<string, PluginPropertyControl> = {
  tag: { type: 'select', label: 'HTML element', options: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'small', 'strong', 'em'].map(value => ({ label: value, value })) },
  whenTheme: { type: 'select', label: 'Matching appearance', options: [{ label: 'Not changed', value: '' }, { label: 'System', value: 'system' }, { label: 'Default', value: 'default' }, { label: 'Alternate', value: 'alt' }] },
  whenMotion: { type: 'select', label: 'Matching motion', options: [{ label: 'Not changed', value: '' }, { label: 'System', value: 'system' }, { label: 'Reduced', value: 'reduced' }] },
  whenMedia: { type: 'select', label: 'Matching decorative media', options: [{ label: 'Not changed', value: '' }, { label: 'Full', value: 'full' }, { label: 'Reduced', value: 'reduced' }] },
  textOn: { type: 'text', label: 'Matching text' },
  textOff: { type: 'text', label: 'Other text' },
}

export const PreferenceOutputModule: PluginModuleDefinition = {
  id: 'netsons.site.preference-output',
  name: 'Preference text',
  description: 'Display text for a matching visitor preference profile.',
  category: 'Netsons',
  version: '1.0.0',
  canHaveChildren: false,
  htmlTag: 'strong',
  defaults: { ...Value.Create(PreferenceOutputPropsSchema), routePath: '{route.path}', whenTheme: 'alt' },
  schema: preferenceOutputControls,
  render(rawProps) {
    const props: PreferenceOutputProps = renderProps(PreferenceOutputPropsSchema, rawProps)
    if (!props.textOn.trim() || !props.textOff.trim()) throw Error('Preference output needs both text values')
    const when = profilePatch(props.whenTheme, props.whenMotion, props.whenMedia)
    const htmlAttributes = htmlAttributesAttr(props.htmlAttributes, ['data-instatic-preference-active'])
    const data = {
      'data-instatic-preference-output': '',
      'data-instatic-preference-when': JSON.stringify(when),
      'data-instatic-preference-text-on': props.textOn,
      'data-instatic-preference-text-off': props.textOff,
    }
    return { html: `<${props.tag}${preferenceDataAttributes(data)}${htmlAttributes}>${props.textOff}</${props.tag}>` }
  },
}

const VideoPropsSchema = Type.Object({
  playbackRole: Type.Union([Type.Literal('content'), Type.Literal('decorative')], { default: 'content' }),
  videoUrl: Type.String({ default: '' }),
  poster: Type.String({ default: '' }),
  autoplay: Type.Boolean({ default: false }),
  loop: Type.Boolean({ default: false }),
  muted: Type.Boolean({ default: false }),
  controls: Type.Boolean({ default: true }),
  playsinline: Type.Boolean({ default: true }),
  preload: Type.Union([Type.Literal('none'), Type.Literal('metadata'), Type.Literal('auto')], { default: 'metadata' }),
  title: Type.String({ default: '' }),
  htmlAttributes: PreferenceHtmlAttributesSchema,
}, { additionalProperties: false })
type VideoProps = Static<typeof VideoPropsSchema>

const LOCAL_MEDIA_URL_PATTERN = /^\/(?!\/)[^\\\s]+$/
const VIDEO_GENERATED_ATTRIBUTES = ['autoplay', 'controls', 'loop', 'muted', 'playsinline', 'poster', 'preload', 'src', 'title', 'aria-hidden']

function videoRenderProps(rawProps: unknown): VideoProps {
  const props = renderProps(VideoPropsSchema, rawProps, ['videoUrl', 'poster'])
  if ((props.videoUrl && !LOCAL_MEDIA_URL_PATTERN.test(props.videoUrl)) || (props.poster && !LOCAL_MEDIA_URL_PATTERN.test(props.poster))) {
    throw Error('Video and poster sources must be local paths')
  }
  if (props.playbackRole === 'decorative' && (!props.videoUrl || !props.muted || props.controls || !props.playsinline)) {
    throw Error('Decorative video requires a local URL, muted inline playback, and no controls')
  }
  return props
}

export const VideoModule: PluginModuleDefinition = {
  id: 'netsons.site.video',
  name: 'Video',
  description: 'Embed a local video.',
  category: 'Netsons',
  version: '1.0.0',
  canHaveChildren: false,
  htmlTag: 'video',
  defaults: { ...Value.Create(VideoPropsSchema), routePath: '{route.path}' },
  schema: {
    playbackRole: { type: 'select', label: 'Playback role', options: [{ label: 'Visitor-controlled content', value: 'content' }, { label: 'Decorative media', value: 'decorative' }] },
    videoUrl: { type: 'url', label: 'Local video URL', description: 'Use a path on this site.' },
    poster: { type: 'image', label: 'Local poster image', description: 'Use an image stored on this site.' },
    autoplay: { type: 'toggle', label: 'Autoplay' },
    loop: { type: 'toggle', label: 'Loop' },
    muted: { type: 'toggle', label: 'Muted' },
    controls: { type: 'toggle', label: 'Show controls' },
    playsinline: { type: 'toggle', label: 'Play inline (mobile)' },
    preload: { type: 'select', label: 'Preload', options: [{ label: 'None', value: 'none' }, { label: 'Metadata', value: 'metadata' }, { label: 'Auto', value: 'auto' }] },
    title: { type: 'text', label: 'Video title' },
  },
  render(rawProps) {
    const props = videoRenderProps(rawProps)
    const htmlAttributes = htmlAttributesAttr(props.htmlAttributes, VIDEO_GENERATED_ATTRIBUTES)
    const titleAttr = props.title ? ` title="${props.title}"` : ''
    const videoSrc = props.videoUrl ? safeUrl(props.videoUrl) : ''
    if (!videoSrc) return { html: `<video${titleAttr}${htmlAttributes}></video>` }
    const poster = props.poster ? safeUrl(props.poster) : ''
    const preload = props.preload === 'none' || props.preload === 'auto' ? props.preload : 'metadata'
    const attrs: string[] = props.playbackRole === 'decorative'
      ? [`data-instatic-decorative-src="${videoSrc}"`, `data-instatic-decorative-preload="${preload}"`, `data-instatic-decorative-autoplay="${String(props.autoplay)}"`, 'data-instatic-decorative-ready="false"', 'aria-hidden="true"', 'preload="none"']
      : [`src="${videoSrc}"`, `preload="${preload}"`]
    if (poster) attrs.push(`poster="${poster}"`)
    if (props.playsinline) attrs.push('playsinline')
    if (props.autoplay && props.playbackRole !== 'decorative') attrs.push('autoplay')
    if (props.loop) attrs.push('loop')
    if (props.muted) attrs.push('muted')
    if (props.controls && props.playbackRole !== 'decorative') attrs.push('controls')
    return { html: `<video ${attrs.join(' ')}${titleAttr}${htmlAttributes}></video>` }
  },
}

const preferenceModules: PluginModuleDefinition[] = [PreferenceToggleModule, PreferenceOutputModule, VideoModule]
export default preferenceModules
