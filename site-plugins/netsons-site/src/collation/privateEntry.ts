import '@formatjs/intl-getcanonicallocales/polyfill-force.js'
import '@formatjs/intl-locale/polyfill-force.js'
import { Collator } from '@formatjs/intl-collator'

Object.defineProperty(globalThis, '__netsonsCollator', { value: Collator })
