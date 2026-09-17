const SOURCE_KEY = "xml-binding-source";
const PATH_KEY = "xml-binding-path";
const XML_KEY = "xml-binding-xml";
const SOURCES_KEY = "xml-binding-document-sources";
const DEFAULT_SOURCE_KEY = "xml-binding-default-source";
const ANNOTATIONS_KEY = "xml-binding-annotations";

function readSources() {
  const raw = penpot.currentFile?.getPluginData(SOURCES_KEY);
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.sources) || data.sources.some((source) =>
    !source || typeof source.id !== "string" || typeof source.name !== "string" || typeof source.characters !== "string")) {
    throw new Error("Unsupported XML source storage. Existing data was not changed.");
  }
  return data.sources;
}

function writeSources(sources) {
  penpot.currentFile.setPluginData(SOURCES_KEY, JSON.stringify({ version: 1, sources }));
}

function migrateSources() {
  if (!penpot.currentFile) return;
  const sources = readSources();
  const pages = penpot.currentFile.pages || [penpot.currentPage].filter(Boolean);
  const ids = new Set([penpot.currentFile.getPluginData(DEFAULT_SOURCE_KEY)]);
  for (const page of pages) {
    for (const shape of page.findShapes({ type: "text" })) ids.add(shape.getPluginData(SOURCE_KEY));
  }
  let changed = false;
  for (const id of ids) {
    if (!id || sources.some((source) => source.id === id)) continue;
    const shape = pages.map((page) => page.getShapeById(id)).find((shape) => shape?.type === "text");
    if (!shape) continue;
    sources.push({ id, name: shape.name, characters: shape.getPluginData(XML_KEY) || shape.characters || "" });
    changed = true;
  }
  if (changed) writeSources(sources);
}

penpot.ui.open("XPath Inspector", `index.html?refresh=${Date.now()}`, {
  width: 360,
  height: 560,
});

function getSelectedText() {
  const shape = getSelectedShape();
  return shape?.type === "text" ? shape : null;
}

function getSelectedShape() {
  if (penpot.selection?.length !== 1) return null;
  return penpot.selection[0] || null;
}

function readAnnotations(shape) {
  const raw = shape?.getPluginData(ANNOTATIONS_KEY) || "";
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.entries) || data.entries.some((entry) =>
    !entry || [entry.id, entry.sourceId, entry.path, entry.remark].some((value) => typeof value !== "string" || !value.trim())) ||
    new Set(data.entries.map((entry) => entry.id)).size !== data.entries.length) {
    throw new Error("Unsupported XPath annotations. Existing data was not changed.");
  }
  return data.entries;
}

function sendSelection(preferredSourceId) {
  const shape = getSelectedShape();
  let annotations;
  try {
    migrateSources();
    annotations = shape?.type !== "text" ? readAnnotations(shape) : [];
  } catch (error) {
    penpot.ui.sendMessage({ type: "status", level: "error", text: error.message || String(error) });
    return;
  }
  const sourceId = (typeof preferredSourceId === "string" && preferredSourceId) || shape?.getPluginData(SOURCE_KEY) || annotations[0]?.sourceId || penpot.currentFile?.getPluginData(DEFAULT_SOURCE_KEY) || "";
  const source = getSource(sourceId);
  penpot.ui.sendMessage({
    type: "selection",
    pageId: penpot.currentPage?.id,
    fileId: penpot.currentFile?.id,
    sources: readSources().map(({ id, name }) => ({ id, name })),
    source: source ? { ...source, storage: "document" } : null,
    shape: shape
      ? {
          id: shape.id,
          name: shape.name,
          type: shape.type,
          annotations,
          annotationsRaw: shape.getPluginData(ANNOTATIONS_KEY) || "",
          characters: shape.characters ?? "",
          sourceId: shape.getPluginData(SOURCE_KEY) || "",
          path: shape.getPluginData(PATH_KEY) || "",
        }
      : null,
  });
}

