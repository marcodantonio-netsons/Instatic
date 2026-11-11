import { formsModules } from './modules'

function numberFormatGlobalState(): string {
  return typeof Intl === 'undefined' ? 'missing' : typeof Intl.NumberFormat
}

const stateWhenLoaded = numberFormatGlobalState()

/** Test-only module that reports the QuickJS global before and after form renders. */
const intlProbe = {
  id: 'netsons.site.test-intl-probe',
  name: 'Intl test probe',
  description: 'Test only',
  category: 'Test',
  version: '1.0.0',
  defaults: {},
  schema: {},
  canHaveChildren: false,
  htmlTag: 'span',
  render() {
    return { html: `${stateWhenLoaded}|${numberFormatGlobalState()}` }
  },
}

export default [...formsModules, intlProbe]
