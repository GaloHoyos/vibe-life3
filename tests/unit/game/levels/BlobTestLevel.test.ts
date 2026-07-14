import { describe, expect, it } from 'vitest';
import { CharacterPresets } from '@game/characters/CharacterPresets';
import type { StaticBoxDefinition } from '@game/levels/LevelDefinition';
import { BlobTestLevel } from '@game/levels/maps/custom/BlobTestLevel';

describe('BlobTestLevel V2 station', () => {
  it('uses a deterministic 64 x 56 shell and exact traversal obstacle heights', () => {
    expect(box('blob-lab-floor').size).toEqual([64, 0.4, 56]);

    expect(box('blob-traversal-step-032')).toMatchObject({
      position: [-24.75, 0.16, 10],
      size: [13.2, 0.32, 1.2],
    });
    expect(box('blob-traversal-climb-125')).toMatchObject({
      position: [-24.75, 0.625, 3],
      size: [13.2, 1.25, 1.2],
    });
    expect(box('blob-traversal-blocked-150')).toMatchObject({
      position: [-24.75, 0.75, -4],
      size: [13.2, 1.5, 1.2],
    });
  });

  it('defines exactly three valid north-grate flow openings', () => {
    const grate = box('blob-flow-grate');
    const flow = grate.blobFlow;

    expect(grate.blobPermeable).toBe(true);
    expect(flow?.brainCrossFraction).toBe(0.6);
    expect(flow?.openings).toEqual([
      { offset: -3.2, width: 0.72, base: 0.12, height: 2.55 },
      { offset: 0, width: 0.72, base: 0.12, height: 2.55 },
      { offset: 3.2, width: 0.72, base: 0.12, height: 2.55 },
    ]);

    for (const opening of flow?.openings ?? []) {
      const base = opening.base ?? opening.bottom ?? Number.NaN;
      expect(opening.width).toBeGreaterThan(0);
      expect(Math.abs(opening.offset) + opening.width / 2).toBeLessThanOrEqual(grate.size[0] / 2);
      expect(base).toBeGreaterThanOrEqual(0);
      expect(base + opening.height).toBeLessThanOrEqual(grate.size[1]);
    }
  });

  it('places the two biomass prey presets and a non-consumable turret control', () => {
    expect(npc('blob-prey-headcrab').characterId).toBe('headcrab');
    expect(CharacterPresets.headcrab.blobPrey).toEqual({ biomass: 4 });

    expect(npc('blob-prey-zombie').characterId).toBe('zombie');
    expect(CharacterPresets.zombie.blobPrey).toEqual({ biomass: 12 });

    expect(npc('blob-prey-control-turret').characterId).toBe('floorTurret');
    expect(CharacterPresets.floorTurret.blobPrey).toBeUndefined();
  });

  it('stocks the complete damage and traversal weapon gallery', () => {
    const weapons = new Set(BlobTestLevel.weaponPickups.map((pickup) => pickup.weaponId));

    expect(weapons).toEqual(new Set([
      'pistol',
      'revolver',
      'smg',
      'shotgun',
      'crossbow',
      'grenade',
      'rpg',
      'iceGun',
      'portalGun',
    ]));
    expect(BlobTestLevel.weaponPickups.every((pickup) => pickup.position[2] === 23)).toBe(true);
  });

  it('retains five poses whose marker references all resolve', () => {
    const subject = npc('blob-lab-subject');
    const poses = subject.blobPoses ?? [];
    const markers = new Set((BlobTestLevel.logicEntities ?? []).map((entity) => entity.id));

    expect(poses.map((pose) => pose.id)).toEqual(['ball', 'column', 'tentacle', 'bridge', 'wall']);
    expect(markers).toEqual(new Set(['blob-pose-center', 'blob-pose-target', 'blob-wall-a', 'blob-wall-b']));
    for (const pose of poses) {
      expect(pose.marker).toBeDefined();
      if (pose.marker) expect(markers.has(pose.marker)).toBe(true);
      if ('targetMarker' in pose && pose.targetMarker) expect(markers.has(pose.targetMarker)).toBe(true);
    }
  });

  it('keeps all level entity ids unique', () => {
    const ids = [
      ...BlobTestLevel.staticBoxes.map((entity) => entity.id),
      ...BlobTestLevel.dynamicBoxes.map((entity) => entity.id),
      ...BlobTestLevel.doors.flatMap((entity) => [entity.id, entity.button.id]),
      ...BlobTestLevel.npcs.map((entity) => entity.id),
      ...(BlobTestLevel.logicEntities ?? []).map((entity) => entity.id),
      ...BlobTestLevel.weaponPickups.map((entity) => entity.id),
      ...BlobTestLevel.triggers.map((entity) => entity.id),
    ];

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('starts south of a closed airlock, far from every Blob-side actor', () => {
    const [spawnX, , spawnZ] = BlobTestLevel.playerStart;
    const door = BlobTestLevel.doors.find((candidate) => candidate.id === 'blob-spawn-airlock-door');
    const subject = npc('blob-lab-subject');
    const remoteActors = BlobTestLevel.npcs.filter((candidate) => candidate.id !== subject.id);

    expect(door).toBeDefined();
    expect(spawnX).toBeGreaterThan(-15);
    expect(spawnX).toBeLessThan(15);
    expect(spawnZ).toBeGreaterThan(door?.position[2] ?? Infinity);
    expect(subject.position[2]).toBeLessThan(door?.position[2] ?? -Infinity);
    expect(spawnZ - subject.position[2]).toBeGreaterThan(30);
    expect(remoteActors.every((actor) => actor.position[2] < (door?.position[2] ?? -Infinity))).toBe(true);
    expect(box('blob-spawn-wall-west').position[0]).toBe(-15);
    expect(box('blob-spawn-wall-east').position[0]).toBe(15);
  });

  it('includes explicit portal panels, return-maze baffles, and the withering pocket', () => {
    expect(box('blob-portal-panel-a').material).toBe('concrete');
    expect(box('blob-portal-panel-b').material).toBe('concrete');
    expect(box('blob-portal-floor-panel').material).toBe('concrete');
    expect(box('blob-maze-baffle-south')).toBeDefined();
    expect(box('blob-maze-baffle-north')).toBeDefined();
    expect(box('blob-wither-pocket-west')).toBeDefined();
    expect(box('blob-wither-pocket-east')).toBeDefined();
    expect(box('blob-wither-pocket-back')).toBeDefined();
  });
});

function box(id: string): StaticBoxDefinition {
  const definition = BlobTestLevel.staticBoxes.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Missing Blob test box: ${id}`);
  return definition;
}

function npc(id: string): (typeof BlobTestLevel.npcs)[number] {
  const definition = BlobTestLevel.npcs.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Missing Blob test NPC: ${id}`);
  return definition;
}
