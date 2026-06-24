import type { CheckpointSnapshot } from "@game/levels/CheckpointSystem";

const KEY = "vibe.respawn.request";

/**
 * Pedido de respawn que sobrevive el `window.location.reload()`. El respawn
 * estilo HL recarga la página para teardown limpio del nivel (igual que
 * "Salir al menú"); este request, persistido en `sessionStorage`, le dice al
 * boot qué nivel recargar y con qué snapshot de checkpoint reaparecer.
 */
export interface RespawnRequest {
  levelId: string;
  snapshot: CheckpointSnapshot | null;
}

export function setRespawnRequest(request: RespawnRequest): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(request));
  } catch {
    // sessionStorage deshabilitado: el respawn cae al boot normal (menú).
  }
}

export function getRespawnRequest(): RespawnRequest | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const request = parsed as Partial<RespawnRequest>;
    if (typeof request.levelId !== "string") return null;
    return { levelId: request.levelId, snapshot: request.snapshot ?? null };
  } catch {
    return null;
  }
}

export function clearRespawnRequest(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // best-effort
  }
}
