import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@engine/core/EventBus';
import type { GameEventMap } from '@game/GameEvents';
import type { INpc } from '@game/npc/core/INpc';
import type { NpcBlobControlHandle } from '@game/npc/blob/BlobControl';
import type { NPCDefinition } from '@game/levels/LevelDefinition';
import { EntityIOSystem } from '@game/script/EntityIOSystem';
import { NpcDirectory } from '@game/script/NpcDirectory';
import { bindNpcEntity } from '@game/script/NpcEntityBinder';
import { ScriptedSequenceSystem } from '@game/script/ScriptedSequenceSystem';

describe('scripted_sequence + Blob I/O', () => {
  it('OnBegin adopta la pose, poseReached entrega Cue y OnEnd restaura locomoción', () => {
    const io = new EntityIOSystem();
    const directory = new NpcDirectory();
    const queued: ReturnType<NpcBlobControlHandle['drainEvents']> = [];
    const control: NpcBlobControlHandle = {
      setPose: vi.fn(),
      resetPose: vi.fn(),
      split: vi.fn(),
      merge: vi.fn(),
      drainEvents: () => queued.splice(0),
    };
    const npc = {
      id: 'blob-runtime',
      position: new Vector3(),
      isAlive: () => true,
      getBlobControlHandle: () => control,
    } as unknown as INpc;
    const blobDef: NPCDefinition = {
      id: 'blob-map',
      name: 'blob-target',
      characterId: 'blob',
      position: [0, 1, 0],
      blobPoses: [{ id: 'show-column', kind: 'column', marker: 'pose-marker' }],
      connections: [{ output: 'OnBlobPoseReached', target: 'blob-sequence', input: 'Cue' }],
    };
    const markers = new Map([['pose-marker', new Vector3(0, 1, 3)]]);
    bindNpcEntity({ io, directory, markers }, blobDef, npc);

    const sequences = new ScriptedSequenceSystem(
      io,
      directory,
      markers,
      new EventBus<GameEventMap>(),
    );
    sequences.register({
      id: 'blob-sequence',
      name: 'blob-sequence',
      targetNpc: 'blob-target',
      position: [0, 1, 0],
      moveMode: 'none',
      steps: [{ kind: 'waitForCue' }],
      connections: [
        { output: 'OnBegin', target: 'blob-target', input: 'SetBlobPose', param: 'show-column' },
        { output: 'OnEnd', target: 'blob-target', input: 'ResetBlobPose' },
      ],
    });
    io.registerEntity({ name: 'start', classId: 'relay', acceptInput: () => undefined });
    io.registerConnections('start', [{ output: 'Go', target: 'blob-sequence', input: 'Start' }]);

    io.fireOutput('start', 'Go', { kind: 'player' });
    expect(control.setPose).toHaveBeenCalledOnce();
    const order = sequences.orderFor(npc.id);
    expect(order?.isCuePending()).toBe(false);

    queued.push({ type: 'poseReached', poseId: 'show-column', pose: 'column' });
    io.update(0.016);
    expect(order?.isCuePending()).toBe(true);

    order?.notifyDone('completed');
    expect(control.resetPose).toHaveBeenCalledOnce();
  });
});
