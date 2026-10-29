# Modules

Modules are the building blocks the visual editor places on the canvas — `base.container`, `base.text`, `base.image`, `base.button`, `base.loop`, `base.visual-component-ref`, plugin-shipped modules, etc. Each module is a single `ModuleDefinition` registered in the global `ModuleRegistry`.

A module declares:
- A unique `id` (namespaced: `base.text`, `acme.product-card`)
- A `PropertySchema` describing its props (drives the right-panel form)
- A pure `render(props, renderedChildren)` function that returns `{ html, assetUsage?, cspSources? }`
- An optional canvas `component` (React) for in-editor preview
- Required metadata: `name`, `category`, `icon`, `version`, `trusted`, `canHaveChildren`, `defaults`

---

## TL;DR

- Definition shape: `ModuleDefinition<TProps>` in `src/core/module-engine/types.ts`.
- Property control schema: `PropertyControl` (text / textarea / number / boolean / select / color / image / link / spacing / variable / etc.) in `propertySchema.ts`.
- Registry: `registry` singleton in `src/core/module-engine/registry.ts`. First-party modules self-register from `src/modules/base/index.ts` at app boot.
- Plugin modules register via `defineModule` from the SDK and the plugin's `modules` entrypoint.
- The publisher walks the page tree and calls `module.render()` per node — see [docs/features/publisher.md](publisher.md).
- The editor canvas may render via the React `component` if provided; otherwise it uses the same `render()` HTML inside a sandboxed iframe.

---

## Where the code lives

```text
src/core/module-engine/
├── types.ts             — ModuleDefinition, RenderOutput, ModuleComponentProps, ModuleDependencies
├── registry.ts          — ModuleRegistry singleton (`registry`)
├── propertySchema.ts    — PropertyControl discriminated union, PropertySchemaSchema
├── dependencies.ts      — module dependency normalization + checks
├── runtimeResolver.ts   — bare-specifier → runtime URL mapping for ESM modules
├── htmlTagBadge.ts      — resolveHtmlTagBadge (shared dispatch for htmlTag field)
└── parseModuleProps.ts — prop coercion + per-property repair against propsSchema

src/modules/base/
├── body/                — base.body (root container)
├── container/           — base.container (flex/grid container)
├── text/                — base.text (tags.ts — tag coercion leaf; tag:'none' emits no wrapper)
├── outlet/              — base.outlet (Content Outlet — template content slot)
├── button/              — base.button (anchor.ts — element-decision leaf)
├── link/                — base.link (content.ts — children/text fallback leaf)
├── disclosure/          — base.disclosure (native details/summary + shared dismissal behavior)
├── image/               — base.image
├── svg/                 — base.svg (inline sanitized SVG)
├── video/               — base.video (youtube.ts — ID parse + embed URL leaf)
├── list/                — base.list (items.ts — textarea item-splitting leaf)
├── loop/                — base.loop
├── forms/               — base.form and form-control primitives (content.ts: submit children/label rule)
├── visualComponentRef/  — base.visual-component-ref
├── slotOutlet/          — base.slot-outlet (VC author side)
├── slotInstance/        — base.slot-instance (VC consumer side)
├── shared/
│   └── anchorTarget.ts  — ANCHOR_TARGET_OPTIONS, anchorRel(), mergeAnchorRel(), anchorHtmlAttributes() (button + link; schema in @core/htmlAttributes)
├── utils/
│   ├── escape.ts        — escapeHtml, safeUrl, sanitiseCssValue, buildStyle (re-exports publisher utils)
│   ├── htmlTag.ts       — htmlTagControl, customHtmlTagControl (resolution lives in @core/htmlAttributes)
│   └── mediaAttrs.ts    — buildMediaSrcset, pickMediaVariantUrl
└── index.ts             — side-effect imports; each module self-registers on load
```

---

## Video titles and HTML attributes

`base.video.title` is an optional authored title on the native `<video>` or YouTube `<iframe>`. Its default is empty; the renderer never invents a source-specific title. The title supports the normal bindings and language catalogue tokens. An empty title omits the attribute.

