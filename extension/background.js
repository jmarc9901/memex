// Memex Offline - menu contextual para guardar en el indice local.
import { capturePage, captureSelection, saveToMemex } from "./lib.js";

const PAGE_ID = "memex-save-page";
const SELECTION_ID = "memex-save-selection";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: PAGE_ID, title: "Guardar pagina en Memex", contexts: ["page", "frame"] });
  chrome.contextMenus.create({ id: SELECTION_ID, title: "Guardar seleccion en Memex", contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  try {
    const doc = info.menuItemId === SELECTION_ID ? await captureSelection(tab.id) : await capturePage(tab.id);
    if (!doc) throw new Error("no hay contenido que guardar");
    await saveToMemex(doc);
    await flashBadge("OK", "#1f9d63");
  } catch (err) {
    await flashBadge("ERR", "#e06c75");
    console.warn("Memex:", err.message);
  }
});

/** Muestra un badge temporal con el resultado. */
async function flashBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
}
