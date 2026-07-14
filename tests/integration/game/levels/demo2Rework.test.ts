import { describe, expect, it } from 'vitest';
import { Demo2Ravenholm } from '@game/levels/maps/campaign/Demo2Ravenholm';
import type { EntityConnection, LogicEntityDefinition } from '@game/script/EntityIOTypes';

type LogicKind = LogicEntityDefinition['kind'];
type LogicOfKind<K extends LogicKind> = Extract<LogicEntityDefinition, { kind: K }>;
type Connectable = { connections?: EntityConnection[] };

const logicEntities = Demo2Ravenholm.logicEntities ?? [];

function logicById<K extends LogicKind>(id: string, kind: K): LogicOfKind<K> {
  const entity = logicEntities.find((candidate) => candidate.id === id);
  expect(entity, `Falta la entidad logica '${id}'`).toBeDefined();
  expect(entity?.kind, `'${id}' tiene un kind inesperado`).toBe(kind);
  return entity as LogicOfKind<K>;
}

function expectConnection(source: Connectable, expected: Partial<EntityConnection>): void {
  expect(source.connections ?? []).toEqual(
    expect.arrayContaining([expect.objectContaining(expected)]),
  );
}

describe('Demo 2 Ravenholm rework', () => {
  it('conserva el ID de campana', () => {
    expect(Demo2Ravenholm.id).toBe('demo-02-ravenholm');
  });

  it('entrega una sola portal gun y obliga a completar el control elevado', () => {
    expect(Demo2Ravenholm.weaponPickups.filter((pickup) => pickup.weaponId === 'portalGun')).toEqual([
      expect.objectContaining({ id: 'd2-pickup-portal-gun' }),
    ]);

    const gate = Demo2Ravenholm.doors.find((door) => door.id === 'd2-door-quarantine-gate');
    expect(gate, 'Falta el porton de cuarentena').toBeDefined();
    expect(gate?.button.position[1]).toBeGreaterThan(4);
    expectConnection(gate!, {
      output: 'OnOpen',
      target: 'd2-relay-portal-complete',
      input: 'Trigger',
    });

    const landing = Demo2Ravenholm.triggers.find(
      (trigger) => trigger.id === 'd2-trigger-portal-landing',
    );
    expect(landing, 'Falta el trigger de llegada al balcon').toBeDefined();
    expect(landing?.position[1]).toBeGreaterThan(4);
    expectConnection(landing!, {
      output: 'OnStartTouch',
      target: 'd2-obj-press-gate',
      input: 'Apply',
    });

    const portalComplete = logicById('d2-relay-portal-complete', 'relay');
    expectConnection(portalComplete, {
      output: 'OnTrigger',
      target: 'd2-spawn-ossuary',
      input: 'Spawn',
    });
    expectConnection(portalComplete, {
      output: 'OnTrigger',
      target: 'd2-obj-clear-ossuary',
      input: 'Apply',
    });
    logicById('d2-obj-press-gate', 'objective');
    logicById('d2-spawn-ossuary', 'npcSpawner');
    logicById('d2-obj-clear-ossuary', 'objective');
  });

  it('encadena la sirena, la defensa final y la salida sin permitir atajos', () => {
    const sirenSwitch = Demo2Ravenholm.doors.find((door) => door.id === 'd2-door-siren-switch');
    expect(sirenSwitch, 'Falta el interruptor fisico de la sirena').toBeDefined();
    expectConnection(sirenSwitch!, {
      output: 'OnOpen',
      target: 'd2-relay-final-start',
      input: 'Trigger',
    });

    logicById('d2-relay-final-start', 'relay');
    const finalClear = logicById('d2-relay-final-clear', 'relay');
    expectConnection(finalClear, {
      output: 'OnTrigger',
      target: 'd2-door-mine-lift',
      input: 'Open',
    });
    expectConnection(finalClear, {
      output: 'OnTrigger',
      target: 'd2-trigger-exit',
      input: 'Enable',
    });
    expectConnection(finalClear, {
      output: 'OnTrigger',
      target: 'd2-obj-escape',
      input: 'Apply',
    });
    expect(Demo2Ravenholm.doors.some((door) => door.id === 'd2-door-mine-lift')).toBe(true);
    logicById('d2-obj-escape', 'objective');

    const exit = Demo2Ravenholm.triggers.find((trigger) => trigger.id === 'd2-trigger-exit');
    expect(exit, 'Falta el trigger de salida de la mina').toBeDefined();
    expect(exit?.startDisabled).toBe(true);
    expectConnection(exit!, {
      output: 'OnStartTouch',
      target: 'd2-changelevel',
      input: 'Trigger',
    });
    logicById('d2-changelevel', 'changelevel');
  });

  it('mantiene escala de capitulo, densidad espacial y variedad audiovisual', () => {
    const ground = Demo2Ravenholm.staticBoxes.find(
      (box) => box.id === 'demo-02-ravenholm-ground',
    );
    expect(ground, 'Falta el suelo principal identificable del nivel').toBeDefined();
    expect(ground?.size[0]).toBe(240);
    expect(ground?.size[2]).toBe(320);

    const spawners = logicEntities.filter(
      (entity): entity is LogicOfKind<'npcSpawner'> => entity.kind === 'npcSpawner',
    );
    const soundscapes = logicEntities.filter((entity) => entity.kind === 'soundscape');
    const authoredBoxCount = Demo2Ravenholm.staticBoxes.length
      + (Demo2Ravenholm.buildings ?? []).reduce((total, building) => total + building.boxes.length, 0);

    expect(authoredBoxCount).toBeGreaterThan(1_000);
    expect(Demo2Ravenholm.triggers.length).toBeGreaterThanOrEqual(8);
    expect(Demo2Ravenholm.checkpoints?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(
      spawners.reduce((total, spawner) => total + spawner.npcs.length, 0),
    ).toBeGreaterThanOrEqual(25);
    expect(soundscapes.length).toBeGreaterThanOrEqual(4);
    expect(Demo2Ravenholm.hazardVolumes?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
