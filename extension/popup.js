// Memex Offline - logica del popup.
import { capturePage, captureSelection, saveToMemex, serverUrl, setServerUrl } from "./lib.js";

const status = document.getElementById("status");
const serverInput = document.getElementById("server");

function report(message, kind = "") {
  status.textContent = message;
  status.className = kind;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function withBusy(button, fn) {
  button.disabled = true;
  try {
    await fn();
  } catch (err) {
    report(err.message, "err");
  } finally {
    button.disabled = false;
  }
}

document.getElementById("save-page").addEventListener("click", (event) =>
  withBusy(event.currentTarget, async () => {
    const tab = await activeTab();
    if (!tab?.id) throw new Error("no hay pestaña activa");
    const doc = await capturePage(tab.id);
    const res = await saveToMemex(doc);
    report(`Guardado: ${res.chunks} fragmento(s)`, "ok");
  })
);

document.getElementById("save-selection").addEventListener("click", (event) =>
  withBusy(event.currentTarget, async () => {
    const tab = await activeTab();
    if (!tab?.id) throw new Error("no hay pestaña activa");
    const doc = await captureSelection(tab.id);
    if (!doc) throw new Error("no hay texto seleccionado");
    const res = await saveToMemex(doc);
    report(`Selección guardada: ${res.chunks} fragmento(s)`, "ok");
  })
);

serverInput.addEventListener("change", async () => {
  await setServerUrl(serverInput.value.trim());
  report("Servidor actualizado", "ok");
});

(async () => {
  serverInput.value = await serverUrl();
})();
