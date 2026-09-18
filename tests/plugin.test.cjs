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
  assert.equal(context.nodeSetXPath(second), "/data/item");
  assert.equal(context.nodeSetXPath(namespaced), "/data/*[local-name()='item' and namespace-uri()='urn:test']");
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
  const shapes = new Map();
  let cloneCounter = 0;
  function cloneShape(shape) {
    cloneCounter += 1;
    const id = `${shape.id}-clone-${cloneCounter}`;
    const data = {};
    const clone = {
      id, name: shape.name, type: shape.type, x: shape.x, y: shape.y, height: shape.height,
      characters: shape.characters, fills: shape.fills ? [...shape.fills] : undefined,
      children: shape.children ? shape.children.map((child) => cloneShape(child)) : undefined,
      getPluginData: (key) => data[key] || "",
      setPluginData: (key, value) => { data[key] = value; },
      remove: () => {
        shapes.delete(id);
        if (clone.parent?.children) {
          const index = clone.parent.children.indexOf(clone);
          if (index !== -1) clone.parent.children.splice(index, 1);
        }
      },
    };
    for (const child of clone.children || []) child.parent = clone;
    clone.clone = () => cloneShape(clone);
    shapes.set(id, clone);
    return clone;
  }
  function createShape(id, characters, data = {}, type = "text") {
    const shape = {
      id, name: id, type, characters,
      fills: type === "rectangle" ? [] : undefined,
      getPluginData: (key) => data[key] || "",
      setPluginData: (key, value) => { data[key] = value; },
      remove: () => shapes.delete(id),
    };
    shape.clone = () => cloneShape(shape);
    shapes.set(id, shape);
    return shape;
  }
  function createRectangle(id, data = {}) {
    return createShape(id, "", data, "rectangle");
  }
  const source = createShape("source", "<data><name>Alpha</name></data>", options.sourceData);
  const otherSource = createShape("other-source", "<data><name>Beta</name></data>");
  const target = createShape("target", "Original");
  function createBoard(id, children, position = { x: 0, y: 0, height: 100 }) {
    const data = {};
    const board = { id, name: id, type: "board", children, ...position };
    board.getPluginData = (key) => data[key] || "";
    board.setPluginData = (key, value) => { data[key] = value; };
    board.remove = () => shapes.delete(id);
    board.clone = () => cloneShape(board);
    board.appendChild = (child) => {
      board.children.push(child);
      child.parent = board;
      shapes.set(child.id, child);
    };
    const registerTree = (shape) => {
      shapes.set(shape.id, shape);
      for (const child of shape.children || []) {
        child.parent = shape;
        registerTree(child);
      }
    };
    registerTree(board);
    return board;
  }
  const messages = [];
  const sizes = [];
  const listeners = {};
  const uploadCalls = [];
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
    uploadMediaData: async (name, bytes, mimeType) => {
      uploadCalls.push({ name, bytes, mimeType });
      return { id: `media-${uploadCalls.length}`, width: 10, height: 10, mtype: mimeType, data: async () => bytes };
    },
  };
  penpot.currentFile.pages = [penpot.currentPage];
  options.initialize?.({ penpot, target, source, otherSource, shapes, createBoard, createShape, createRectangle });
  const restart = () => vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../plugin.js"), "utf8"), { penpot });
  restart();
  const bind = (overrides = {}) => receive({
    type: "bind", targetId: target.id, sourceId: source.id,
    xml: source.characters, path: "/data/name", value: "Alpha", ...overrides,
  });
  return { source, otherSource, target, shapes, messages, sizes, listeners, penpot, bind, fileData, restart, createBoard, createShape, createRectangle, uploadCalls, receive: (message) => receive(message) };
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

