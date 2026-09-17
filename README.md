# Penpot XPath Inspector

A minimal Penpot plugin that binds text layers to XML stored in another Penpot text layer.

## What it does

1. Put XML into a normal Penpot text layer, for example:

```xml
<product id="p1">
  <name>Espressomaschine X1</name>
  <price>249 €</price>
</product>
```

2. Select that layer and click **Set selection as source**.
3. Select another text layer.
4. Enter `/product/name` (or `/product/@id`).
5. Check the live value preview and click **Apply binding** to store the binding and update the text immediately.
6. Click **Refresh all bindings** whenever the XML changes.

Bindings are stored on each target shape as Penpot plugin data, so they remain in the document.

The inspector follows the selected text layer and shows its bound source, even when it differs from the default source. Unbound layers start with an empty XPath. Select exactly one text layer to edit a binding. **Remove binding** keeps its current text. **Reload** rereads the selection and source XML without discarding an unchanged layer's draft XPath.

The inspector is a separate plugin window, not an extension of Penpot's native Inspect sidebar. Sources and refresh operations are limited to the current page. Source changes are reread on selection changes, Reload, or Refresh all bindings; there is no background synchronization after the plugin closes.

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

## XML text editing

Text copied from or edited in rich-text environments may contain invisible U+200B (zero-width space) characters. The inspector tolerates these immediately after `</` in closing tags and between `/` and `>` in self-closing tags. This normalization is applied only to the parser input; it does not modify the source layer or the raw Source XML preview. Text values, attributes, comments, processing instructions, and CDATA are preserved. Other malformed XML still produces an error with the browser's parser details.

## Install from GitHub Pages

In Penpot's plugin manager, add this manifest URL:

```text
https://donmikele75.github.io/movatix-penpot-plugin/manifest.json
```

The plugin runs inside Penpot; opening the hosted HTML page directly is not a standalone demo.

## CI and deployment

The GitHub Actions workflow in `.github/workflows/pages.yml` validates the manifest and JavaScript syntax and runs the plugin regression tests on pushes and pull requests to `main`. Successful pushes to `main` automatically deploy `manifest.json`, `plugin.js`, and `index.html` to GitHub Pages. The workflow can also be started manually.

Repository **Settings > Pages > Source** must be set to **GitHub Actions**. Deployment uses the built-in `GITHUB_TOKEN`; no additional secrets are needed.

## Install / test locally

Run the Penpot API mock regression tests with Node.js 24:

```bash
node --test tests/*.test.cjs
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

- multiple named XML source layers
- repeated nodes / component generation
- live refresh when the source text layer changes
- binding attributes and text templates such as `{{/product/name}} — {{/product/price}}`
