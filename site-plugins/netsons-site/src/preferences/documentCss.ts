const reducedMotion = 'animation-duration:0.01ms!important;animation-iteration-count:1!important;transition-duration:0.01ms!important;scroll-behavior:auto!important'
const configured = 'html[data-instatic-visitor-preferences]'

/** Static styles shared by the preference runtime and native document preferences. */
export const VISITOR_PREFERENCES_DOCUMENT_CSS = [
  ':root:not(.theme-alt){color-scheme:light}',
  ':root.theme-alt{color-scheme:dark}',
  ':where([data-instatic-preference-announcer]){position:fixed;top:0;left:0;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}',
  ':where(' + configured + '[data-instatic-motion="reduced"],' + configured + '[data-instatic-motion="reduced"] *){' + reducedMotion + '}',
  '@media(prefers-reduced-motion:reduce){:where(' + configured + ',' + configured + ' *){' + reducedMotion + '}}',
].join('\n')