test("non-text layers persist multiple XPath remarks, edit and delete without changing appearance", () => {
  for (const type of ["rect", "circle", "path", "image", "group", "board", "bool"]) {
    const harness = createHarness({ initialize: ({ target }) => { target.type = type; } });
    const save = (overrides = {}) => harness.receive({
      type: "save-annotation", targetId: "target", fileId: "file", pageId: "page", sourceId: "source",
      xml: harness.source.characters, path: "/data/name", remark: " Required name ",
      originalAnnotations: harness.target.getPluginData("xml-binding-annotations"), ...overrides,
    });
    assert.equal(harness.messages.at(-1).shape.type, type);
    save();
    save({ path: "count(/data/name)", remark: "Number of names" });
    let entries = harness.messages.at(-1).shape.annotations;
    assert.equal(entries.length, 2);
    assert.equal(entries[0].remark, "Required name");
    const id = entries[0].id;
    save({ annotationId: id, remark: "Updated" });
    harness.restart();
    entries = harness.messages.at(-1).shape.annotations;
    assert.equal(entries.length, 2);
    assert.equal(entries[0].id, id);
    assert.equal(entries[0].remark, "Updated");
    harness.receive({ type: "delete-annotation", targetId: "target", fileId: "file", pageId: "page", annotationId: id, originalAnnotations: harness.target.getPluginData("xml-binding-annotations") });
    assert.equal(harness.messages.at(-1).shape.annotations.length, 1);
    assert.equal(harness.target.characters, "Original");
    assert.equal(harness.target.getPluginData("xml-binding-path"), "");
  }
});

test("XPath remarks reject empty values, stale context and conflicting writes", () => {
  const harness = createHarness({ initialize: ({ target }) => { target.type = "rect"; } });
  const message = { type: "save-annotation", targetId: "target", fileId: "file", pageId: "page", sourceId: "source", xml: harness.source.characters, path: "/data/name", remark: "Name", originalAnnotations: "" };
  for (const override of [{ remark: " " }, { path: "" }, { targetId: "other" }, { fileId: "other" }, { pageId: "other" }, { xml: "stale" }, { sourceId: "missing" }, { annotationId: "missing" }]) {
    harness.receive({ ...message, ...override });
    assert.equal(harness.target.getPluginData("xml-binding-annotations"), "");
  }
  harness.penpot.selection = [harness.target, harness.source];
  harness.receive(message);
  assert.equal(harness.target.getPluginData("xml-binding-annotations"), "");
  harness.penpot.selection = [harness.target];
  harness.receive(message);
  const saved = harness.target.getPluginData("xml-binding-annotations");
  harness.receive(message);
  assert.equal(harness.target.getPluginData("xml-binding-annotations"), saved);
  harness.target.type = "text";
  harness.receive({ ...message, originalAnnotations: saved });
  assert.equal(harness.target.getPluginData("xml-binding-annotations"), saved);
  harness.target.type = "rect";
  harness.target.setPluginData("xml-binding-annotations", '{"version":2,"entries":[]}');
  harness.receive({ ...message, originalAnnotations: '{"version":2,"entries":[]}' });
  assert.equal(harness.target.getPluginData("xml-binding-annotations"), '{"version":2,"entries":[]}');
});

test("a saved remark can be updated in place without changing its XPath or source", () => {
  const harness = createHarness({ initialize: ({ target }) => { target.type = "rect"; } });
  harness.receive({ type: "save-annotation", targetId: "target", fileId: "file", pageId: "page", sourceId: "source", xml: harness.source.characters, path: "/data/name", remark: "Initial", originalAnnotations: "" });
  const stored = () => JSON.parse(harness.target.getPluginData("xml-binding-annotations"));
  const id = stored().entries[0].id;
  harness.receive({ type: "update-annotation-remark", targetId: "target", fileId: "file", pageId: "page", annotationId: id, remark: " Updated remark ", originalAnnotations: harness.target.getPluginData("xml-binding-annotations") });
  const entry = stored().entries[0];
  assert.equal(entry.remark, "Updated remark");
  assert.equal(entry.path, "/data/name");
  assert.equal(entry.sourceId, "source");
  assert.equal(harness.messages.at(-1).shape.annotations[0].remark, "Updated remark");
});

