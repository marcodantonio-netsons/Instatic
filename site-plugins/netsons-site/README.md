# Netsons Site

Site-owned components and runtime behavior packaged through Instatic's supported plugin API. The package registers shared modules, a request-dependent catalogue source, a read-only count endpoint, publish filters and static frontend assets. It does not patch the CMS engine.

## Build and installation

With the host repository dependencies installed, run `bun install --frozen-lockfile`, `bun run build`, `bun run typecheck` and `bun test` from this directory. Build runs first because it generates the private language and Intl bundles. The reproducible package is `dist/netsons-site.plugin.zip`; generated assets and dependencies are excluded from Git. Install it through Instatic's Plugins workspace. CMS content is transferred separately through the native site-transfer format.

The host API transport must preserve `null` separately from `undefined`. The accompanying correction in `server/plugins/quickjs/marshal.ts` fixes that general transport defect; its regression test covers nullable content fields, nested values and missing results. The archived official-host verification includes this correction.

## Sources of truth

- Products, domain extensions, prices and comparison matrices remain in the CMS data tables. The plugin reads those tables; it does not contain a price list.
- `locales/*.json` owns translated copy. Generated language bundles are build outputs.
- `src/catalogueQuery/query-configs.json` owns query configuration: table slugs, field names and bindings. It contains no product prices. Every consuming loop stores only its configuration ID.
- Existing CMS visual components and shared classes retain the page structure and styling.

## Runtime boundaries

- `src/modules.ts` is the shared module pack. Published renderers emit HTML; `preview` escapes raw editor inputs.
- `src/server.ts` registers supported CMS hooks, loop source and public count route. Content access is read-only and restricted to the four public catalogue tables listed in its manifest.
- Form, interaction, visitor-preference and loop-control frontend scripts are shared assets. Published pages receive no React runtime.
- The appearance control uses the native `theme-alt` palette convention. Motion and decorative-media preferences retain their independent settings.
- Query results and pagination use Instatic's native hole endpoint and renderer. The count endpoint and loop source share the same filtering logic.
- Weighted knowledge search uses a private FormatJS CLDR collator in QuickJS. Search membership, scores, counts and tested pages match the native loop. In the sealed knowledge-search checks, two apostrophe-containing title ties sort differently from the local Bun ICU build: Italian item 68 and French item 14. This changes tie order only; both rows remain in the results.

## Editor and delivery limits

The official plugin canvas renders child modules beside the plugin's own markup. Its preview is therefore simplified, as agreed, while the published renderer retains the authored markup. Structured form expressions are preserved; the plugin property panel does not provide Instatic's fork-only expression editors.

Contact forms retain their existing destination. External delivery, CORS and Turnstile domain authorization belong to that destination and its Cloudflare configuration; local smoke tests must not send real enquiries.
