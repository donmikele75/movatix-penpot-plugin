const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("XML normalization repairs tag boundaries without changing values or literal markup", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i)[1];
  const context = {
    document: { getElementById: () => ({}) },
    window: { addEventListener: () => {} },
    parent: { postMessage: () => {} },
  };
  vm.runInNewContext(script, context);
  const gap = "\u200b\u200b";
  const content = `<name attr="/${gap}>">Text/${gap}value</${gap}name><empty /${gap}>`;
  const expected = `<name attr="/${gap}>">Text/${gap}value</name><empty />`;
  assert.equal(context.normalizeXmlMarkup(content), expected);
  for (const literal of [
    `<![CDATA[</${gap}name> /${gap}>]]>`,
    `<!-- </${gap}name> /${gap}> -->`,
    `<?example </${gap}name> ?>`,
    `<name attr='/${gap}>'>unchanged</name>`,
    "<data><name>Normal XML</name><empty /></data>",
    "<data>Bad & value</wrong>",
  ]) {
    assert.equal(context.normalizeXmlMarkup(literal), literal);
  }
});

test("XML validation recognizes Chromium and Firefox parser errors", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i)[1];
  for (const namespace of ["http://www.w3.org/1999/xhtml", "http://www.mozilla.org/newlayout/xml/parsererror.xml", null]) {
    const parsed = {
      getElementsByTagNameNS: (requested) => requested === namespace ? [{ textContent: "line 1: invalid XML" }] : [],
    };
    const context = {
      document: { getElementById: () => ({}) },
      window: { addEventListener: () => {} },
      parent: { postMessage: () => {} },
      DOMParser: class { parseFromString() { return parsed; } },
    };
    vm.runInNewContext(script, context);
    assert.throws(() => context.parseXml("   "), /XML must not be empty/);
    if (namespace) assert.throws(() => context.parseXml("<broken>"), /Invalid XML: line 1/);
    else assert.equal(context.parseXml("<data/>"), parsed);
  }
});