The normal HTML attributes panel supports safe attributes such as `aria-label`, `aria-describedby`, `id` and `data-*`. Publication and canvas use the shared HTML attribute sanitiser. These attributes belong to the player, including the iframe inside a YouTube poster facade. HTML import preserves `title` in its native prop and keeps `aria-label` in the attributes bag independently.

The generated-name catalogue reserves the source, poster, dimensions, playback flags, preload and iframe loading/permission attributes for Module settings. Decorative video still forces `aria-hidden="true"` and leaves source loading and autoplay to the visitor preference owner; custom attributes cannot override that policy.

---

## The `ModuleDefinition` shape

```ts
interface ModuleDefinition<TProps extends Record<string, unknown>> {
  /** Namespaced id — 'base.text', 'acme.product-card'. URL-safe lowercase. */
  id: string

  /** Display name in the module picker. */
  name: string

  /** One-line description (shown in the picker). */
  description?: string

  /** Category for grouping in the picker ('Layout', 'Typography', 'Forms', ...). */
  category: string

  /** Icon component from pixel-art-icons (deep-imported, tree-shakeable). */
  icon: IconComponent

  /** Semver version string, e.g. "1.0.0". */
  version: string

  /** true = trusted first-party module; false = sandboxed plugin module. */
  trusted: boolean

  /** Whether this module accepts children. */
  canHaveChildren: boolean

  /**
   * How the publisher dispatches this node. Makes the two-tier render contract
   * explicit on the definition:
   *   'standard'    — (default, omit) normal bottom-up walk via renderStandardNode
   *   'special'     — publisher replaces the walk with a keyed specialised renderer
   *                   (base.loop, base.visual-component-ref). Must have a matching
   *                   entry in SPECIAL_RENDERER_IMPLS or the publisher throws.
   *   'transparent' — node contributes nothing on its own; render() MUST return
   *                   empty HTML (validated at registration). Used by base.slot-*.
   */
  publishBehavior?: 'standard' | 'special' | 'transparent'

  /**
   * When true, this node's render output varies per visitor request.
   * Layer A/C auto-wraps it in an `<instatic-hole>` placeholder and defers
   * rendering to request time. No first-party module sets this yet — it is
   * infrastructure for plugin modules that hit live APIs.
   */
  dynamic?: boolean

  /**
   * Optional static fallback rendered into the <instatic-hole> placeholder at
   * publish time (sanitised via DOMPurify). Non-JS visitors see it as a
   * meaningful skeleton; JS visitors see it briefly until the hole runtime fires.
   * Only relevant when dynamic: true or the node is otherwise classified as dynamic.
   */
  staticPlaceholder?: (props: TProps) => string

  /** Default prop values — derive from propsSchema via Value.Create(propsSchema). */
  defaults: TProps

  /** Property schema — drives the right-panel Properties UI. */
  schema: PropertySchema

  /**
   * Optional TypeBox schema for props. When present the publisher coerces and
   * default-fills props. The schema is the source of truth; derive `defaults`
   * from it via Value.Create(propsSchema).
   */
  propsSchema?: TSchema

  /** Optional: external npm dependencies this module needs at runtime. */
  dependencies?: ModuleDependencies

  /** React component for the editor canvas live preview. */
  component: React.ComponentType<ModuleComponentProps<TProps>>

  /**
   * Optional dependency-backed editor runtime. When present, the canvas renders
   * this module in a sandboxed iframe with an import map built from the module's
   * site dependencies, so packages like `three` don't become builder deps.
   */
  editorRuntime?: ModuleEditorRuntime

  /**
   * Pure render function — called by the publisher and the canvas.
   * props: already HTML-escaped + dynamic-prop-resolved.
   * renderedChildren: already-rendered child HTML strings (join them: renderedChildren.join('')).
   */
  render: (props: TProps, renderedChildren: string[]) => RenderOutput

  /** Display-only HTML tag hint for the DOM panel badge. Not consumed by the publisher. */
  htmlTag?: string | ((props: TProps) => string | null)
}
```