test("remark updates reject empty values, stale context, unknown ids and text layers", () => {
  const harness = createHarness({ initialize: ({ target }) => { target.type = "rect"; } });
  harness.receive({ type: "save-annotation", targetId: "target", fileId: "file", pageId: "page", sourceId: "source", xml: harness.source.characters, path: "/data/name", remark: "Initial", originalAnnotations: "" });
  const snapshot = harness.target.getPluginData("xml-binding-annotations");
  const id = JSON.parse(snapshot).entries[0].id;
  const message = { type: "update-annotation-remark", targetId: "target", fileId: "file", pageId: "page", annotationId: id, remark: "Changed", originalAnnotations: snapshot };
  for (const override of [{ remark: " " }, { annotationId: "missing" }, { targetId: "other" }, { fileId: "other" }, { pageId: "other" }, { originalAnnotations: "stale" }]) {
    harness.receive({ ...message, ...override });
    assert.equal(harness.target.getPluginData("xml-binding-annotations"), snapshot);
  }
  harness.target.type = "text";
  harness.receive(message);
  assert.equal(harness.target.getPluginData("xml-binding-annotations"), snapshot);
});

function createRepeaterHarness() {
  const xml = "<data><items><item><name>First</name></item><item><name>Second</name></item><item><name>Third</name></item></items></data>";
  let container;
  const harness = createHarness({
    initialize: ({ source, createBoard, createShape, penpot }) => {
      source.characters = xml;
      const label = createShape("label", "Template", { "xml-binding-source": "source", "xml-binding-path": "./name" });
      label.x = 0; label.y = 0; label.height = 20;
      const sub = createShape("sub", "Template", { "xml-binding-source": "source", "xml-binding-path": "./name" });
      const note = createBoard("note", [sub], { x: 0, y: 30, height: 40 });
      container = createBoard("board", [label, note], { x: 10, y: 20, height: 100 });
      penpot.selection = [container];
    },
  });
  const apply = (overrides = {}) => harness.receive({
    type: "apply-repeater", targetId: "board", fileId: "file", pageId: "page",
    sourceId: "source", xml, path: "/data/items/item",
    instances: [
      { values: { label: "First", sub: "First" } },
      { values: { label: "Second", sub: "Second" } },
      { values: { label: "Third", sub: "Third" } },
    ],
    ...overrides,
  });
  return { ...harness, board: () => container, xml, apply };
}

test("apply-repeater clones every direct child of the container as a group per matched node", async () => {
  const harness = createRepeaterHarness();
  await harness.apply();
  const container = harness.board();
  assert.equal(harness.shapes.get("label").characters, "First");
  assert.equal(harness.shapes.get("sub").characters, "First");

  const instanceIds = JSON.parse(container.getPluginData("xml-binding-repeater-instances"));
  assert.equal(instanceIds.length, 4);

  const noteClones = container.children.filter((child) => child.type === "board" && child.id !== "note").sort((a, b) => a.y - b.y);
  const labelClones = container.children.filter((child) => child.type === "text" && child.id !== "label").sort((a, b) => a.y - b.y);
  assert.equal(noteClones.length, 2);
  assert.equal(labelClones.length, 2);

  const rowHeight = 70; // combined bounds across label (0..20) and note (30..70)
  assert.equal(labelClones[0].y, 0 + 1 * (rowHeight + 24));
  assert.equal(labelClones[1].y, 0 + 2 * (rowHeight + 24));
  assert.equal(noteClones[0].y, 30 + 1 * (rowHeight + 24));
  assert.equal(noteClones[1].y, 30 + 2 * (rowHeight + 24));
  assert.equal(labelClones[0].characters, "Second");
  assert.equal(labelClones[1].characters, "Third");
  assert.equal(noteClones[0].children[0].characters, "Second");
  assert.equal(noteClones[1].children[0].characters, "Third");

  assert.deepEqual(JSON.parse(container.getPluginData("xml-binding-repeater")), { version: 1, sourceId: "source", path: "/data/items/item" });
  assert.equal(harness.messages.at(-1).shape.repeater.path, "/data/items/item");
  assert.deepEqual(harness.messages.at(-1).shape.repeaterFields.map((field) => field.id), ["label", "sub"]);
});

