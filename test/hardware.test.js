import { test } from "node:test";
import assert from "node:assert/strict";
import { detectHardware, hardwareLines, canRunModel } from "../src/hardware.js";

test("detectHardware devuelve un perfil con CPU, nucleos y RAM", () => {
  const profile = detectHardware();
  assert.equal(typeof profile.platform, "string");
  assert.equal(typeof profile.arch, "string");
  assert.equal(typeof profile.cpu, "string");
  assert.ok(profile.cpu.length > 0);
  assert.ok(Number.isInteger(profile.cores) && profile.cores >= 1);
  assert.ok(Number.isFinite(profile.memoryGb) && profile.memoryGb > 0);
  assert.equal(typeof profile.appleSilicon, "boolean");
});

test("hardwareLines resume el perfil sin campos vacios", () => {
  const lines = hardwareLines({
    cpu: "CPU de prueba",
    cores: 8,
    memoryGb: 16,
    platform: "linux",
    arch: "x64",
  });
  assert.equal(lines[0], "CPU: CPU de prueba (8 nucleos)");
  assert.ok(lines.includes("RAM: 16 GB"));
  assert.ok(lines.includes("Plataforma: linux x64"));
});

test("hardwareLines tolera perfiles incompletos", () => {
  const lines = hardwareLines({});
  assert.equal(lines.length, 2);
  assert.match(lines[0], /CPU: CPU desconocida/);
  assert.match(lines[1], /Plataforma: desconocida desconocida/);
});

test("canRunModel compara la RAM disponible con el minimo", () => {
  assert.equal(canRunModel({ memoryGb: 16 }, { minRamGb: 6 }), true);
  assert.equal(canRunModel({ memoryGb: 4 }, { minRamGb: 6 }), false);
  assert.equal(canRunModel({}, { minRamGb: 6 }), true, "sin datos no se bloquea");
});
