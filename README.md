# Penpot XML Data Binding MVP

A minimal Penpot plugin that binds text layers to XML stored in another Penpot text layer.

## What it does

1. Put XML into a normal Penpot text layer, for example:

```xml
<product id="p1">
  <name>Espressomaschine X1</name>
  <price>249 €</price>
</product>
```

2. Select that layer and click **Use selected text as source**.
3. Select another text layer.
4. Enter `/product/name` (or `/product/@id`).
5. Click **Bind selected layer**.
6. Click **Refresh all bindings** whenever the XML changes.

Bindings are stored on each target shape as Penpot plugin data, so they remain in the document.

## Supported paths in this MVP

- `/product/name`
- `/product/price`
- `/catalog/product/name`
- `/product/@id`

This is intentionally a small path resolver, not full XPath. Repeating nodes, indexes, namespaces, predicates, and XPath functions are not yet supported.

## Install from GitHub Pages

In Penpot's plugin manager, add this manifest URL:

```text
https://donmikele75.github.io/movatix-penpot-plugin/manifest.json
```

The plugin runs inside Penpot; opening the hosted HTML page directly is not a standalone demo.

## CI and deployment

The GitHub Actions workflow in `.github/workflows/pages.yml` validates the manifest and JavaScript syntax on pushes and pull requests to `main`. Successful pushes to `main` automatically deploy `manifest.json`, `plugin.js`, and `index.html` to GitHub Pages. The workflow can also be started manually.

Repository **Settings > Pages > Source** must be set to **GitHub Actions**. Deployment uses the built-in `GITHUB_TOKEN`; no additional secrets are needed.

## Install / test locally

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

- full XPath via a dedicated XPath evaluator
- multiple named XML source layers
- repeated nodes / component generation
- live refresh when the source text layer changes
- binding attributes and text templates such as `{{/product/name}} — {{/product/price}}`
