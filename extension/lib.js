// Memex Offline - utilidades compartidas por el popup y el service worker.

export const DEFAULT_SERVER = "http://127.0.0.1:4747";

/** Lee la URL del servidor Memex configurada (o la por defecto). */
export async function serverUrl() {
  const { memexServer } = await chrome.storage.sync.get("memexServer");
  return (memexServer || DEFAULT_SERVER).replace(/\/$/, "");
}

/** Guarda la URL del servidor Memex. */
export async function setServerUrl(url) {
  await chrome.storage.sync.set({ memexServer: url.replace(/\/$/, "") });
}

/** Inyecta un extractor en la pestaña y devuelve su resultado. */
async function extractFromTab(tabId, func) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func });
  return result?.result;
}

/** Extrae titulo, url y texto visible de una pestaña. */
export function capturePage(tabId) {
  return extractFromTab(tabId, () => ({
    title: document.title,
    url: location.href,
    text: (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 200000),
  }));
}

/** Extrae la seleccion actual de una pestaña (o null). */
export function captureSelection(tabId) {
  return extractFromTab(tabId, () => {
    const sel = String(window.getSelection() || "").trim();
    return sel
      ? { title: document.title + " (seleccion)", url: location.href, text: sel }
      : null;
  });
}

/** Envia un documento al indice local de Memex. */
export async function saveToMemex(doc) {
  const res = await fetch(`${await serverUrl()}/api/save`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...doc, source: "extension" }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