test("re-applying a repeater removes previously generated instances before creating new ones", async () => {
  const harness = createRepeaterHarness();
  await harness.apply();
  const firstRoundIds = JSON.parse(harness.board().getPluginData("xml-binding-repeater-instances"));
  await harness.apply({ instances: [{ values: { label: "Only", sub: "Only" } }] });
  for (const id of firstRoundIds) assert.equal(harness.shapes.has(id), false);
  assert.equal(JSON.parse(harness.board().getPluginData("xml-binding-repeater-instances")).length, 0);
  assert.equal(harness.board().children.length, 2);
  assert.equal(harness.shapes.get("label").characters, "Only");
  assert.equal(harness.shapes.get("sub").characters, "Only");
});

test("apply-repeater rejects wrong target, stale XML, missing path and non-array instances", async () => {
  const harness = createRepeaterHarness();
  for (const overrides of [
    { targetId: "other" }, { fileId: "other" }, { pageId: "other" },
    { xml: "stale" }, { path: "" }, { instances: "not-an-array" },
  ]) {
    await harness.apply(overrides);
    assert.equal(harness.board().getPluginData("xml-binding-repeater"), "");
  }
});

test("apply-repeater works on a container that is not the current selection (bulk refresh)", async () => {
  const harness = createRepeaterHarness();
  harness.penpot.selection = [harness.target];
  await harness.apply();
  assert.equal(JSON.parse(harness.board().getPluginData("xml-binding-repeater")).path, "/data/items/item");
  assert.equal(harness.shapes.get("label").characters, "First");
});

test("remove-repeater clears the configuration and deletes generated clones", async () => {
  const harness = createRepeaterHarness();
  await harness.apply();
  const instanceIds = JSON.parse(harness.board().getPluginData("xml-binding-repeater-instances"));
  harness.receive({ type: "remove-repeater", targetId: "board", fileId: "file", pageId: "page" });
  assert.equal(harness.board().getPluginData("xml-binding-repeater"), "");
  assert.equal(harness.board().getPluginData("xml-binding-repeater-instances"), "");
  for (const id of instanceIds) assert.equal(harness.shapes.has(id), false);
  assert.equal(harness.board().children.length, 2);
  assert.equal(harness.shapes.get("label").characters, "First");
});

test("corrupt repeater configuration is reported and never overwritten", () => {
  const harness = createRepeaterHarness();
  harness.board().setPluginData("xml-binding-repeater", '{"version":2}');
  harness.listeners.selectionchange();
  assert.match(harness.messages.at(-1).text, /Unsupported repeater configuration/);
  assert.equal(harness.board().getPluginData("xml-binding-repeater"), '{"version":2}');
});

test("refresh-all includes repeater containers with template fields for regeneration", async () => {
  const harness = createRepeaterHarness();
  await harness.apply();
  harness.receive({ type: "refresh-all" });
  const message = harness.messages.at(-1);
  assert.equal(message.type, "refresh-data");
  const repeater = message.repeaters.find((entry) => entry.containerId === "board");
  assert.ok(repeater);
  assert.equal(repeater.sourceId, "source");
  assert.equal(repeater.path, "/data/items/item");
  assert.equal(repeater.xml, harness.xml);
  assert.deepEqual(repeater.fields.map((field) => field.id), ["label", "sub"]);
});

