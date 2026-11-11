const controlWiring = ['name', 'id', 'required', 'disabled', 'form', 'formaction', 'formmethod', 'formenctype', 'formnovalidate']
const choiceAttributes = [...controlWiring, 'type', 'value', 'checked']

/** Names owned by native module props, shared by HTML import, render and authoring. */
export const MODULE_GENERATED_ATTRIBUTE_NAMES: Readonly<Record<string, readonly string[]>> = {
  'base.preference': ['data-instatic-preference-origin'],
  'base.preference-toggle': ['data-instatic-preference-origin', 'type', 'disabled', 'aria-pressed', 'aria-label', 'title', 'data-instatic-preference-active', 'data-instatic-preference-toggle', 'data-instatic-preference-on', 'data-instatic-preference-off', 'data-instatic-preference-label-on', 'data-instatic-preference-label-off', 'data-instatic-preference-aria-label-on', 'data-instatic-preference-aria-label-off', 'data-instatic-preference-title-on', 'data-instatic-preference-title-off', ...['default','saved','session','reset','unavailable','preview','invalid'].map(status => 'data-instatic-preference-status-' + status)],
  'base.preference-output': ['data-instatic-preference-output', 'data-instatic-preference-when', 'data-instatic-preference-text-on', 'data-instatic-preference-text-off', 'data-instatic-preference-active'],
  'base.scroll-state': ['data-instatic-scroll-state', 'data-instatic-scroll-target', 'data-instatic-scroll-edge', 'data-instatic-scroll-offset', 'data-instatic-scroll-motion'],
  'base.scroll-button': ['disabled', 'type', 'aria-controls'],
  'base.tab': ['type', 'role', 'aria-selected', 'tabindex', 'id', 'aria-controls'],
  'base.tab-panel': ['role', 'hidden', 'id', 'aria-labelledby'],
  'base.tab-link': ['href','target','rel'],
  'base.scroll-controls': ['hidden'],
  // Anchor modules merge authored rel tokens with their target security rel.
  // Keep rel in the authored bag rather than consuming it as a generated prop.
  'base.button': ['aria-disabled', 'disabled', 'href', 'target', 'type'],
  'base.loop-more': ['type', 'hidden', 'disabled'],
  'base.form': ['action', 'method'],
  'base.form-link': ['href', 'target', 'rel'],
  'base.form-step': ['type', 'disabled'],
  'base.form-output': ['style'],
  'base.form-message': ['role', 'hidden'],
  'base.submit': ['type', 'disabled', 'form', 'formaction', 'formmethod', 'formenctype', 'formnovalidate'],
  'base.input': [...controlWiring, 'type', 'value', 'placeholder', 'readonly', 'autocomplete', 'min', 'max', 'step', 'minlength', 'maxlength', 'pattern'],
  'base.textarea': [...controlWiring, 'value', 'placeholder', 'readonly', 'rows', 'minlength', 'maxlength'],
  'base.select': [...controlWiring, 'value', 'multiple'],
  'base.checkbox': choiceAttributes,
  'base.radio': choiceAttributes,
  'base.image': ['alt', 'decoding', 'fetchpriority', 'height', 'loading', 'sizes', 'src', 'srcset', 'style', 'width'],
  'base.link': ['href', 'target'],
  'base.video': ['allow', 'allowfullscreen', 'autoplay', 'controls', 'frameborder', 'height', 'loading', 'loop', 'muted', 'playsinline', 'poster', 'preload', 'src', 'title', 'width'],
}