Constraint #179: **`render()` is pure** — no DOM, no React, no side effects. Inputs in, strings out.

Declare invariant CSS and vanilla-JS in `ModuleDefinition.assets`. `render()` returns HTML, optional boolean `assetUsage` and instance-specific CSP requirements; it never returns asset payloads. The actual render may disable a payload, for example a native HTML form with enhancement disabled. Published JS is served at `/_instatic/module-js/<moduleId>.js`. Author it as a self-contained, idempotent IIFE with document-level event delegation and no framework runtime. The editor reads declared CSS and never executes published module JS. See `src/core/module-engine/moduleAssets.ts` for the shared TypeBox schemas.

---

## Native disclosures

`base.disclosure` emits a semantic `<details>` around its authored child nodes.
Author its first child as `base.container` with `tag: 'custom'` and
`customTag: 'summary'`. Its text, icons and images are ordinary nested nodes;
they use the same classes, attributes, language-file bindings and editing as
the rest of the document. The summary itself can have its own classes and
attributes. The module generates no implicit summary or label and adds no
default visual CSS, ARIA menu roles, focus trap, or arrow-key navigation.

`initiallyOpen` controls authored initial state. A nonempty `group` maps to the
native HTML `name` attribute, so one related disclosure is open at a time. Keep
members together and do not nest members of the same group. Only one member of
a group should be initially open.

`closeOnEscape` defaults to true; outside-click/tap and focus-leave dismissal
default to false and are opt-in for navigation disclosures. Escape closes the
innermost open disclosure and focuses its summary. Outside dismissal does not
prevent the pointer's default action; closing restores focus only when it would
remain in concealed content. Focus-leave dismissal preserves the new external
focus. Native/scripted closing also moves any concealed focus back to summary.

`disclosure/behavior.ts` owns one typed, self-contained document installer. The
canvas leases that installer per mounted component; published pages receive its
compiled function body via the existing external module-JS channel. Delegation
handles dynamically inserted holes and installation is idempotent. Browser
native summary activation and group exclusivity work without the enhancement.

## Property schema

The schema drives the right-panel Properties UI. Each prop key maps to a `PropertyControl` describing how to edit it.

```ts
schema: PropertySchema = {
  text:  { type: 'text',  label: 'Text' },
  color: { type: 'color', label: 'Color' },
  size:  { type: 'select',   label: 'Size', options: [
            { value: 'sm', label: 'Small' },
            { value: 'md', label: 'Medium' },
            { value: 'lg', label: 'Large' },
          ]},
  alignment: { type: 'select', label: 'Align',
               options: ['left', 'center', 'right'].map(v => ({ value: v, label: v })),
               layout: 'inline' },
}
```

### Control types

| `type`      | Renders as                                                | Cell value                      |
|-------------|-----------------------------------------------------------|---------------------------------|
| `text`      | `<Input>`                                                 | `string`                        |
| `textarea`  | `<Textarea>`                                              | `string`                        |
| `richtext`  | No visible site-editor control; hidden/internal sanitized HTML prop | HTML string                     |
| `number`    | `<Input type="number">`                                   | `number`                        |
| `toggle`    | `<Switch>`                                                | `boolean`                       |
| `select`    | `<Select>` (short list) or `<ContextMenu>` (long)         | option value string             |
| `color`     | `<ColorInput>`                                            | `string` (hex / token name)     |
| `url`       | URL text input (validated)                                | `string`                        |
| `dataTable` | Data table picker                                         | table id string                 |
| `image`     | Media picker                                              | media id or URL                 |
| `media`     | Media picker (any media type)                             | media id                        |
| `svg`       | Inline SVG editor                                         | SVG markup string               |
| `condition` | Structured recursive value rule editor | `PropertyCondition` or `null` |
| `group`     | Collapsible section header (visual grouping only)         | — (no data shape change)        |

`PropertyControl` is a discriminated union — `propertySchema.ts` has the full schema.

### Conditional controls

A control can declare `condition` to hide itself unless another prop has a specific value:

```ts
schema: {
  hasIcon: { type: 'toggle', label: 'Show icon' },
  iconName: {
    type: 'select',
    label: 'Icon',
    options: [...],
    condition: { field: 'hasIcon', eq: true },
  },
}
```

### Layout

`layout: 'inline'` puts the control on the same row as its label (good for short options). `layout: 'block'` (default) stacks it.

### Categories

`category: 'spacing' | 'typography' | 'background' | 'border' | 'effects' | 'meta' | 'content' | ...` groups controls in the Properties panel under collapsible sections.

---

## The registry

`src/core/module-engine/registry.ts` exports a singleton:

```ts
import { registry } from '@core/module-engine'

registry.registerOrReplace(MyModuleDefinition) // first-party: always overwrite on hot reload
registry.register(MyModuleDefinition)          // throws if already registered
registry.get('base.text')                      // → AnyModuleDefinition | undefined
registry.getOrThrow('base.text')               // → AnyModuleDefinition (throws on miss)
registry.has('base.text')                      // → boolean
registry.list()                                // → AnyModuleDefinition[]
registry.listByCategory()                      // → Record<string, AnyModuleDefinition[]>
registry.subscribe(listener)                   // notified on register/unregister
registry.generation()                          // monotonic counter — pair with useSyncExternalStore
```

The registry is type-erased — every module is held as `AnyModuleDefinition` (props typed as `Record<string, unknown>`). The narrow → erased cast happens once at the registry boundary so user code never needs to widen its types.

`register()` throws if the id is already taken (duplicate module guard). `registerOrReplace()` silently overwrites — used by every first-party module because each module's `index.ts` self-registers at import time and hot module reload will re-run the import.

### Boot-time registration

`src/modules/base/index.ts` triggers registration for every first-party module. It's imported once
inside `AdminEntry.tsx` (the lazy admin chunk) so the base modules stay out of the eager entry bundle.
The server's public renderer imports it too via `server/publish/publicRenderer.ts`.

Each module's `index.ts` calls `registry.registerOrReplace(XModule)` at the bottom — so importing
the file is the registration. `base/index.ts` uses side-effect imports:

```ts
// src/modules/base/index.ts
import './container'   // ContainerModule self-registers on load
import './text'        // TextModule self-registers on load
// ...
```

### Plugin module registration

Plugin modules are authored with `defineModule(...)` and bundled into `modules/index.js`. The browser editor loads that bundle as ESM through the plugin host bridge. The server publisher loads the same bundle through `server/plugins/modulePackVm.ts`, which rewrites the ESM default export into a QuickJS global before evaluating it in a separate VM.

A plugin canvas module is rendered inside the editor's sandboxed iframe just like a first-party module.

---

## Rendering modules

The publisher's per-node flow (see [docs/features/publisher.md](publisher.md)):

```text
For each node, with common preparation before standard/special dispatch:
  1. effectiveProps  = resolveProps(node, breakpoint, def.schema)   ← merge breakpoint overrides
  2. dynamicProps    = resolveDynamicProps(effectiveProps, ...)     ← template bindings
  3. resolvedProps   = resolvePageRefProps(dynamicProps, pages)     ← cms:page:<id> → /path
  4. validatedProps  = parseModuleProps(def, resolvedProps)         ← coerce + per-property repair
  5. renderedChildren = node.children.map(renderNode)              ← standard path; special renderers expand VC/loop children
  6. safeProps       = escapeProps(validatedProps, schema)          ← HTML-escape string props
  7. attachResolvedMediaByKey(safeProps, ...)                       ← prefetched media assets
  8. { html, css }  = def.render(safeProps, renderedChildren)
  9. cssMap.set(moduleId, sanitizeModuleCSS(css))                   ← dedup by moduleId
 10. html = injectNodeClassIds(html, node.classIds, site)           ← splice CSS classIds
 11. html = injectNodeInlineStyles(html, node.inlineStyles)         ← splice inline styles
```

A module's CSS is **collected and deduped by `moduleId`** — emitting the same CSS for every instance is fine; it appears once in the published page bundle.