test("a text layer inside a repeater container reports the ancestor repeater config for context-aware preview", async () => {
  const harness = createRepeaterHarness();
  await harness.apply();
  const label = harness.shapes.get("label");
  harness.penpot.selection = [label];
  harness.listeners.selectionchange();
  assert.equal(JSON.stringify(harness.messages.at(-1).shape.ancestorRepeater), JSON.stringify({ version: 1, sourceId: "source", path: "/data/items/item" }));
  assert.equal(harness.messages.at(-1).shape.ancestorContainerId, "board");
});

test("a text layer nested two levels below the repeater container also reports the ancestor repeater config", async () => {
  const harness = createRepeaterHarness();
  await harness.apply();
  const sub = harness.shapes.get("sub");
  harness.penpot.selection = [sub];
  harness.listeners.selectionchange();
  assert.equal(JSON.stringify(harness.messages.at(-1).shape.ancestorRepeater), JSON.stringify({ version: 1, sourceId: "source", path: "/data/items/item" }));
});

test("a text layer outside any repeater board reports no ancestor repeater", () => {
  const harness = createHarness({ initialize: ({ target }) => { target.type = "text"; } });
  harness.listeners.selectionchange();
  assert.equal(harness.messages.at(-1).shape.ancestorRepeater, null);
  assert.equal(harness.messages.at(-1).shape.ancestorContainerId, null);
});

test("a text layer inside a not-yet-generated container reports the container id but no ancestor repeater", () => {
  const harness = createRepeaterHarness();
  const label = harness.shapes.get("label");
  harness.penpot.selection = [label];
  harness.listeners.selectionchange();
  assert.equal(harness.messages.at(-1).shape.ancestorRepeater, null);
  assert.equal(harness.messages.at(-1).shape.ancestorContainerId, "board");
});

test("the original template text layers report isRepeaterClone false, generated instances report it true", async () => {
  const harness = createRepeaterHarness();
  await harness.apply();
  const container = harness.board();

  harness.penpot.selection = [harness.shapes.get("label")];
  harness.listeners.selectionchange();
  assert.equal(harness.messages.at(-1).shape.isRepeaterClone, false);

  harness.penpot.selection = [harness.shapes.get("sub")];
  harness.listeners.selectionchange();
  assert.equal(harness.messages.at(-1).shape.isRepeaterClone, false);

  const labelClone = container.children.find((child) => child.type === "text" && child.id !== "label");
  harness.penpot.selection = [labelClone];
  harness.listeners.selectionchange();
  assert.equal(harness.messages.at(-1).shape.isRepeaterClone, true);

  const noteClone = container.children.find((child) => child.type === "board" && child.id !== "note");
  const subClone = noteClone.children[0];
  harness.penpot.selection = [subClone];
  harness.listeners.selectionchange();
  assert.equal(harness.messages.at(-1).shape.isRepeaterClone, true);
});

test("bind rejects a target that is a generated repeater instance and leaves it unchanged", async () => {
  const harness = createRepeaterHarness();
  await harness.apply();
  const container = harness.board();
  const labelClone = container.children.find((child) => child.type === "text" && child.id !== "label");
  const before = labelClone.characters;
  harness.penpot.selection = [labelClone];
  harness.receive({
    type: "bind", targetId: labelClone.id, sourceId: "source",
    xml: harness.xml, path: "./name", value: "Hacked",
  });
  assert.match(harness.messages.findLast((message) => message.type === "status").text, /generated repeater instance/);
  assert.equal(labelClone.characters, before);
  assert.equal(labelClone.getPluginData("xml-binding-path"), "");
});

function createPictureHarness() {
  const xml = "<data><photo>AAAA</photo></data>";
  const harness = createHarness({
    initialize: ({ source, createRectangle, penpot }) => {
      source.characters = xml;
      const rectangle = createRectangle("rectangle");
      penpot.selection = [rectangle];
    },
  });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const base64 = Buffer.from(jpeg).toString("base64");
  return { ...harness, xml, base64 };
}

