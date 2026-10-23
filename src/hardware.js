// Memex Offline - deteccion de hardware para elegir el modelo de embeddings.
//
// No se usa para presumir de equipo: solo para no descargar un modelo de 180 MB
// en una maquina con poca RAM. Todo es local y no se envia a ningun sitio.
import { arch, cpus, platform, totalmem } from "node:os";

/** Redondea a un decimal sin dejar "-0". */
function round1(value) {
  return Math.round(value * 10) / 10 || 0;
}

/**
 * Perfil basico del equipo.
 * @returns {{platform:string, arch:string, cpu:string, cores:number,
 *            memoryGb:number, freeMemoryGb:number, appleSilicon:boolean}}
 */
export function detectHardware() {
  const processors = cpus() ?? [];
  const memoryGb = round1(totalmem() / 1024 ** 3);
  const freeMemoryGb = round1((process.availableMemory?.() ?? 0) / 1024 ** 3);
  return {
    platform: platform(),
    arch: arch(),
    cpu: processors[0]?.model?.trim() || "CPU desconocida",
    cores: processors.length || 1,
    memoryGb,
    freeMemoryGb,
    appleSilicon: platform() === "darwin" && arch() === "arm64",
  };
}

/** Lineas legibles para el instalador. */
export function hardwareLines(profile = {}) {
  const lines = [];
  const cpu = profile.cpu ?? "CPU desconocida";
  const cores = Number(profile.cores);
  lines.push(`CPU: ${cpu}${Number.isFinite(cores) && cores > 0 ? ` (${cores} nucleos)` : ""}`);
  const memory = Number(profile.memoryGb);
  if (Number.isFinite(memory) && memory > 0) {
    lines.push(`RAM: ${memory} GB`);
  }
  const platformName = profile.platform ?? "desconocida";
  const architecture = profile.arch ?? "desconocida";
  lines.push(`Plataforma: ${platformName} ${architecture}`);
  if (profile.appleSilicon) lines.push("Apple Silicon: aceleracion CPU nativa");
  return lines;
}

/**
 * ¿El equipo puede con un modelo de `minRamGb`?
 * Sin datos de RAM se responde `true` para no bloquear el onboarding.
 */
export function canRunModel(profile = {}, model = {}) {
  const memory = Number(profile.memoryGb);
  const needed = Number(model.minRamGb);
  if (!Number.isFinite(memory) || !Number.isFinite(needed)) return true;
  return memory >= needed;
}
