import { Vector3 } from 'three';
import type { NPCDefinition } from '@game/levels/LevelDefinition';
import type { INpc } from '@game/npc/core/INpc';
import { effectiveName } from './EntityIOTypes';
import type { EntityHandle, EntityIOSystem } from './EntityIOSystem';
import type { NpcDirectory } from './NpcDirectory';
import type { ActivatorRef } from './ActivatorRef';
import type { BlobControlCommand, BlobControlEvent } from '@game/npc/blob/BlobControl';

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
  deps.io.registerEntity(createNpcHandle(source, def, npc, deps));
  deps.io.registerConnections(source, def.connections ?? []);
}

function createNpcHandle(
  source: { key: string; name: string },
  def: NPCDefinition,
  npc: INpc,
  deps: NpcBinderDeps,
): EntityHandle {
  let blobActivator: ActivatorRef = { kind: 'none' };

  const failBlobCommand = (
    command: BlobControlCommand,
    reason: string,
    activator: ActivatorRef,
  ): void => {
    console.warn(`[NPC Blob] '${source.name}' no pudo ejecutar ${command}: ${reason}`);
    deps.io.fireOutput(source, 'OnBlobCommandFailed', activator);
  };

  const blobHandle = () => npc.getBlobControlHandle?.() ?? null;

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
        case 'SetBlobPose': {
          const control = blobHandle();
          if (!control) {
            failBlobCommand('setPose', 'el NPC no es un Blob controlable', args.activator);
            return;
          }
          if (typeof args.param !== 'string' || args.param.length === 0) {
            failBlobCommand('setPose', 'falta el id de pose', args.activator);
            return;
          }
          const pose = def.blobPoses?.find((candidate) => candidate.id === args.param);
          if (!pose) {
            failBlobCommand('setPose', `la pose '${args.param}' no está definida`, args.activator);
            return;
          }
          const resolvedPose = { ...pose };
          if (pose.marker) {
            const marker = deps.markers.get(pose.marker);
            if (!marker) {
              failBlobCommand('setPose', `el marker '${pose.marker}' no existe`, args.activator);
              return;
            }
            resolvedPose.center = marker.clone();
          }
          if (pose.targetMarker) {
            const marker = deps.markers.get(pose.targetMarker);
            if (!marker) {
              failBlobCommand('setPose', `el marker '${pose.targetMarker}' no existe`, args.activator);
              return;
            }
            resolvedPose.target = marker.clone();
          }
          blobActivator = args.activator;
          control.setPose(resolvedPose);
          return;
        }
        case 'ResetBlobPose': {
          const control = blobHandle();
          if (!control) {
            failBlobCommand('resetPose', 'el NPC no es un Blob controlable', args.activator);
            return;
          }
          blobActivator = args.activator;
          control.resetPose();
          return;
        }
        case 'SplitBlob': {
          const control = blobHandle();
          if (!control) {
            failBlobCommand('split', 'el NPC no es un Blob controlable', args.activator);
            return;
          }
          const components = args.param === undefined ? 3 : args.param;
          if (typeof components !== 'number' || !Number.isInteger(components) || components < 2 || components > 6) {
            failBlobCommand('split', 'la cantidad de componentes debe ser un entero entre 2 y 6', args.activator);
            return;
          }
          blobActivator = args.activator;
          control.split(components);
          return;
        }
        case 'MergeBlob': {
          const control = blobHandle();
          if (!control) {
            failBlobCommand('merge', 'el NPC no es un Blob controlable', args.activator);
            return;
          }
          blobActivator = args.activator;
          control.merge();
          return;
        }
      }
    },
    update() {
      const control = blobHandle();
      if (!control) return;
      for (const event of control.drainEvents()) {
        deps.io.fireOutput(source, blobOutputFor(event), blobActivator);
      }
    },
  };
}

function blobOutputFor(event: BlobControlEvent): string {
  switch (event.type) {
    case 'poseReached':
      return 'OnBlobPoseReached';
    case 'poseReset':
      return 'OnBlobPoseReached';
    case 'split':
      return 'OnBlobSplit';
    case 'merged':
      return 'OnBlobMerged';
    case 'error':
      return 'OnBlobCommandFailed';
  }
}

function resolveMarker(markers: ReadonlyMap<string, Vector3>, param: unknown): Vector3 | null {
  if (typeof param !== 'string') return null;
  return markers.get(param)?.clone() ?? null;
}
