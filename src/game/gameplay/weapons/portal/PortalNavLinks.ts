import { Vector3 } from "three";
import type { NavigationService } from "@engine/ai/navigation/NavigationService";
import type { NavigationActionLink } from "@engine/ai/navigation/NavigationTypes";
import type { PortalPairState } from "@engine/portals/PortalFrame";
import { portalNormal } from "@engine/portals/PortalMath";
import { PortalConfig } from "@game/config/portal.config";
import { NavigationProfiles } from "@game/npc/navigation/NavAgentProfiles";

const TMP_ENTRY_NORMAL = new Vector3();
const TMP_EXIT_NORMAL = new Vector3();

/** Links deliberados entrada→salida para Recast y el volumen aéreo. */
export function computePortalNavigationLinks(
  pair: PortalPairState,
  navigation: NavigationService,
): NavigationActionLink[] {
  if (!pair.linked) return [];
  const links: NavigationActionLink[] = [];
  for (const slot of ["a", "b"] as const) {
    const entry = pair.get(slot);
    const exit = pair.exitFor(slot);
    if (!entry || !exit) continue;
    portalNormal(entry, TMP_ENTRY_NORMAL);
    portalNormal(exit, TMP_EXIT_NORMAL);

    // Terrestres: una boca de techo solo es salida; pared y piso son entradas.
    if (TMP_ENTRY_NORMAL.y >= -0.5) {
      const frontProbe = entry.position.clone().addScaledVector(
        TMP_ENTRY_NORMAL,
        TMP_ENTRY_NORMAL.y > 0.5 ? 0 : 0.75,
      );
      const approach = navigation.projectPoint(frontProbe, NavigationProfiles.humanoid);
      const exitProbe = exit.position.clone().addScaledVector(TMP_EXIT_NORMAL, 0.95);
      const landing = navigation.projectPoint(exitProbe, NavigationProfiles.humanoid);
      if (approach && landing) {
        const lowerEdge = entry.position.y - entry.halfHeight;
        if (
          TMP_ENTRY_NORMAL.y > 0.5 ||
          lowerEdge - approach.y <= PortalConfig.npcTraversal.maxEntryLipHeight
        ) {
          const crossing = entry.position.clone().addScaledVector(
            TMP_ENTRY_NORMAL,
            -PortalConfig.npcTraversal.crossingDepth,
          );
          if (Math.abs(TMP_ENTRY_NORMAL.y) < 0.5) crossing.y = approach.y;
          links.push({
            id: `portal-ground-${slot}`,
            kind: "portal",
            start: approach,
            traverseStart: crossing,
            end: landing,
            bidirectional: false,
            cost: PortalConfig.npcTraversal.warpEdgeCost,
            width: entry.halfWidth * 2,
            profileIds: ["humanoid", "humanoid-limited", "headcrab", "blob"],
            portalId: `portalgun-${slot}`,
          });
        }
      }
    }

    // El manhack cabe y navega el volumen completo; gunship/strider no caben.
    links.push({
      id: `portal-air-${slot}`,
      kind: "portal",
      start: entry.position.clone().addScaledVector(TMP_ENTRY_NORMAL, 0.65),
      traverseStart: entry.position.clone().addScaledVector(
        TMP_ENTRY_NORMAL,
        -PortalConfig.npcTraversal.crossingDepth,
      ),
      end: exit.position.clone().addScaledVector(TMP_EXIT_NORMAL, 0.95),
      bidirectional: false,
      cost: PortalConfig.npcTraversal.warpEdgeCost,
      width: entry.halfWidth * 2,
      profileIds: ["manhack"],
      portalId: `portalgun-${slot}`,
    });
  }
  return links;
}
