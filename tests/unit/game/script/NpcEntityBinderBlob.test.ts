import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { INpc } from '@game/npc/core/INpc';
import type { NpcBlobControlHandle } from '@game/npc/blob/BlobControl';
import type { NPCDefinition } from '@game/levels/LevelDefinition';
import { EntityIOSystem, type EntityHandle } from '@game/script/EntityIOSystem';
import { NpcDirectory } from '@game/script/NpcDirectory';
import { bindNpcEntity } from '@game/script/NpcEntityBinder';

describe('NpcEntityBinder Blob I/O', () => {
  it('resuelve poses/markers y drena los eventos de finalización una sola vez', () => {
    const io = new EntityIOSystem();
    const directory = new NpcDirectory();
    const events: string[] = [];
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
      getBlobControlHandle: () => control,
    } as unknown as INpc;
    const def: NPCDefinition = {
      id: 'blob-map',
      name: 'blob-target',
      characterId: 'blob',
      position: [0, 1, 0],
      blobPoses: [{ id: 'gate-flow', kind: 'bridge', marker: 'a', targetMarker: 'b' }],
      connections: [
        { output: 'OnBlobPoseReached', target: 'sink', input: 'Pose' },
        { output: 'OnBlobSplit', target: 'sink', input: 'Split' },
        { output: 'OnBlobMerged', target: 'sink', input: 'Merged' },
        { output: 'OnBlobCommandFailed', target: 'sink', input: 'Failed' },
      ],
    };

    io.registerEntity(recordingHandle('sink', events));
    bindNpcEntity({
      io,
      directory,
      markers: new Map([
        ['a', new Vector3(1, 2, 3)],
        ['b', new Vector3(4, 5, 6)],
      ]),
    }, def, npc);
    io.registerEntity(commandHandle());
    io.registerConnections('commands', [
      { output: 'Set', target: 'blob-target', input: 'SetBlobPose', param: 'gate-flow' },
      { output: 'Split', target: 'blob-target', input: 'SplitBlob', param: 3 },
      { output: 'Merge', target: 'blob-target', input: 'MergeBlob' },
      { output: 'Reset', target: 'blob-target', input: 'ResetBlobPose' },
    ]);

    io.fireOutput('commands', 'Set', { kind: 'player' });
    expect(control.setPose).toHaveBeenCalledWith({
      ...def.blobPoses?.[0],
      center: new Vector3(1, 2, 3),
      target: new Vector3(4, 5, 6),
    });
    io.fireOutput('commands', 'Split', { kind: 'player' });
    io.fireOutput('commands', 'Merge', { kind: 'player' });
    io.fireOutput('commands', 'Reset', { kind: 'player' });
    expect(control.split).toHaveBeenCalledWith(3);
    expect(control.merge).toHaveBeenCalledOnce();
    expect(control.resetPose).toHaveBeenCalledOnce();

    queued.push(
      { type: 'poseReached', poseId: 'gate-flow', pose: 'bridge' },
      { type: 'split', components: 3 },
      { type: 'merged' },
    );
    io.update(0.016);
    io.update(0.016);
    expect(events).toEqual(['Pose', 'Split', 'Merged']);
  });

  it('emite OnBlobCommandFailed para una pose o división inválida', () => {
    const io = new EntityIOSystem();
    const events: string[] = [];
    const control: NpcBlobControlHandle = {
      setPose: vi.fn(), resetPose: vi.fn(), split: vi.fn(), merge: vi.fn(), drainEvents: () => [],
    };
    const npc = { id: 'blob', getBlobControlHandle: () => control } as unknown as INpc;
    const def: NPCDefinition = {
      id: 'blob', characterId: 'blob', position: [0, 1, 0],
      connections: [{ output: 'OnBlobCommandFailed', target: 'sink', input: 'Failed' }],
    };
    io.registerEntity(recordingHandle('sink', events));
    bindNpcEntity({ io, directory: new NpcDirectory(), markers: new Map() }, def, npc);
    io.registerEntity(commandHandle());
    io.registerConnections('commands', [
      { output: 'BadPose', target: 'blob', input: 'SetBlobPose', param: 'missing' },
      { output: 'BadSplit', target: 'blob', input: 'SplitBlob', param: 7 },
    ]);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    io.fireOutput('commands', 'BadPose', { kind: 'player' });
    io.fireOutput('commands', 'BadSplit', { kind: 'player' });
    warn.mockRestore();

    expect(events).toEqual(['Failed', 'Failed']);
    expect(control.setPose).not.toHaveBeenCalled();
    expect(control.split).not.toHaveBeenCalled();
  });
});

function commandHandle(): EntityHandle {
  return { name: 'commands', classId: 'relay', acceptInput: () => undefined };
}

function recordingHandle(name: string, events: string[]): EntityHandle {
  return { name, classId: 'relay', acceptInput: (input) => events.push(input) };
}
