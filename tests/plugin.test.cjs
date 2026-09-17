const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("XML normalization repairs tag boundaries without changing values or literal markup", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/i)[1];
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
  const script = html.match(/<script>([\s\S]*?)<\/script>/i)[1];
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

test("pretty print preserves mixed content, significant spaces, CDATA and comments", () => {
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  const context = {
    document: { getElementById: () => ({}) },
    window: { addEventListener: () => {} },
    parent: { postMessage: () => {} },
    require,
  };
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/i)[1], context);
  context.parseXml = () => {};
  for (const content of [
    '<p>This is <b>bold</b> text.</p>',
    '<p xml:space="preserve">  This is <b>bold</b>   text.\n </p>',
    '<value>  padded  </value>',
    '<value><![CDATA[a < b & c]]></value>',
    '<!--note-->',
  ]) {
    assert.ok(context.prettyPrintXml(`<root>${content}</root>`).includes(content));
  }
  const formatted = context.prettyPrintXml('<root><item id="1"><name>Alpha</name></item></root>');
  assert.equal(formatted, '<root>\n  <item id="1">\n    <name>Alpha</name>\n  </item>\n</root>');
  assert.equal(context.prettyPrintXml(formatted), formatted);
});

test("HTML DOM extraction preserves line breaks and ignores executable content", () => {
  const text = (value) => ({ nodeType: 3, textContent: value });
  const element = (tagName, ...childNodes) => ({ nodeType: 1, tagName, childNodes });
  let nodes = [];
  const context = {
    document: {
      getElementById: () => ({}),
      createElement: (tagName) => {
        assert.equal(tagName, "template");
        return { content: { childNodes: nodes, childElementCount: nodes.filter((node) => node.nodeType === 1).length } };
      },
    },
    window: { addEventListener: () => {} },
    parent: { postMessage: () => {} },
  };
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/i)[1], context);
  nodes = [text("(new)"), element("BR"), text("1 order")];
  assert.equal(context.htmlToText("(new)<br/>1 order"), "(new)\n1 order");
  nodes = [element("P", text("First "), element("B", text("bold"))), element("P", text("Second & third"))];
  assert.equal(context.htmlToText("<p>First <b>bold</b></p><p>Second &amp; third</p>"), "First bold\nSecond & third");
  nodes = [text("First"), element("BR"), element("BR"), text("Last")];
  assert.equal(context.htmlToText("First<br><br>Last"), "First\n\nLast");
  nodes = [element("SCRIPT", text("run()")), element("STYLE", text("body{}")), { nodeType: 8, textContent: "comment" }, element("SPAN", text("Safe"))];
  assert.equal(context.htmlToText("<script>run()</script><style>body{}</style><span>Safe</span>"), "Safe");
  nodes = [text("  2 < 3 & 4 > 1  ")];
  assert.equal(context.htmlToText("  2 < 3 & 4 > 1  "), "  2 < 3 & 4 > 1  ");
  nodes = [];
  assert.equal(context.htmlToText(""), "");
});

test("XPath picker generates positions, unique IDs, attributes and namespace-safe names", () => {
  const context = {
    document: { getElementById: () => ({}) },
    window: { addEventListener: () => {} },
    parent: { postMessage: () => {} },
  };
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/i)[1], context);
  const doc = { nodeType: 9, children: [] };
  const element = (parent, name, id = null, namespaceURI = null) => {
    const node = { nodeType: 1, nodeName: name, localName: name, namespaceURI, parentNode: parent, children: [], getAttribute: () => id };
    parent.children.push(node);
    return node;
  };
  const root = element(doc, "data");
  const first = element(root, "item", "duplicate");
  element(root, "other");
  const second = element(root, "item", "duplicate");
  const unique = element(root, "item", "unique");
  const description = element(second, "description");
  assert.equal(context.nodeXPath(root), "/data");
  assert.equal(context.nodeXPath(first), "/data/item[1]");
  assert.equal(context.nodeXPath(second, true), "/data/item[2]");
  assert.equal(context.nodeXPath(description), "/data/item[2]/description");
  assert.equal(context.nodeXPath(unique, true), "/data/item[@id='unique']");
  assert.equal(context.nodeXPath({ nodeType: 2, nodeName: "id", namespaceURI: null, ownerElement: unique }, true), "/data/item[@id='unique']/@id");
  const namespaced = element(root, "item", null, "urn:test");
  assert.equal(context.nodeXPath(namespaced), "/data/*[local-name()='item' and namespace-uri()='urn:test']");
  assert.equal(context.nodeXPath({ nodeType: 2, localName: "code", namespaceURI: "urn:attr", ownerElement: namespaced }), "/data/*[local-name()='item' and namespace-uri()='urn:test']/@*[local-name()='code' and namespace-uri()='urn:attr']");
  assert.equal(context.xpathLiteral("plain"), "'plain'");
  assert.equal(context.xpathLiteral("it's"), '\"it\'s\"');
  assert.equal(context.xpathLiteral('a\'"b'), `concat('a', "'", '"b')`);
});