function getSource(sourceId) {
  return readSources().find((source) => source.id === sourceId) || null;
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

    const source = getSource(sourceId);
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
penpot.on("pagechange", sendSelection);
penpot.on("filechange", sendSelection);
sendSelection();

function handleMessage(message) {
  if (!message || typeof message !== "object") return;

  if (message.type === "get-selection") {
    sendSelection();
    return;
  }

  if (message.type === "editor-size") {
    penpot.ui.resize(message.expanded ? 640 : 360, message.expanded ? 680 : 560);
    return;
  }

  if (message.type === "select-source") {
    if (message.fileId !== penpot.currentFile?.id || !getSource(message.sourceId)) return;
    penpot.currentFile.setPluginData(DEFAULT_SOURCE_KEY, message.sourceId);
    sendSelection(message.sourceId);
    return;
  }

  if (message.type === "save-source") {
    const fail = (text) => penpot.ui.sendMessage({ type: "source-save-error", text });
    if (!penpot.currentFile || message.fileId !== penpot.currentFile.id) {
      fail("The source file changed. Reopen the editor.");
      return;
    }
    const source = getSource(message.sourceId);
    if (message.sourceId && !source) {
      fail("XML source not found. Your draft has not been saved.");
      return;
    }
    if (source && (source.characters !== message.originalXml || (typeof message.originalName === "string" && source.name !== message.originalName))) {
      fail("The source changed since the editor was opened. Your draft has not been saved.");
      return;
    }
    if (typeof message.xml !== "string" || !message.xml.trim()) {
      fail("XML must not be empty.");
      return;
    }
    try {
      const sources = readSources();
      const id = source?.id || `xml-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const name = typeof message.name === "string" && message.name.trim() ? message.name.trim() : source?.name || "XML source";
      const saved = { id, name, characters: message.xml };
      writeSources(source ? sources.map((item) => item.id === id ? saved : item) : [...sources, saved]);
      if (!source) penpot.currentFile.setPluginData(DEFAULT_SOURCE_KEY, id);
      penpot.ui.sendMessage({ type: "source-saved", sourceId: id, originalSourceId: message.sourceId || "" });
      sendSelection(id);
    } catch (error) {
      fail(error.message || String(error));
    }
    return;
  }

  if (message.type === "save-annotation" || message.type === "delete-annotation") {
    const target = getSelectedShape();
    const fail = (text) => penpot.ui.sendMessage({ type: "status", level: "error", text });
    if (!target || target.type === "text" || target.id !== message.targetId ||
      !penpot.currentFile || message.fileId !== penpot.currentFile.id || message.pageId !== penpot.currentPage?.id) {
      fail("Select the original non-text layer and try again.");
      return;
    }
    if ((target.getPluginData(ANNOTATIONS_KEY) || "") !== message.originalAnnotations) {
      fail("XPath annotations changed. Reload before saving again.");
      return;
    }
    const entries = readAnnotations(target);
    const index = entries.findIndex((entry) => entry.id === message.annotationId);
    if (message.annotationId && index === -1) {
      fail("XPath annotation no longer exists. Reload before saving again.");
      return;
    }
    if (message.type === "delete-annotation") {
      if (index === -1) return;
      entries.splice(index, 1);
    } else {
      const source = getSource(message.sourceId);
      if (!source || source.characters !== message.xml) {
        fail("XML source changed or is missing. Reload before saving again.");
        return;
      }
      if (typeof message.path !== "string" || !message.path.trim() || typeof message.remark !== "string" || !message.remark.trim()) {
        fail("XPath and remark are required.");
        return;
      }
      const entry = {
        id: index === -1 ? `note-${Date.now()}-${Math.random().toString(36).slice(2)}` : entries[index].id,
        sourceId: source.id, path: message.path.trim(), remark: message.remark.trim(),
      };
      if (index === -1) entries.push(entry);
      else entries[index] = entry;
    }
    target.setPluginData(ANNOTATIONS_KEY, JSON.stringify({ version: 1, entries }));
    penpot.ui.sendMessage({ type: "annotation-saved", targetId: target.id });
    sendSelection(message.sourceId);
    return;
  }

  if (message.type === "bind") {
    const target = getSelectedText();
    const source = getSource(message.sourceId);
    if (!target || !source) {
      penpot.ui.sendMessage({ type: "status", level: "error", text: "Select a target text layer and a valid XML source." });
      return;
    }
    if (target.id !== message.targetId || source.characters !== message.xml) {
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
}

penpot.ui.onMessage((message) => {
  try {
    handleMessage(message);
  } catch (error) {
    penpot.ui.sendMessage({ type: message.type === "save-source" ? "source-save-error" : "status", level: "error", text: error.message || String(error) });
  }
});