Missing fields use defaults declared by `propsSchema`. If parsing fails, each declared prop is parsed independently; only a prop that cannot be repaired takes its module default. Valid authored siblings and unknown injected keys survive. A schema without per-property granularity uses module defaults. Required publishing behavior belongs in an explicit `publishSchema` over resolved `{ props, settings }`; that separate hard check raises `ModulePublishValidationError` with the page/node/schema path.

`renderedChildren` is a `string[]` of already-rendered child HTML. Leaf modules (text, input, image) receive an empty array. Container-like modules join it: `renderedChildren.join('')`.

String props arrive HTML-escaped by step 6. If you need to emit a raw unescaped attribute value (e.g. a pre-validated URL), use `escapeHtml(value)` from `@modules/base/utils/escape` before interpolating it into the HTML string.

---

## Editor canvas rendering

The canvas renders modules inside per-breakpoint iframes. Two render paths:

| Path                                                                       | When used                                                  |
|----------------------------------------------------------------------------|------------------------------------------------------------|
| The module's `render()` HTML inserted into the iframe (default)            | All modules with no `component`                            |
| The module's React `component` rendered in a host-managed iframe           | When the module needs DOM access or interactive runtime    |

The React component receives `ModuleComponentProps<TProps>`:

```ts
interface ModuleComponentProps<TProps> {
  props:             TProps
  nodeId:            string
  isSelected:        boolean
  children?:         React.ReactNode
  /** Space-separated CSS class string from node.classIds — spread onto the root element. */
  mcClassName?:      string
  /**
   * Editor attributes and event handlers — MUST be spread onto the root element.
   * Wires selection, hover, double-click, context-menu, and keyboard activation.
   * undefined outside the editor (publisher, plugin sandbox preview).
   */
  nodeWrapperProps?: NodeWrapperProps
}
```

**Spreading `nodeWrapperProps` is mandatory.** Every module editor component must spread `nodeWrapperProps` onto its root JSX element and apply `mcClassName` as the class. Without this the node is invisible to the editor's interaction layer (selection, hover, keyboard). Example:

```tsx
export const HeadingEditor: React.FC<ModuleComponentProps<HeadingProps>> = ({
  props, children, mcClassName, nodeWrapperProps,
}) => {
  const tag = `h${Math.max(1, Math.min(6, Number(props.level) || 2))}`
  return React.createElement(tag, {
    ...nodeWrapperProps,
    className: mcClassName,
    'data-align': props.align,
  }, props.text)
}
```

Modules with a `component` must produce HTML that **matches** what `render()` would produce — the canvas selection geometry, drop-target detection, and dimension measurements assume parity. The mechanism for enforcing this without code duplication is the **shared leaf pattern**: extract the pure decision logic (element choice, content fallback, text splitting, URL computation) into a sibling `.ts` file that both `render()` (in `index.ts`) and the canvas component (in `*Editor.tsx`) import. See [reference/module-engine.md](../reference/module-engine.md) → "Sharing logic".

---

## Module dependencies

Modules can declare external npm dependencies they need at runtime (e.g. a `base.three-scene` module that imports `three`):

```ts
dependencies: {
  three: '^0.171.0',
} as ModuleDependencies
```

When a page uses such a module, the publisher emits a `<script type="importmap">` mapping `three` to the per-site runtime cache URL (`/_instatic/runtime/cache/<hash>/three/build/three.module.js`).

`getMissingModuleDependencies(...)` in `dependencies.ts` returns the dependencies a module needs that the site doesn't declare in its `packageJson` — the Site → Dependencies panel surfaces these so the user can add them.

---

## Cookbook

### Define a first-party module

