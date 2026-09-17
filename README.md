# Penpot XPath Inspector

A Penpot plugin that binds text layers to named XML sources stored in the document's plugin data. No XML source layer is required.

## What it does

1. Click **New XML source**, enter a name and paste XML or import a UTF-8 XML file. Example:

```xml
<product id="p1">
  <name>Espressomaschine X1</name>
  <price>249 €</price>
</product>
```

2. Use **Pretty print** to indent the XML if needed, then click **Save source**.
3. Select a target text layer (or leave nothing selected) and choose a source from **Document XML source**. This section is only shown when no layer is selected; selecting a layer hides it and reuses the currently loaded source.
4. Enter `/product/name` (or `/product/@id`), or click **Choose XML node** and select an element or attribute.
5. Check the live value preview and click **Apply binding** to store the binding and update the text immediately.
6. Edit the source through **Edit XML source**. Saving refreshes bindings on the current page by default; **Refresh all bindings** is also available separately.

Bindings are stored on each target shape as Penpot plugin data, so they remain in the document.

The inspector follows the selected text layer and shows its bound source, even when it differs from the default source. Choosing another source changes the preview and default for unbound layers; **Apply binding** commits the source change on the selected target. Unbound layers start with an empty XPath. Select exactly one text layer to edit a binding. A bound layer shows its XPath and source as a fixed entry above the XPath field; click its trash icon to remove the binding and keep the layer's current text. **Reload** rereads the selection and source XML without discarding an unchanged layer's draft XPath.

The inspector is a separate plugin window, not an extension of Penpot's native Inspect sidebar. Sources are available across all pages of the current document and persist with the document, including for collaborators. **Refresh all bindings** updates targets on the current page only. Source changes are reread on selection changes, Reload, or Refresh all bindings; there is no background synchronization after the plugin closes.

## Non-text layers

Select any single non-text layer (for example a rectangle, image, group or board) to manage multiple XPath entries. Saved entries are always listed above the XPath field, are not collapsible, and each shows its path, source name and remark. Click the trash icon on an entry to delete it, edit its remark directly in its own text box (saved automatically once you leave the field), or click **Edit XPath** to load its path and remark into the form below for a full edit (including changing the XML source). To add a new entry, enter a path or use **Choose XML node**, then enter a mandatory **Remark** and click **Add XPath**. Each entry stores its XML source, XPath and remark in the layer's plugin data; different entries can reference different document XML sources.

These entries are annotations only: they do not change the layer's appearance, and **Refresh all bindings** still updates text layers only. XPath syntax and results are checked in the preview before saving; blank remarks cannot be saved or kept (an emptied remark reverts to its previous value). Layer/file/page changes and conflicting writes are rejected. **Reload** on non-text layers discards the current draft and loads the latest entries; switching layers also discards an unsaved draft. Text layers retain their existing single binding and do not require remarks.

## Repeater containers

Select a **board** to reveal the **Repeater** section, in addition to its XPath entries. This board acts as the **repeater container**: bind the text layers among its direct child layers (and their own descendants) to relative XPaths (for example `./name` instead of `/data/items/item/name`) using their own single binding as usual; the section lists these bound fields for reference. Enter a **Repeater container: XPath (node-set)** that selects the repeating elements (for example `/data/items/item`) and click **Generate instances**.

For each matched element, the plugin clones every direct child layer of the container as a group and resolves every bound text field's path relative to that specific element (native XPath: paths starting with `/` still resolve from the document root, so absolute bindings inside a repeater container are unaffected). The first match updates the existing child layers in place; the rest are added as cloned groups stacked vertically below the template, preserving the children's relative arrangement, with a fixed gap between groups. Regenerating removes the previously generated clones first, so it never duplicates; **Remove repeater** deletes all generated clones and clears the configuration, leaving the container's original child layers and their text values untouched.

When you select a text layer that is nested (at any depth) inside a repeater container with a saved configuration, its value preview, **Apply binding** and **Choose XML node** automatically use the repeater's first matched element as context (shown as a note above the value preview), so a relative path like `./name` resolves and can be applied normally instead of showing "XPath has no matches" against the whole document. The picker also starts its tree at that matched element and generates paths relative to it. This only affects the preview/picker for that one representative match; the real per-instance values are still computed separately for every match when you click **Generate instances** on the container.

**Refresh all bindings** also regenerates every repeater container on the current page: it discards each container's previously generated clones and recreates them from the latest XML, in addition to updating plain text bindings.

## XPath picker

**Choose XML node** opens an expandable view of the selected source. Expand a branch using its disclosure arrow and click an element or attribute name to copy its absolute XPath into the field and update the preview. Values are shortened, including large Base64 fields, and child branches are rendered only when expanded. Cancel or Escape leaves the current XPath unchanged. Selecting a node does not save a binding; use **Apply binding** afterwards.

Repeated sibling elements use positional predicates such as `/data/item[2]/description`. Enable **Prefer unique ID attributes** to use `@id` when it uniquely identifies an element among siblings of the same expanded name; duplicate or empty IDs fall back to positions. Namespaced elements and attributes use `local-name()` and `namespace-uri()` so generated paths do not depend on prefix declarations. A selection or source update closes an open picker to avoid using stale XML. Generated paths remain manually editable.