test("apply-picture uploads and sets an image fill on a rectangle from resolved base64", async () => {
  const harness = createPictureHarness();
  const rectangle = harness.shapes.get("rectangle");
  await harness.receive({
    type: "apply-picture", targetId: "rectangle", sourceId: "source",
    xml: harness.xml, path: "/data/photo", value: harness.base64,
  });
  assert.equal(harness.uploadCalls.length, 1);
  assert.equal(harness.uploadCalls[0].mimeType, "image/jpeg");
  assert.equal(rectangle.fills.length, 1);
  assert.equal(rectangle.fills[0].fillImage.mtype, "image/jpeg");
  assert.equal(rectangle.getPluginData("xml-binding-source"), "source");
  assert.equal(rectangle.getPluginData("xml-binding-path"), "/data/photo");
});

test("apply-picture rejects invalid or unrecognized image data without uploading", async () => {
  const harness = createPictureHarness();
  const rectangle = harness.shapes.get("rectangle");
  await harness.receive({
    type: "apply-picture", targetId: "rectangle", sourceId: "source",
    xml: harness.xml, path: "/data/photo", value: "not-base64-image-data!!",
  });
  assert.equal(harness.uploadCalls.length, 0);
  assert.equal(rectangle.fills.length, 0);
  assert.match(harness.messages.findLast((message) => message.type === "status").text, /Invalid base64 image data|Unsupported or unrecognized image format/);
});

test("identical image values across repeater instances are uploaded only once", async () => {
  const xml = "<data><items><item><photo>same</photo></item><item><photo>same</photo></item></items></data>";
  let container;
  const harness = createHarness({
    initialize: ({ source, createBoard, createRectangle, penpot }) => {
      source.characters = xml;
      const rectangle = createRectangle("picture", { "xml-binding-source": "source", "xml-binding-path": "./photo" });
      rectangle.x = 0; rectangle.y = 0; rectangle.height = 20;
      container = createBoard("board", [rectangle], { x: 0, y: 0, height: 20 });
      penpot.selection = [container];
    },
  });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const base64 = Buffer.from(jpeg).toString("base64");
  await harness.receive({
    type: "apply-repeater", targetId: "board", fileId: "file", pageId: "page",
    sourceId: "source", xml, path: "/data/items/item",
    instances: [{ values: { picture: base64 } }, { values: { picture: base64 } }],
  });
  assert.equal(harness.uploadCalls.length, 1);
  const clone = container.children.find((child) => child.id !== "picture");
  assert.equal(clone.fills[0].fillImage.mtype, "image/jpeg");
});

test("a picture layer that is a generated repeater instance rejects direct editing", async () => {
  const xml = "<data><items><item><photo>same</photo></item><item><photo>same</photo></item></items></data>";
  let container;
  const harness = createHarness({
    initialize: ({ source, createBoard, createRectangle, penpot }) => {
      source.characters = xml;
      const rectangle = createRectangle("picture", { "xml-binding-source": "source", "xml-binding-path": "./photo" });
      rectangle.x = 0; rectangle.y = 0; rectangle.height = 20;
      container = createBoard("board", [rectangle], { x: 0, y: 0, height: 20 });
      penpot.selection = [container];
    },
  });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  const base64 = Buffer.from(jpeg).toString("base64");
  await harness.receive({
    type: "apply-repeater", targetId: "board", fileId: "file", pageId: "page",
    sourceId: "source", xml, path: "/data/items/item",
    instances: [{ values: { picture: base64 } }, { values: { picture: base64 } }],
  });
  const clone = container.children.find((child) => child.id !== "picture");
  harness.penpot.selection = [clone];
  await harness.receive({
    type: "apply-picture", targetId: clone.id, sourceId: "source",
    xml, path: "./photo", value: base64,
  });
  assert.match(harness.messages.findLast((message) => message.type === "status").text, /generated repeater instance/);
  assert.equal(clone.getPluginData("xml-binding-path"), "");
});