```ts
// src/modules/base/heading/index.ts
import type { ModuleDefinition } from '@core/module-engine'
import { registry } from '@core/module-engine'
import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import { HeadingIcon } from 'pixel-art-icons/icons/heading'  // example icon
import { HeadingEditor } from './HeadingEditor'

const HeadingPropsSchema = Type.Object({
  level: Type.Number({ default: 2 }),
  text:  Type.String({ default: 'Heading' }),
  align: Type.Union([Type.Literal('left'), Type.Literal('center'), Type.Literal('right')], { default: 'left' }),
})

type HeadingProps = Static<typeof HeadingPropsSchema>

export const HeadingModule: ModuleDefinition<HeadingProps> = {
  id: 'base.heading',
  name: 'Heading',
  description: 'A heading element (h1–h6).',
  category: 'Typography',
  version: '1.0.0',
  icon: HeadingIcon,
  trusted: true,
  canHaveChildren: false,
  propsSchema: HeadingPropsSchema,
  defaults: Value.Create(HeadingPropsSchema),
  schema: {
    level: {
      type: 'select',
      label: 'Level',
      options: [1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `h${n}` })),
    },
    text:  { type: 'text', label: 'Text' },
    align: {
      type: 'select',
      label: 'Align',
      layout: 'inline',
      options: [
        { value: 'left',   label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right',  label: 'Right' },
      ],
    },
  },
  assets: { css: '.heading[data-align="center"] { text-align: center; } .heading[data-align="right"] { text-align: right; }' },
  component: HeadingEditor,
  htmlTag: 'h2',
  render: (props) => {
    const tag = `h${Math.max(1, Math.min(6, Number(props.level) || 2))}`
    return {
      html: `<${tag} class="heading" data-align="${props.align}">${props.text}</${tag}>`,
    }
  },
}

registry.registerOrReplace(HeadingModule)
// Then add `import './heading'` to src/modules/base/index.ts
```

That's it. The module shows up in the picker, in the Properties panel, in the publisher, in the canvas.

### Override per-breakpoint props

Nodes carry `breakpointOverrides: Record<breakpointId, Partial<TProps>>`. The publisher merges them on top of `props` for the active breakpoint:

```ts
// In the editor:
setBreakpointOverride(nodeId, 'mobile', 'align', 'center')

// At render:
resolveProps(node, 'mobile')  → { ...node.props, ...node.breakpointOverrides.mobile }
```

Modules don't need to know — they just receive resolved props.

### Bind a prop to dynamic data

`PageNode.dynamicBindings` lets a prop be filled from `currentEntry` / `parentEntry` / `page` / `site` / `route` at render time:

```jsonc
{
  "moduleId": "base.heading",
  "props": { "text": "Default heading", "level": 2 },
  "dynamicBindings": {
    "text": { "source": "currentEntry", "field": "title" }
  }
}
```

At render time, `resolveDynamicProps(...)` substitutes the bound value. Used inside loops (the entry stack supplies `currentEntry`) and inside entry templates (the published row supplies `currentEntry`).

---

## Forbidden patterns

| Pattern                                                       | Use instead                                                  |
|---------------------------------------------------------------|--------------------------------------------------------------|
| `render` calling `document.querySelector` / `window.foo`      | Render is pure — no DOM. Compute, don't read.                |
| `await fetch(...)` inside `render`                            | Render is sync. Pre-fetch via loop prefetch / media prefetch.|
| Mutating `props` inside `render`                              | Treat as immutable input.                                    |
| Hand-escaping with `String.replace(/</g, '&lt;')`             | Use `escapeHtml(value)` from `@modules/base/utils/escape` — string props are pre-escaped by the publisher, but explicit values (URLs, raw attributes) need manual escaping. |
| Returning `{ html: '<script>...</script>' }`                  | Scripts in module HTML are stripped at publish-time sanitize. Use plugin frontend assets for runtime JS. |
| Emitting unique CSS per instance (with hardcoded ids)         | Use stable selectors / `[data-*]` attrs — CSS is deduped per `moduleId`. |
| Hardcoding hex colors in module CSS                           | Module CSS ships to published pages, where editor tokens aren't available. Use site `framework` tokens (`var(--site-primary)` style) if exposed, or accept the hex literal. (`src/modules/` is exempt from `css-token-policy.test.ts`.) |
| Importing from `@admin/...` inside a module                   | Modules are publisher-side. Admin imports break boot. Stay inside `@core/...` and `@ui/...` (for icons). |
| Duplicating render logic between `render()` and `*Editor.tsx` | Extract to a sibling `.ts` leaf (e.g. `anchor.ts`, `items.ts`) or `base/shared/` for cross-module vocabulary. Canvas/publisher drift is the most visible bug a CMS can ship. |

