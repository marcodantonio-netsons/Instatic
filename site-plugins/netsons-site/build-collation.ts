import ts from 'typescript'

/** Keep the library's full UCA root data and only the site's locale tailorings. */
function selectLocales(code: string, path: string, languages: readonly string[]): string {
  const source = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS)
  const allowed = new Set([...languages, 'root'])
  const expected = new Set(['availableCollationLocales', 'collationLocaleData', 'collationTailorings'])
  const edits: Array<{ start: number; end: number; text: string }> = []
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !expected.has(declaration.name.text) || !declaration.initializer) continue
      const initializer = declaration.initializer
      let text: string
      if (ts.isArrayLiteralExpression(initializer)) {
        const values = initializer.elements.filter(value => ts.isStringLiteral(value) && allowed.has(value.text))
        if (values.length !== languages.length) throw Error('Collation library locale list changed')
        text = '[' + values.map(value => value.getText(source)).join(',') + ']'
      } else if (ts.isObjectLiteralExpression(initializer)) {
        const properties = initializer.properties.filter(property => property.name && ts.isStringLiteral(property.name) && allowed.has(property.name.text))
        if (!properties.length) throw Error('Collation library locale data changed')
        text = '{' + properties.map(property => property.getText(source)).join(',') + '}'
      } else throw Error('Unsupported collation data representation')
      edits.push({ start: initializer.getStart(source), end: initializer.end, text })
      expected.delete(declaration.name.text)
    }
  }
  if (expected.size) throw Error('Collation library data exports changed: ' + [...expected].join(','))
  for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + edit.text + code.slice(edit.end)
  return code
}

export async function buildCollation(root: string, languages: readonly string[]): Promise<void> {
  const result = await Bun.build({
    entrypoints: [root + '/src/collation/privateEntry.ts'], format: 'iife', target: 'browser',
    minify: { whitespace: true, syntax: false, identifiers: false },
    plugins: [{ name: 'site-collation-locales', setup(build) {
      build.onLoad({ filter: /[/\\]intl-collator[/\\]index\.js$/ }, async args => ({ contents: selectLocales(await Bun.file(args.path).text(), args.path, languages), loader: 'js' }))
    } }],
  })
  if (!result.success || result.outputs.length !== 1) throw new AggregateError(result.logs, 'Cannot build private collation library')
  await Bun.write(root + '/src/collation/generated/collator.js', 'export const Collator = (() => { const Intl = {}; const globalThis = { Intl };\n' + await result.outputs[0].text() + '\nreturn globalThis.__netsonsCollator; })();\n')
  await Bun.write(root + '/src/collation/generated/collator.d.ts', 'export declare const Collator: typeof Intl.Collator\n')
}