function createHarness() {
  function createShape(id, characters, data = {}) {
    return {
      id, name: id, type: "text", characters,
      getPluginData: (key) => data[key] || "",
      setPluginData: (key, value) => { data[key] = value; },
    };
  }
  const source = createShape("source", "<data><name>Alpha</name></data>");
  const otherSource = createShape("other-source", "<data><name>Beta</name></data>");
  const target = createShape("target", "Original");
  const shapes = new Map([source, otherSource, target].map((shape) => [shape.id, shape]));
  const messages = [];
  const sizes = [];
  const listeners = {};
  const fileData = { "xml-binding-default-source": source.id };
  let receive;
  const penpot = {
    selection: [target],
    currentPage: {
      id: "page",
      getShapeById: (id) => shapes.get(id),
      findShapes: () => [...shapes.values()],
    },
    currentFile: {
      id: "file",
      getPluginData: (key) => fileData[key],
      setPluginData: (key, value) => { fileData[key] = value; },
    },
    ui: {
      open: () => {},
      resize: (width, height) => sizes.push({ width, height }),
      sendMessage: (message) => messages.push(message),
      onMessage: (callback) => { receive = callback; },
    },
    on: (event, callback) => { listeners[event] = callback; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../plugin.js"), "utf8"), { penpot });
  const bind = (overrides = {}) => receive({
    type: "bind", targetId: target.id, sourceId: source.id,
    xml: source.characters, path: "/data/name", value: "Alpha", ...overrides,
  });
  return { source, otherSource, target, shapes, messages, sizes, listeners, penpot, bind, receive };
}

test("source editor expands and restores the plugin window", () => {
  const harness = createHarness();
  harness.receive({ type: "editor-size", expanded: true });
  harness.receive({ type: "editor-size", expanded: false });
  assert.deepEqual(harness.sizes, [{ width: 640, height: 680 }, { width: 360, height: 560 }]);
});

test("binding stores metadata and immediately applies the preview", () => {
  const harness = createHarness();
  harness.bind();
  assert.equal(harness.target.characters, "Alpha");
  assert.equal(harness.target.getPluginData("xml-binding-source"), "source");
  assert.equal(harness.target.getPluginData("xml-binding-path"), "/data/name");
});

test("inspector uses the bound source, not the default, and reports a missing source", () => {
  const harness = createHarness();
  harness.target.setPluginData("xml-binding-source", harness.otherSource.id);
  harness.listeners.selectionchange();
  assert.equal(harness.messages.at(-1).source.id, harness.otherSource.id);
  harness.shapes.delete(harness.otherSource.id);
  harness.listeners.selectionchange();
  assert.equal(harness.messages.at(-1).source, null);
});

test("binding rejects a changed selection", () => {
  const harness = createHarness();
  harness.penpot.selection = [harness.otherSource];
  harness.bind();
  assert.equal(harness.target.characters, "Original");
  assert.equal(harness.otherSource.characters, "<data><name>Beta</name></data>");
});

test("binding rejects a changed source snapshot", () => {
  const harness = createHarness();
  harness.bind({ xml: "old XML" });
  assert.equal(harness.target.characters, "Original");
  assert.equal(harness.target.getPluginData("xml-binding-path"), "");
});

test("binding rejects multiple selected layers and self-binding", () => {
  const harness = createHarness();
  harness.penpot.selection = [harness.target, harness.otherSource];
  harness.bind();
  harness.listeners.selectionchange();
  assert.equal(harness.messages.at(-1).shape, null);
  assert.equal(harness.target.characters, "Original");
  harness.penpot.selection = [harness.source];
  harness.bind({ targetId: harness.source.id });
  assert.equal(harness.source.getPluginData("xml-binding-path"), "");
});

test("empty values are applied and unbinding preserves the rendered text", () => {
  const harness = createHarness();
  harness.bind({ value: "" });
  assert.equal(harness.target.characters, "");
  harness.receive({ type: "unbind", targetId: "different" });
  assert.equal(harness.target.getPluginData("xml-binding-path"), "/data/name");
  harness.receive({ type: "unbind", targetId: harness.target.id });
  assert.equal(harness.target.getPluginData("xml-binding-path"), "");
  assert.equal(harness.target.characters, "");
});

test("refresh sends current XML and applies results while preserving failed targets", () => {
  const harness = createHarness();
  harness.bind();
  harness.source.characters = "<data><name>Changed</name></data>";
  harness.receive({ type: "refresh-all" });
  assert.equal(harness.messages.at(-1).items[0].xml, harness.source.characters);
  harness.receive({ type: "apply-values", results: [{ targetId: harness.target.id, ok: true, value: "Changed" }] });
  assert.equal(harness.target.characters, "Changed");
  harness.receive({ type: "apply-values", results: [{ targetId: harness.target.id, ok: false, error: "XPath has no matches" }] });
  assert.equal(harness.target.characters, "Changed");
  assert.equal(harness.messages.findLast((message) => message.type === "refresh-result").errors.length, 1);
  assert.equal(harness.messages.at(-1).source.characters, harness.source.characters);
});

test("editor source is authoritative for selection, binding and refresh without rewriting canvas text", () => {
  const harness = createHarness();
  const originalXml = harness.source.characters;
  const xml = "<data><name>Edited</name></data>";
  harness.receive({ type: "save-source", sourceId: "source", pageId: "page", fileId: "file", originalXml, xml });
  assert.equal(harness.source.characters, originalXml);
  assert.equal(harness.messages.at(-1).source.characters, xml);
  assert.equal(harness.messages.at(-1).source.storage, "plugin");
  harness.source.characters = "<broken canvas text";
  harness.bind({ xml, value: "Edited" });
  assert.equal(harness.target.characters, "Edited");
  harness.receive({ type: "refresh-all" });
  assert.equal(harness.messages.at(-1).items[0].xml, xml);
});

test("editor saves reject conflicts, context changes, deleted sources and empty XML", () => {
  for (const overrides of [{ originalXml: "stale" }, { pageId: "other" }, { fileId: "other" }, { sourceId: "deleted" }, { xml: "" }]) {
    const harness = createHarness();
    harness.receive({ type: "save-source", sourceId: "source", pageId: "page", fileId: "file", originalXml: harness.source.characters, xml: "<data/>", ...overrides });
    assert.equal(harness.messages.at(-1).type, "source-save-error");
    assert.equal(harness.source.getPluginData("xml-binding-xml"), "");
  }
});