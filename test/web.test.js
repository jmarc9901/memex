import { test } from "node:test";
import assert from "node:assert/strict";

import {
  escapeHtml,
  renderSnippet,
  resultCard,
  trailSvg,
  formatStats,
  formatIndexSummary,
} from "../web/lib.js";

test("escapeHtml neutraliza etiquetas y comillas", () => {
  assert.equal(
    escapeHtml('<script>alert("x") & co</script>'),
    "&lt;script&gt;alert(&quot;x&quot;) &amp; co&lt;/script&gt;"
  );
  assert.equal(escapeHtml(null), "");
});

test("renderSnippet escapa el HTML y conserva el resaltado", () => {
  const html = renderSnippet("hola [[ansiedad]] <b>");
  assert.match(html, /<mark>ansiedad<\/mark>/);
  assert.match(html, /&lt;b&gt;/);
  assert.doesNotMatch(html, /<b>/);
});

test("resultCard marca el origen de cada hit y ofrece relacionados", () => {
  const html = resultCard(
    {
      name: "notas.md",
      path: "/tmp/a<b>.md",
      snippet: "texto [[ansiedad]]",
      score: 0.1234,
      lexical_rank: 0,
      semantic_rank: null,
    },
    0
  );
  assert.match(html, /class="badge lex"/);
  assert.doesNotMatch(html, /class="badge sem"/);
  assert.match(html, /0\.123/);
  assert.match(html, /data-ref="\/tmp\/a&lt;b&gt;\.md"/);
  assert.match(html, /Relacionados/);
});

test("trailSvg dibuja nodos y enlaces y escapa las etiquetas", () => {
  const svg = trailSvg({
    nodes: [
      { id: 1, label: "<uno>" },
      { id: 2, label: "dos" },
    ],
    links: [{ source: 1, target: 2 }],
  });
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  assert.equal((svg.match(/<circle /g) ?? []).length, 2);
  assert.equal((svg.match(/<line /g) ?? []).length, 1);
  assert.match(svg, /&lt;uno&gt;/);
  assert.doesNotMatch(svg, /<uno>/);
  assert.equal(trailSvg({ nodes: [], links: [] }), "");
});

test("formatStats y formatIndexSummary muestran las cifras del indice", () => {
  assert.equal(
    formatStats({ files: 2, chunks: 5, embedded: 4, trails: 1 }),
    "2 archivos · 5 fragmentos · 4 con vector · 1 trails"
  );

  const text = formatIndexSummary({
    root: "/tmp/x",
    scanned: 3,
    added: 1,
    updated: 1,
    unchanged: 1,
    unsupported: 0,
    pruned: 2,
    failed: 0,
  });
  assert.match(text, /eliminados\s+: 2/);
  assert.match(text, /errores\s+: 0/);
  assert.doesNotMatch(text, /vectores/);

  const withVectors = formatIndexSummary({
    root: "/tmp/x",
    scanned: 1,
    added: 1,
    updated: 0,
    unchanged: 0,
    unsupported: 0,
    pruned: 0,
    failed: 0,
    embedded: 7,
  });
  assert.match(withVectors, /vectores\s+: 7/);
});