---

## Related

- [docs/architecture.md](../architecture.md) — modules in the layer stack
- [docs/features/publisher.md](publisher.md) — how the walker calls `module.render()`
- [docs/features/visual-components.md](visual-components.md) — `base.visual-component-ref`, `base.slot-outlet`, `base.slot-instance`
- [docs/features/loops.md](loops.md) — `base.loop`
- [docs/features/cms-native-forms.md](cms-native-forms.md) — `base.form` and form-control primitives
- [docs/features/plugin-system.md](plugin-system.md) — plugin modules + module packs
- [docs/features/html-import.md](html-import.md) — HTML string → `PageNode` importer; uses `base.text`, `base.button`, `base.image`, `base.container`
- [docs/reference/module-engine.md](../reference/module-engine.md) — focused cookbook for adding a module
- [docs/reference/page-tree.md](../reference/page-tree.md) — nodes reference modules by `moduleId`
- Source-of-truth files:
  - `src/core/module-engine/types.ts` — `ModuleDefinition`, `RenderOutput`, `ModuleComponentProps`
  - `src/core/module-engine/registry.ts` — `ModuleRegistry`, `registry` singleton
  - `src/core/module-engine/propertySchema.ts` — `PropertyControl` union, `PropertySchemaSchema`
  - `src/core/module-engine/htmlTagBadge.ts` — `resolveHtmlTagBadge`
  - `src/core/module-engine/dependencies.ts` — `ModuleDependencies`, `getMissingModuleDependencies`
  - `src/modules/base/index.ts` — boot-time first-party registration
  - `src/modules/base/utils/escape.ts` — `escapeHtml`, `safeUrl`, `buildStyle`
  - `src/core/htmlAttributes/tags.ts` — `resolveHtmlTag`, `BUILTIN_HTML_TAGS`, `VOID_HTML_ELEMENTS`
  - `src/modules/base/utils/htmlTag.ts` — `htmlTagControl`, `customHtmlTagControl`
  - `src/modules/base/utils/mediaAttrs.ts` — `buildMediaSrcset`, `pickMediaVariantUrl`
- Gate tests:
  - `src/__tests__/architecture/component-system-placement.test.ts`
  - `src/__tests__/architecture/framework-typography-spacing.test.ts`
  - `src/__tests__/module-engine/moduleConsolidation.test.ts` — publishBehavior contract, shared media helpers, transparent validation
  - `src/__tests__/base-modules-shared-render.test.ts` — shared-leaf helper contracts + golden publisher render bytes
  - `src/__tests__/base-modules-shared-render.editor.test.tsx` — canvas component parity with publisher helpers

## Scroll rails, section navigation and tabs

`src/modules/base/scrollNavigation/` provides ordinary authored elements with shared, dependency-free module runtimes. These modules add no visual theme or layout wrapper. Give rails their horizontal overflow/layout classes; give controls, buttons, links and panels their normal native style classes. Text and accessible labels support the standard language-file bindings.

- `base.scroll-rail` emits a `<div>`. `stepRatio` and `minimumStep` determine the previous/next distance; `dragEnabled` enables pointer dragging. Keep the rail keyboard focusable with an authored `tabindex="0"` and give it an accessible label.
- `base.scroll-controls` emits the next sibling `<div>` immediately after its rail. It contains ordinary authored hint text/wrappers and `base.scroll-button` nodes. Its controls appear only while the rail overflows. A button's `direction` is `previous` or `next`; `label` and `disabled` are authored props. Reaching an edge does not automatically disable a button. The runtime respects both the native visitor motion preference and the operating system's reduced-motion preference.
- `base.section-nav` emits `<nav>` with ordinary fragment links. It updates `aria-current="location"` as the linked sections pass `activationOffset`; links retain their native navigation. All sections remain ordinary visible content.
- `base.tabs` emits a `<div>` containing exactly one direct tab-list child (`base.container` with `role="tablist"`) and ordered direct `base.tab-panel` children. Put one `base.tab` per panel inside the tab list. Exactly one tab has `initiallySelected: true`; that matching panel has `initiallyHidden: false`, and all other panels have it set to true. Panels retain their complete authored children. Click, Left/Right, Home and End select a tab; arrow and boundary keys also focus it. The selected tab is the sole tab stop.

