import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

for (const script of ["install-cli.js", "install-ui.js"]) {
  test(`${script} --help carga todas sus dependencias`, () => {
    const result = spawnSync(process.execPath, [join(ROOT, "scripts", script), "--help"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Memex Offline/);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
  });
}

test("install-ui rechaza un puerto invalido antes de tocar nada", () => {
  const result = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "install-ui.js"), "--port", "0"],
    { cwd: ROOT, encoding: "utf8" }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /puerto invalido/);
});
