import { Vector3 } from 'three';
import type { NPCDefinition } from '@game/levels/LevelDefinition';
import type { INpc } from '@game/npc/core/INpc';
import { effectiveName } from './EntityIOTypes';
import type { EntityHandle, EntityIOSystem } from './EntityIOSystem';
import type { NpcDirectory } from './NpcDirectory';

export interface CompanionCommands {
  startFollowing(npcId: string): void;
  stopFollowing(npcId: string): void;
  escortTo(npcId: string, point: Vector3): void;
}

export interface NpcBinderDeps {
  io: EntityIOSystem;
  directory: NpcDirectory;
  markers: ReadonlyMap<string, Vector3>;
  companion?: CompanionCommands;
}

/**
 * Publica una instancia real de NPC en el grafo. Los inputs por targetname
 * siguen haciendo fan-out, pero cada instancia conserva sus propios outputs y
 * `maxFires`, incluso si una oleada comparte nombre.
 */
export function bindNpcEntity(
  deps: NpcBinderDeps,
  def: NPCDefinition,
  npc: INpc,
): void {
  const name = effectiveName(def);
  const source = { key: npc.id, name };
  deps.directory.register(name, npc, source.key);
  deps.io.registerEntity(createNpcHandle(source, npc, deps));
  deps.io.registerConnections(source, def.connections ?? []);
}

function createNpcHandle(
  source: { key: string; name: string },
  npc: INpc,
  deps: NpcBinderDeps,
): EntityHandle {
  return {
    key: source.key,
    name: source.name,
    classId: 'npc',
    acceptInput(input, args) {
      switch (input) {
        case 'Kill':
          if (npc.isAlive()) {
            const attackerId =
              args.activator.kind === 'player'
                ? 'player'
                : args.activator.kind === 'entity'
                  ? (args.activator.key ?? args.activator.name)
                  : undefined;
            npc.applyDamage(
              npc.health.max * 10,
              undefined,
              undefined,
              attackerId,
            );
          }
          return;
        case 'StartFollowing':
          deps.companion?.startFollowing(npc.id);
          return;
        case 'StopFollowing':
          deps.companion?.stopFollowing(npc.id);
          return;
        case 'EscortTo': {
          const point = resolveMarker(deps.markers, args.param);
          if (point) deps.companion?.escortTo(npc.id, point);
          return;
        }
        case 'Teleport': {
          const point = resolveMarker(deps.markers, args.param);
          if (!point) return;
          const portalHandle = npc.getPortalTraversalHandle();
          portalHandle?.teleport(point, new Vector3(), 0);
          return;
        }
      }
    },
  };
}

function resolveMarker(markers: ReadonlyMap<string, Vector3>, param: unknown): Vector3 | null {
  if (typeof param !== 'string') return null;
  return markers.get(param)?.clone() ?? null;
}
