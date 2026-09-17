const SOURCE_KEY = "xml-binding-source";
const PATH_KEY = "xml-binding-path";

penpot.ui.open("XML Data Binding", "index.html", {
  width: 360,
  height: 560,
});

function getSelectedText() {
  const shape = penpot.selection?.[0];
  return shape && shape.type === "text" ? shape : null;
}

function sendSelection() {
  const shape = getSelectedText();
  penpot.ui.sendMessage({
    type: "selection",
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
      xml: source?.characters ?? null,
    });
  }

  penpot.ui.sendMessage({ type: "refresh-data", items });
}

penpot.on("selectionchange", sendSelection);
sendSelection();

penpot.ui.onMessage((message) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "get-selection") {
    sendSelection();
    return;
  }

  if (message.type === "mark-source") {
    const shape = getSelectedText();
    if (!shape) {
      penpot.ui.sendMessage({ type: "status", level: "error", text: "Select a text layer first." });
      return;
    }
    penpot.currentFile?.setPluginData("xml-binding-default-source", shape.id);
    penpot.ui.sendMessage({
      type: "source-marked",
      source: { id: shape.id, name: shape.name, characters: shape.characters ?? "" },
    });
    return;
  }

  if (message.type === "get-default-source") {
    const sourceId = penpot.currentFile?.getPluginData("xml-binding-default-source") || "";
    const source = getSourceShape(sourceId);
    penpot.ui.sendMessage({
      type: "default-source",
      source: source
        ? { id: source.id, name: source.name, characters: source.characters ?? "" }
        : null,
    });
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

    target.setPluginData(SOURCE_KEY, source.id);
    target.setPluginData(PATH_KEY, message.path || "");
    penpot.ui.sendMessage({ type: "status", level: "ok", text: `Bound “${target.name}”.` });
    sendSelection();
    return;
  }

  if (message.type === "unbind") {
    const target = getSelectedText();
    if (!target) return;
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
  }
});