## Supported XPath

XPath 1.0 is evaluated using the browser's native `document.evaluate()`:

- `/product/name`
- `/product/@id`
- `/data/tours/tour[1]/vehicle_no`
- `/data/tours/tour[@id='example-tour']/orders/order[1]/customer_name`
- `count(/data/tours/tour)`
- `concat(/product/name, ' - ', /product/price)`

Node selections use the first match in document order, trimming surrounding whitespace. Empty elements produce an empty value; no matches produce an error and leave existing text unchanged. String, number, and boolean expressions are supported. XML namespace prefixes declared on the root element are resolved automatically; default namespaces require an explicit XPath such as `/*[local-name()='product']/*[local-name()='name']` or a declared prefix. XPath 2.0/3.1 is not supported.

Use standard XPath paths from the document root. Legacy root-relative shortcuts such as `name` for `<product><name>...</name></product>` must be changed to `/product/name`.

HTML markup in textual XPath results is converted to plain text for the preview, applying a binding, and refreshing bindings. For example, `<description>(new)&lt;br/&gt;1 order</description>` renders as two lines. Inline tags are removed, `<br>` and block elements such as paragraphs create line breaks, and HTML entities inside markup are decoded. Script/style contents are ignored; the HTML is parsed in an inert template and never inserted into the page. XML source data remains unchanged. Numeric and boolean XPath results are unaffected.

## XML text editing

**Edit XML source** opens a larger plain-text editor with XML syntax highlighting, editable source name, line/column position, a U+200B character count, UTF-8 file import and **Validate XML**. Invalid XML cannot be saved. Parser diagnostics include the browser's error location. **Clean tag separators** explicitly repairs the tag-boundary characters described below; it does not silently change text values.

**Pretty print** uses `xml-formatter` with two-space indentation, preserving mixed content and `xml:space="preserve"`. It validates before and after formatting and does not save automatically. Indentation introduces whitespace text nodes, which can affect whitespace-sensitive XPath expressions such as `text()` or `node()`. Syntax highlighting uses Prism and changes only the display. Both libraries are bundled locally; XML is not sent to an external service.

Sources are stored in versioned document plugin data (`xml-binding-document-sources`), separate from canvas layers. When the plugin loads, existing default and bound layer sources across the document's pages are migrated automatically, preferring their editor-managed XML over canvas text. Existing IDs remain as internal source keys, so bindings do not need rewriting. Source layers are never deleted or modified by migration and can be removed after successful migration. Already-missing legacy sources cannot be recovered; the inspector reports them as missing. Unsupported or corrupt stored data is not overwritten.

An open editor stays attached to its original source when selection or page changes. Saving rejects a changed source snapshot/name or a different file and keeps the draft available. **Discard and close** discards unsaved edits; Escape does not discard a modified draft. Closing the entire plugin still loses unsaved edits.

Text copied from or edited in rich-text environments may contain invisible U+200B (zero-width space) characters. The inspector tolerates these immediately after `</` in closing tags and between `/` and `>` in self-closing tags. This normalization is applied only to the parser input; it does not modify the source layer or the raw Source XML preview. Text values, attributes, comments, processing instructions, and CDATA are preserved. Other malformed XML still produces an error with the browser's parser details.

## Install from GitHub Pages

In Penpot's plugin manager, add this manifest URL:

```text
https://donmikele75.github.io/movatix-penpot-plugin/manifest.json
```

The plugin runs inside Penpot; opening the hosted HTML page directly is not a standalone demo.

## CI and deployment

The GitHub Actions workflow in `.github/workflows/pages.yml` installs locked npm dependencies, bundles the editor libraries, validates the manifest and JavaScript syntax, and runs the plugin regression tests on pushes and pull requests to `main`. Successful pushes to `main` deploy the plugin and generated `vendor/` assets to GitHub Pages. The workflow can also be started manually.

Repository **Settings > Pages > Source** must be set to **GitHub Actions**. Deployment uses the built-in `GITHUB_TOKEN`; no additional secrets are needed.

## Install / test locally

Install and bundle the local editor assets, then run tests with Node.js 24:

```bash
npm ci
npm run build
npm test
```

These tests cover plugin state and mutations; native XPath and the UI require browser testing. They do not replace an integration test inside Penpot.

Penpot plugins are loaded from a manifest URL. Serve this folder over HTTP, for example with any static web server, then add the resulting `manifest.json` URL in Penpot's plugin manager.

Example using Python locally:

```bash
python -m http.server 8080
```

Then use a URL such as:

```text
http://localhost:8080/manifest.json
```

Whether localhost is reachable depends on where your Penpot instance runs. For hosted Penpot, use an HTTPS-accessible static host.

## Files

- `manifest.json` — plugin manifest
- `plugin.js` — Penpot-side logic and persistent bindings
- `index.html` — plugin UI and XML parsing

## Next useful steps

- repeated nodes / component generation
- live refresh when document XML sources change
- binding attributes and text templates such as `{{/product/name}} — {{/product/price}}`
