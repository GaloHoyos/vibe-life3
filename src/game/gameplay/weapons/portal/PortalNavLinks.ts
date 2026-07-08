import { Vector3 } from "three";
import type { NavDynamicLink, NavSpace } from "@engine/ai/nav/NavSpace";
import type { PortalFrame, PortalPairState, PortalSlot } from "@engine/portals/PortalFrame";
import { portalNormal } from "@engine/portals/PortalMath";
import { PortalConfig } from "@game/config/portal.config";

const TMP_ENTRY_NORMAL = new Vector3();
const TMP_EXIT_NORMAL = new Vector3();
const TMP_PROBE = new Vector3();

/**
 * Traduce el par de portales a links `warp` del NavSpace para que el A* de
 * los NPCs planee rutas a través de la portal gun. Cada dirección genera un
 * edge `celda frente al disco de entrada -> celda de aterrizaje de salida`;
 * el waypoint (`portal.position`) queda DETRÁS del plano de entrada, así el
 * NPC lo atraviesa caminando y la física de traversal lo teletransporta.
 *
 * Entradas transitables a pie: portales de piso (cae adentro) y de pared con
 * el borde inferior cerca del suelo. Un portal de techo/pared alta solo puede
 * ser salida.
 */
export function computePortalNavLinks(
  pair: PortalPairState,
  navSpace: NavSpace,
): NavDynamicLink[] {
  if (!pair.linked) {
    return [];
  }
  const links: NavDynamicLink[] = [];
  for (const slot of ["a", "b"] as const) {
    const entry = pair.get(slot);
    const exit = pair.exitFor(slot);
    if (!entry || !exit) {
      continue;
    }
    const link = buildLink(slot, entry, exit, navSpace);
    if (link) {
      links.push(link);
    }
  }
  return links;
}

function buildLink(
  slot: PortalSlot,
  entry: PortalFrame,
  exit: PortalFrame,
  navSpace: NavSpace,
): NavDynamicLink | null {
  portalNormal(entry, TMP_ENTRY_NORMAL);
  const cfg = PortalConfig.npcTraversal;

  // Techo: no hay forma terrestre de entrar.
  if (TMP_ENTRY_NORMAL.y < -0.5) {
    return null;
  }

  let fromCellIndex: number;
  let crossing: Vector3;
  if (TMP_ENTRY_NORMAL.y > 0.5) {
    // Piso: el NPC camina hasta el centro del disco y cae por el hueco.
    const fromCell = navSpace.cellAt(entry.position);
    if (!fromCell) {
      return null;
    }
    fromCellIndex = fromCell.index;
    crossing = entry.position.clone();
  } else {
    // Pared: celda del piso frente al disco; el waypoint queda detrás del
    // plano para forzar el cruce físico.
    TMP_PROBE.copy(entry.position).addScaledVector(TMP_ENTRY_NORMAL, 0.75);
    const fromCell = navSpace.cellAt(TMP_PROBE);
    if (!fromCell) {
      return null;
    }
    const groundY = fromCell.center[1];
    if (entry.position.y - entry.halfHeight - groundY > cfg.maxEntryLipHeight) {
      return null;
    }
    fromCellIndex = fromCell.index;
    crossing = new Vector3(
      entry.position.x - TMP_ENTRY_NORMAL.x * cfg.crossingDepth,
      groundY,
      entry.position.z - TMP_ENTRY_NORMAL.z * cfg.crossingDepth,
    );
  }

  portalNormal(exit, TMP_EXIT_NORMAL);
  TMP_PROBE.copy(exit.position).addScaledVector(TMP_EXIT_NORMAL, 0.9);
  const toCell = navSpace.cellAt(TMP_PROBE);
  if (!toCell || toCell.index === fromCellIndex) {
    return null;
  }

  return {
    fromCell: fromCellIndex,
    toCell: toCell.index,
    cost: cfg.warpEdgeCost,
    portal: {
      id: `portalgun-${slot}`,
      kind: "warp",
      width: entry.halfWidth * 2,
      height: entry.halfHeight * 2,
      position: [crossing.x, crossing.y, crossing.z],
      normal: [TMP_ENTRY_NORMAL.x, TMP_ENTRY_NORMAL.y, TMP_ENTRY_NORMAL.z],
    },
  };
}
