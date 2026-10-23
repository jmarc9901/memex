// Memex Offline - utilidades puras de la GUI.
//
// Viven fuera de app.js (que toca el DOM al importarse) para poder probarlas
// con `node --test` sin navegador: escaping, snippets, tarjetas y el SVG del
// grafo de trails.

/** Escapa texto para insertarlo como HTML o como valor de atributo. */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convierte los marcadores [[termino]] del snippet en <mark> resaltados. */
export function renderSnippet(text) {
  return escapeHtml(text).replace(/\[\[(.+?)\]\]/g, "<mark>$1</mark>");
}

/** Tarjeta de un resultado de busqueda (o de una fuente de RAG). */
export function resultCard(row, i) {
  const badges = [];
  if (row.lexical_rank !== null && row.lexical_rank !== undefined) {
    badges.push('<span class="badge lex">lex</span>');
  }
  if (row.semantic_rank !== null && row.semantic_rank !== undefined) {
    badges.push('<span class="badge sem">sem</span>');
  }
  const score = Number(row.score);
  if (Number.isFinite(score)) badges.push(`<span class="badge">${score.toFixed(3)}</span>`);
  const ref = row.path ? ` data-ref="${escapeHtml(row.path)}"` : "";
  return `<article class="result">
    <div class="head">
      <span class="rank">${i + 1}.</span>
      <span class="name">${escapeHtml(row.name)}</span>
      <span class="badges">${badges.join("")}</span>
    </div>
    <div class="path">${escapeHtml(row.path)}</div>
    <div class="snippet">${renderSnippet(row.snippet ?? row.text)}</div>
    ${row.path ? `<div class="actions"><button type="button" class="relate ghost"${ref}>Relacionados</button></div>` : ""}
  </article>`;
}

/**
 * Dibuja el grafo de un trail como SVG (disposicion circular, sin librerias).
 * @param {{nodes?:Array, links?:Array}} graph
 * @param {{size?:number}} [opts]
 * @returns {string}
 */
export function trailSvg(graph, { size = 400 } = {}) {
  const nodes = graph?.nodes ?? [];
  const links = graph?.links ?? [];
  if (!nodes.length) return "";

  const cx = size / 2;
  const cy = size / 2;
  const radius = Math.min(150, 40 + nodes.length * 10);
  const pos = new Map();
  nodes.forEach((node, i) => {
    const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    pos.set(node.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  });

  const label = (value) => escapeHtml(String(value ?? "").slice(0, 18));
  const parts = [
    `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="grafo del trail">`,
    '<defs><marker id="memex-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>',
  ];
  for (const link of links) {
    const a = pos.get(link.source);
    const b = pos.get(link.target);
    if (!a || !b) continue;
    parts.push(
      `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" ` +
        'stroke="currentColor" stroke-opacity="0.4" marker-end="url(#memex-arrow)"/>'
    );
  }
  for (const node of nodes) {
    const p = pos.get(node.id);
    parts.push(
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" fill="var(--accent)"/>` +
        `<text x="${p.x.toFixed(1)}" y="${(p.y - 14).toFixed(1)}" text-anchor="middle" font-size="11" fill="currentColor">${label(node.label)}</text>`
    );
  }
  parts.push("</svg>");
  return parts.join("");
}

/** Resumen legible del pie de pagina. */
export function formatStats(stats) {
  return `${stats.files} archivos · ${stats.chunks} fragmentos · ${stats.embedded} con vector · ${stats.trails} trails`;
}

/** Log del indexado (mismas cifras que el CLI, incluida la poda). */
export function formatIndexSummary(summary) {
  return (
    `raíz               : ${summary.root}\n` +
    `archivos escaneados: ${summary.scanned}\n` +
    `nuevos             : ${summary.added}\n` +
    `actualizados       : ${summary.updated}\n` +
    `sin cambios        : ${summary.unchanged}\n` +
    `no indexables      : ${summary.unsupported}\n` +
    `eliminados         : ${summary.pruned ?? 0}\n` +
    `errores            : ${summary.failed}` +
    (summary.embedded === null || summary.embedded === undefined
      ? ""
      : `\nvectores           : ${summary.embedded}`)
  );
}
