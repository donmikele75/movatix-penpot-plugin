const SOURCE_KEY = "xml-binding-source";
const PATH_KEY = "xml-binding-path";
const XML_KEY = "xml-binding-xml";

function getSourceXml(shape) {
  return shape.getPluginData(XML_KEY) || shape.characters || "";
}

penpot.ui.open("XPath Inspector", `index.html?refresh=${Date.now()}`, {
  width: 360,
  height: 560,
});

function getSelectedText() {
  if (penpot.selection?.length !== 1) return null;
  const shape = penpot.selection?.[0];
  return shape && shape.type === "text" ? shape : null;
}

function sendSelection() {
  const shape = getSelectedText();
  const sourceId = shape?.getPluginData(SOURCE_KEY) || penpot.currentFile?.getPluginData("xml-binding-default-source") || "";
  const source = getSourceShape(sourceId);
  penpot.ui.sendMessage({
    type: "selection",
    pageId: penpot.currentPage?.id,
    fileId: penpot.currentFile?.id,
    source: source ? { id: source.id, name: source.name, characters: getSourceXml(source), storage: source.getPluginData(XML_KEY) ? "plugin" : "layer" } : null,
    shape: shape
      ? {
          id: shape.id,
          name: shape.name,
          characters: shape.characters ?? "",
          sourceId: shape.getPluginData(SOURCE_KEY) || "",
          path: shape.getPluginData(PATH_KEY) || "",
        }
      : null,
  });
}

function getSourceShape(sourceId) {
  const page = penpot.currentPage;
  if (!page || !sourceId) return null;
  const shape = page.getShapeById(sourceId);
  return shape && shape.type === "text" ? shape : null;
}

function allTextShapes() {
  const page = penpot.currentPage;
  return page ? page.findShapes({ type: "text" }) : [];
}

function refreshAll() {
  const items = [];
  for (const shape of allTextShapes()) {
    const sourceId = shape.getPluginData(SOURCE_KEY);
    const path = shape.getPluginData(PATH_KEY);
    if (!sourceId || !path) continue;

    const source = getSourceShape(sourceId);
    items.push({
      targetId: shape.id,
      targetName: shape.name,
      sourceId,
      path,
      xml: source ? getSourceXml(source) : null,
    });
  }

  penpot.ui.sendMessage({ type: "refresh-data", items });
}

penpot.on("selectionchange", sendSelection);
penpot.on("pagechange", sendSelection);
penpot.on("filechange", sendSelection);
sendSelection();

penpot.ui.onMessage((message) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "get-selection") {
    sendSelection();
    return;
  }

  if (message.type === "editor-size") {
    penpot.ui.resize(message.expanded ? 640 : 360, message.expanded ? 680 : 560);
    return;
  }

  if (message.type === "mark-source") {
    const shape = getSelectedText();
    if (!shape) {
      penpot.ui.sendMessage({ type: "status", level: "error", text: "Select a text layer first." });
      return;
    }
    penpot.currentFile?.setPluginData("xml-binding-default-source", shape.id);
    sendSelection();
    return;
  }

  if (message.type === "save-source") {
    const source = getSourceShape(message.sourceId);
    const fail = (text) => penpot.ui.sendMessage({ type: "source-save-error", text });
    if (!source || message.pageId !== penpot.currentPage?.id || message.fileId !== penpot.currentFile?.id) {
      fail("The source page or file changed, or the source was deleted. Reopen the editor.");
      return;
    }
    if (getSourceXml(source) !== message.originalXml) {
      fail("The source changed since the editor was opened. Your draft has not been saved.");
      return;
    }
    if (typeof message.xml !== "string" || !message.xml.trim()) {
      fail("XML must not be empty.");
      return;
    }
    try {
      source.setPluginData(XML_KEY, message.xml);
      penpot.ui.sendMessage({ type: "source-saved", sourceId: source.id });
      sendSelection();
    } catch (error) {
      fail(error.message || String(error));
    }
    return;
  }

  if (message.type === "bind") {
    const target = getSelectedText();
    const source = getSourceShape(message.sourceId);
    if (!target || !source) {
      penpot.ui.sendMessage({ type: "status", level: "error", text: "Select a target text layer and a valid XML source." });
      return;
    }
    if (target.id === source.id) {
      penpot.ui.sendMessage({ type: "status", level: "error", text: "Source and target must be different layers." });
      return;
    }

    if (target.id !== message.targetId || getSourceXml(source) !== message.xml) {
      penpot.ui.sendMessage({ type: "status", level: "error", text: "Selection or XML changed. Reload and apply again." });
      sendSelection();
      return;
    }
    if (typeof message.path !== "string" || !message.path.trim() || typeof message.value !== "string") return;
    target.setPluginData(SOURCE_KEY, source.id);
    target.setPluginData(PATH_KEY, message.path.trim());
    target.characters = message.value;
    penpot.ui.sendMessage({ type: "status", level: "ok", text: `Bound “${target.name}”.` });
    sendSelection();
    return;
  }

  if (message.type === "unbind") {
    const target = getSelectedText();
    if (!target || target.id !== message.targetId) return;
    target.setPluginData(SOURCE_KEY, "");
    target.setPluginData(PATH_KEY, "");
    penpot.ui.sendMessage({ type: "status", level: "ok", text: `Removed binding from “${target.name}”.` });
    sendSelection();
    return;
  }

  if (message.type === "refresh-all") {
    refreshAll();
    return;
  }

  if (message.type === "apply-values") {
    let updated = 0;
    const errors = [];
    const page = penpot.currentPage;
    if (!page) return;

    for (const result of message.results || []) {
      const target = page.getShapeById(result.targetId);
      if (!target || target.type !== "text") continue;
      if (result.ok) {
        target.characters = String(result.value ?? "");
        updated += 1;
      } else {
        errors.push(`${target.name}: ${result.error}`);
      }
    }

    penpot.ui.sendMessage({
      type: "refresh-result",
      updated,
      errors,
    });
    sendSelection();
  }
});
