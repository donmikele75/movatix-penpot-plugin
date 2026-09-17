const SOURCE_KEY = "xml-binding-source";
const PATH_KEY = "xml-binding-path";
const XML_KEY = "xml-binding-xml";
const SOURCES_KEY = "xml-binding-document-sources";
const DEFAULT_SOURCE_KEY = "xml-binding-default-source";
const ANNOTATIONS_KEY = "xml-binding-annotations";
const REPEATER_KEY = "xml-binding-repeater";
const REPEATER_INSTANCES_KEY = "xml-binding-repeater-instances";
const REPEATER_GAP = 24;

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

function collectTextLayers(shape, list = []) {
  if (shape.type === "text") {
    list.push(shape);
    return list;
  }
  for (const child of shape.children || []) collectTextLayers(child, list);
  return list;
}

function readRepeater(shape) {
  const raw = shape?.getPluginData(REPEATER_KEY) || "";
  if (!raw) return null;
  const data = JSON.parse(raw);
  if (data.version !== 1 || typeof data.sourceId !== "string" || !data.sourceId.trim() || typeof data.path !== "string" || !data.path.trim()) {
    throw new Error("Unsupported repeater configuration. Existing data was not changed.");
  }
  return data;
}

function readRepeaterInstanceIds(shape) {
  const raw = shape?.getPluginData(REPEATER_INSTANCES_KEY) || "";
  if (!raw) return [];
  const ids = JSON.parse(raw);
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new Error("Unsupported repeater instance list. Existing data was not changed.");
  }
  return ids;
}

function templateChildrenOf(container) {
  const instanceIds = new Set(readRepeaterInstanceIds(container));
  return (container.children || []).filter((child) => !instanceIds.has(child.id));
}

function findAncestorRepeater(shape) {
  let node = shape?.parent || null;
  while (node) {
    if (node.type === "board") {
      const repeater = readRepeater(node);
      if (repeater) return repeater;
    }
    node = node.parent || null;
  }
  return null;
}

function findAncestorContainerId(shape) {
  let node = shape?.parent || null;
  while (node) {
    if (node.type === "board") return node.id;
    node = node.parent || null;
  }
  return null;
}

function sendSelection(preferredSourceId) {
  const shape = getSelectedShape();
  let annotations;
  let repeater = null;
  let repeaterFields = [];
  let ancestorRepeater = null;
  let ancestorContainerId = null;
  try {
    migrateSources();
    annotations = shape?.type !== "text" ? readAnnotations(shape) : [];
    if (shape?.type === "board") {
      repeater = readRepeater(shape);
      repeaterFields = templateChildrenOf(shape).flatMap((child) => collectTextLayers(child)).map((child) => ({ id: child.id, name: child.name, path: child.getPluginData(PATH_KEY) || "" }));
    }
    if (shape?.type === "text") {
      ancestorRepeater = findAncestorRepeater(shape);
      ancestorContainerId = findAncestorContainerId(shape);
    }
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
          repeater,
          repeaterFields,
          ancestorRepeater,
          ancestorContainerId,
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

  const repeaters = [];
  const page = penpot.currentPage;
  if (page) {
    for (const container of page.findShapes({ type: "board" })) {
      let repeater;
      try {
        repeater = readRepeater(container);
      } catch {
        continue;
      }
      if (!repeater) continue;
      const source = getSource(repeater.sourceId);
      const fields = templateChildrenOf(container).flatMap((child) => collectTextLayers(child))
        .filter((field) => field.getPluginData(PATH_KEY))
        .map((field) => ({ id: field.id, path: field.getPluginData(PATH_KEY) }));
      repeaters.push({ containerId: container.id, sourceId: repeater.sourceId, path: repeater.path, xml: source?.characters ?? null, fields });
    }
  }

  penpot.ui.sendMessage({ type: "refresh-data", items, repeaters });
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

  if (message.type === "save-annotation" || message.type === "delete-annotation" || message.type === "update-annotation-remark") {
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
    } else if (message.type === "update-annotation-remark") {
      if (index === -1) return;
      if (typeof message.remark !== "string" || !message.remark.trim()) {
        fail("A remark is required.");
        return;
      }
      entries[index] = { ...entries[index], remark: message.remark.trim() };
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

  if (message.type === "apply-repeater") {
    const target = penpot.currentPage?.getShapeById(message.targetId);
    const fail = (text) => penpot.ui.sendMessage({ type: "status", level: "error", text });
    if (!target || target.type !== "board" ||
      !penpot.currentFile || message.fileId !== penpot.currentFile.id || message.pageId !== penpot.currentPage?.id) {
      fail("Select the repeater container and try again.");
      return;
    }
    const source = getSource(message.sourceId);
    if (!source || source.characters !== message.xml) {
      fail("XML source changed or is missing. Reload before applying again.");
      return;
    }
    if (typeof message.path !== "string" || !message.path.trim()) {
      fail("Repeater XPath is required.");
      return;
    }
    if (!Array.isArray(message.instances)) {
      fail("Missing repeater instance data.");
      return;
    }
    const page = penpot.currentPage;
    if (!page) return;

    const templateChildren = templateChildrenOf(target);
    if (!templateChildren.length) {
      fail("The repeater container has no child layers to repeat.");
      return;
    }
    for (const id of readRepeaterInstanceIds(target)) page.getShapeById(id)?.remove();

    const top = Math.min(...templateChildren.map((child) => child.y));
    const bottom = Math.max(...templateChildren.map((child) => child.y + child.height));
    const rowHeight = bottom - top;
    const createdIds = [];
    message.instances.forEach((instance, index) => {
      if (index === 0) {
        for (const field of templateChildren.flatMap((child) => collectTextLayers(child))) {
          if (field.getPluginData(PATH_KEY) && instance.values[field.id] !== undefined) field.characters = instance.values[field.id];
        }
        return;
      }
      const offsetY = index * (rowHeight + REPEATER_GAP);
      for (const child of templateChildren) {
        const clone = child.clone();
        clone.x = child.x;
        clone.y = child.y + offsetY;
        target.appendChild(clone);
        const templateFields = collectTextLayers(child);
        const cloneFields = collectTextLayers(clone);
        templateFields.forEach((field, fieldIndex) => {
          if (field.getPluginData(PATH_KEY) && instance.values[field.id] !== undefined) cloneFields[fieldIndex].characters = instance.values[field.id];
        });
        createdIds.push(clone.id);
      }
    });

    target.setPluginData(REPEATER_KEY, JSON.stringify({ version: 1, sourceId: source.id, path: message.path.trim() }));
    target.setPluginData(REPEATER_INSTANCES_KEY, JSON.stringify(createdIds));
    penpot.ui.sendMessage({ type: "status", level: "ok", text: `Generated ${message.instances.length} repeater instance(s).` });
    sendSelection(message.sourceId);
    return;
  }

  if (message.type === "remove-repeater") {
    const target = getSelectedShape();
    if (!target || target.type !== "board" || target.id !== message.targetId ||
      !penpot.currentFile || message.fileId !== penpot.currentFile.id || message.pageId !== penpot.currentPage?.id) return;
    const page = penpot.currentPage;
    if (page) for (const id of readRepeaterInstanceIds(target)) page.getShapeById(id)?.remove();
    target.setPluginData(REPEATER_KEY, "");
    target.setPluginData(REPEATER_INSTANCES_KEY, "");
    penpot.ui.sendMessage({ type: "status", level: "ok", text: "Repeater removed." });
    sendSelection();
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