`base.tab-link` keeps an ordinary anchor and its authored children. Set the target Tabs `groupId`, the target Tab `tabKey`, and matching `groupId`/`tabKey` on the link. Its `href` names an existing local fragment. A primary click selects the tab while preserving native fragment navigation; modifier clicks and new-tab targets retain ordinary link behavior. Group IDs, tab keys within a group, and link fragment targets must be unique in the rendered page.

Rail controls bind structurally to their previous sibling rail. Tabs bind structurally within their closest Tabs owner; external Tab links use explicit authored group/key identities. No source-specific class lookup participates. An optional authored rail ID must remain unique; omit it in a repeated component to receive per-instance runtime identities. The runtime assigns unique ARIA IDs and ID references within each public document, including multiple instances of the same Visual Component. Section navigation uses its authored fragment targets, so those section IDs must be unique in the page as normal HTML requires.

The design canvas preserves the authored element/class topology and keeps controls editable; public/live preview runs the shared runtime through `ModuleDefinition.assets.js`. Controls and inactive panels use small module-owned `[hidden]` rules. Pointer dragging exposes `data-instatic-dragging="true"` for authored state styling. Tabs expose the standard `aria-selected` and `hidden` attributes.

`assertPageScrollNavigation` / `assertSiteScrollNavigation` in `src/core/publisher/scrollNavigationPreflight.ts` validate effective Visual Component and slot composition before publication. A detached Scroll button, controls without an immediately preceding rail, mismatched tab/panel counts, tabs outside the tab list, inconsistent initial visibility, or an unresolved/ambiguous external Tab link throws `ScrollNavigationConfigurationError` with the node path. Invalid authoring never publishes a guessed association. Native module TypeBox props and generated-attribute reservations own the behavior attributes.

## Structural conditions

`base.condition` renders children only when its authored or bound boolean `show` is true. Its `ModuleDefinition.shouldRenderChildren` hook lets the publisher prune inactive children before their bindings, validation and assets run. This is a general module contract; the publisher does not branch on a condition module ID. The canvas retains its normal editable placeholder for inactive conditional content.

## Scroll state

`base.scroll-state` emits the authored semantic `tag`/`customTag`, preserves children and classes, and exposes `data-instatic-scroll-state="before"|"after"` when a page-unique authored `targetId` crosses a viewport offset. `edge="end"` compares the target's bottom with `offset` pixels from the viewport top; `edge="start"` compares its top. Equality selects `after`. The module owns no positioning, colors or animation: author those through ordinary style-registry selectors on the state attribute. It can replace a container or wrap a shared component with an authored `display:contents` class, with state selectors styling descendants.

The same document-scoped installer runs in the canvas iframe and the published page. Scroll, resize, target/document resizing, font/image loads and late fragment insertion update the state. A temporarily absent, duplicated or invalid runtime target exposes `unresolved`; it does not guess a different target. `assertPageScrollState`/`assertSiteScrollState` reject missing, ambiguous and self-referential authored targets after Visual Component/slot composition, as well as void controller tags. Targets use normal unique HTML IDs; do not repeat the same target ID in multiple Visual Component instances. Module/runtime attributes cannot be overridden through `htmlAttributes`.

State changes are immediate and perform no scrolling. `data-instatic-scroll-motion="reduced"|"full"` reflects the native visitor/OS reduced-motion preference so authored state animations can honor it. The shared installer reference-counts canvas instances, restores original attributes and releases observers/listeners on the final cleanup.