test("XPath picker preserves a reopened tree and handles Escape without changing the path", () => {
  const elements = new Map();
  const messages = [];
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, {});
    return elements.get(id);
  };
  const context = {
    document: { getElementById: getElement },
    window: { addEventListener: () => {} },
    parent: { postMessage: (message) => messages.push(message) },
  };
  const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/i)[1], context);
  const dialog = getElement("xpathPicker");
  let cleared = false;
  let prevented = false;
  getElement("pickerTree").replaceChildren = () => { cleared = true; };
  getElement("path").value = "/data/item[2]";
  dialog.open = true;
  dialog.onclose();
  assert.equal(cleared, false);
  dialog.close = () => { dialog.open = false; };
  dialog.onkeydown({ key: "Escape", preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(dialog.open, false);
  assert.equal(getElement("path").value, "/data/item[2]");
  dialog.onclose();
  assert.equal(cleared, true);
  assert.equal(messages.at(-1).type, "editor-size");
  assert.equal(messages.at(-1).expanded, false);
});

function createHarness(options = {}) {
  function createShape(id, characters, data = {}) {
    return {
      id, name: id, type: "text", characters,
      getPluginData: (key) => data[key] || "",
      setPluginData: (key, value) => { data[key] = value; },
    };
  }
  const source = createShape("source", "<data><name>Alpha</name></data>", options.sourceData);
  const otherSource = createShape("other-source", "<data><name>Beta</name></data>");
  const target = createShape("target", "Original");
  const shapes = new Map([source, otherSource, target].map((shape) => [shape.id, shape]));
  const messages = [];
  const sizes = [];
  const listeners = {};
  const fileData = { "xml-binding-default-source": source.id, ...options.fileData };
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
  penpot.currentFile.pages = [penpot.currentPage];
  options.initialize?.({ penpot, target, source, otherSource, shapes });
  const restart = () => vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../plugin.js"), "utf8"), { penpot });
  restart();
  const bind = (overrides = {}) => receive({
    type: "bind", targetId: target.id, sourceId: source.id,
    xml: source.characters, path: "/data/name", value: "Alpha", ...overrides,
  });
  return { source, otherSource, target, shapes, messages, sizes, listeners, penpot, bind, fileData, restart, receive: (message) => receive(message) };
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

test("inspector migrates bound sources and keeps them after layer deletion", () => {
  const harness = createHarness();
  harness.target.setPluginData("xml-binding-source", harness.otherSource.id);
  harness.listeners.selectionchange();
  assert.equal(harness.messages.at(-1).source.id, harness.otherSource.id);
  harness.shapes.delete(harness.otherSource.id);
  harness.listeners.selectionchange();
  assert.equal(harness.messages.at(-1).source.characters, "<data><name>Beta</name></data>");
  harness.target.setPluginData("xml-binding-source", "missing");
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

test("binding rejects multiple selected layers but allows the old source layer as target", () => {
  const harness = createHarness();
  harness.penpot.selection = [harness.target, harness.otherSource];
  harness.bind();
  harness.listeners.selectionchange();
  assert.equal(harness.messages.at(-1).shape, null);
  assert.equal(harness.target.characters, "Original");
  harness.penpot.selection = [harness.source];
  harness.bind({ targetId: harness.source.id });
  assert.equal(harness.source.getPluginData("xml-binding-path"), "/data/name");
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
  const xml = "<data><name>Changed</name></data>";
  harness.receive({ type: "save-source", sourceId: "source", fileId: "file", originalXml: harness.source.characters, xml });
  harness.receive({ type: "refresh-all" });
  assert.equal(harness.messages.at(-1).items[0].xml, xml);
  harness.receive({ type: "apply-values", results: [{ targetId: harness.target.id, ok: true, value: "Changed" }] });
  assert.equal(harness.target.characters, "Changed");
  harness.receive({ type: "apply-values", results: [{ targetId: harness.target.id, ok: false, error: "XPath has no matches" }] });
  assert.equal(harness.target.characters, "Changed");
  assert.equal(harness.messages.findLast((message) => message.type === "refresh-result").errors.length, 1);
  assert.equal(harness.messages.at(-1).source.characters, xml);
});

test("editor source is authoritative for selection, binding and refresh without rewriting canvas text", () => {
  const harness = createHarness();
  const originalXml = harness.source.characters;
  const xml = "<data><name>Edited</name></data>";
  harness.receive({ type: "save-source", sourceId: "source", pageId: "page", fileId: "file", originalXml, xml });
  assert.equal(harness.source.characters, originalXml);
  assert.equal(harness.messages.at(-1).source.characters, xml);
  assert.equal(harness.messages.at(-1).source.storage, "document");
  harness.source.characters = "<broken canvas text";
  harness.bind({ xml, value: "Edited" });
  assert.equal(harness.target.characters, "Edited");
  harness.receive({ type: "refresh-all" });
  assert.equal(harness.messages.at(-1).items[0].xml, xml);
});

test("editor saves reject conflicts, context changes, deleted sources and empty XML", () => {
  for (const overrides of [{ originalXml: "stale" }, { fileId: "other" }, { sourceId: "deleted" }, { xml: "" }]) {
    const harness = createHarness();
    harness.receive({ type: "save-source", sourceId: "source", pageId: "page", fileId: "file", originalXml: harness.source.characters, xml: "<data/>", ...overrides });
    assert.equal(harness.messages.at(-1).type, "source-save-error");
    assert.equal(harness.source.getPluginData("xml-binding-xml"), "");
  }
});

test("document sources work with no source layers and across page changes", () => {
  const harness = createHarness({
    fileData: { "xml-binding-default-source": "" },
    initialize: ({ penpot, shapes }) => {
      shapes.delete("source");
      shapes.delete("other-source");
      penpot.selection = [];
    },
  });
  assert.equal(harness.messages.at(-1).source, null);
  harness.receive({ type: "save-source", sourceId: "", fileId: "file", originalXml: "", name: "Orders", xml: "<orders/>" });
  const saved = harness.messages.at(-1).source;
  assert.equal(saved.name, "Orders");
  assert.match(saved.id, /^xml-/);
  harness.penpot.currentPage.id = "another-page";
  harness.receive({ type: "save-source", sourceId: saved.id, fileId: "file", originalXml: saved.characters, xml: "<orders><name>New</name></orders>" });
  harness.penpot.selection = [harness.target];
  harness.bind({ sourceId: saved.id, xml: "<orders><name>New</name></orders>", path: "/orders/name", value: "New" });
  assert.equal(harness.target.characters, "New");
  assert.equal(harness.source.getPluginData("xml-binding-xml"), "");
  harness.restart();
  assert.equal(harness.messages.at(-1).source.id, saved.id);
  assert.equal(JSON.parse(harness.fileData["xml-binding-document-sources"]).sources.length, 1);
});

test("migration covers all pages, prefers editor XML and survives reopening", () => {
  const xml = "<data><name>Stored</name></data>";
  const harness = createHarness({
    sourceData: { "xml-binding-xml": xml },
    initialize: ({ penpot, target, otherSource, shapes }) => {
      target.setPluginData("xml-binding-source", otherSource.id);
      target.setPluginData("xml-binding-path", "/data/name");
      shapes.delete(target.id);
      shapes.delete(otherSource.id);
      penpot.currentFile.pages.push({
        id: "second-page", findShapes: () => [target, otherSource],
        getShapeById: (id) => [target, otherSource].find((shape) => shape.id === id),
      });
    },
  });
  const stored = JSON.parse(harness.fileData["xml-binding-document-sources"]).sources;
  assert.equal(stored.find((source) => source.id === "source").characters, xml);
  assert.equal(stored.find((source) => source.id === "other-source").characters, harness.otherSource.characters);
  harness.penpot.currentFile.pages = [harness.penpot.currentPage];
  harness.shapes.delete("source");
  harness.restart();
  assert.equal(harness.messages.at(-1).source.id, "other-source");
  assert.equal(harness.target.getPluginData("xml-binding-path"), "/data/name");
  assert.equal(harness.source.characters, "<data><name>Alpha</name></data>");
});

test("choosing a different document source allows explicit rebinding", () => {
  const harness = createHarness();
  harness.bind();
  harness.receive({ type: "save-source", sourceId: "", fileId: "file", xml: "<data/>", name: "Other" });
  const created = harness.messages.at(-1).source;
  harness.receive({ type: "select-source", sourceId: created.id, fileId: "file" });
  assert.equal(harness.messages.at(-1).source.id, created.id);
  assert.equal(harness.target.getPluginData("xml-binding-source"), "source");
  harness.bind({ sourceId: created.id, xml: created.characters, value: "" });
  assert.equal(harness.target.getPluginData("xml-binding-source"), created.id);
});

test("corrupt or unsupported document storage is never overwritten", () => {
  for (const raw of ["not JSON", '{"version":2,"sources":[]}', '{"version":1,"sources":[null]}']) {
    const harness = createHarness({ fileData: { "xml-binding-document-sources": raw } });
    assert.equal(harness.messages.at(-1).level, "error");
    harness.receive({ type: "save-source", sourceId: "", fileId: "file", xml: "<data/>", name: "New" });
    assert.equal(harness.messages.at(-1).type, "source-save-error");
    assert.equal(harness.fileData["xml-binding-document-sources"], raw);
  }
});