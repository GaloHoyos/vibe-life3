import { describe, expect, it } from 'vitest';
import { Demo3WhiteoutFlight } from '@game/levels/maps/campaign/Demo3WhiteoutFlight';
import { effectiveName } from '@game/script/EntityIOTypes';
import { normalizeLandmark } from '@game/levels/LevelTransition';
import type { EntityConnection, LogicEntityDefinition } from '@game/script/EntityIOTypes';

type LogicKind = LogicEntityDefinition['kind'];
type LogicOfKind<K extends LogicKind> = Extract<LogicEntityDefinition, { kind: K }>;
type Connectable = { connections?: EntityConnection[] };

const level = Demo3WhiteoutFlight;
const logicEntities = level.logicEntities ?? [];

function logicById<K extends LogicKind>(id: string, kind: K): LogicOfKind<K> {
  const entity = logicEntities.find((candidate) => candidate.id === id);
  expect(entity, `Falta la entidad lógica '${id}'`).toBeDefined();
  expect(entity?.kind, `'${id}' tiene un kind inesperado`).toBe(kind);
  return entity as LogicOfKind<K>;
}

function expectConnection(source: Connectable, expected: Partial<EntityConnection>): void {
  expect(source.connections ?? []).toEqual(
    expect.arrayContaining([expect.objectContaining(expected)]),
  );
}

/** Todo lo que puede recibir un input, por su targetname efectivo. */
function addressableNames(): Set<string> {
  const named: Array<{ id: string; name?: string }> = [
    ...level.doors,
    ...level.doors.map((door) => ({ id: door.button.id })),
    ...level.npcs,
    ...level.triggers,
    ...logicEntities,
    ...(level.sequences ?? []),
    ...(level.vehicles ?? []),
    ...(level.vehicleWaypoints ?? []),
    ...(level.vehicleNavMarkers ?? []),
    ...((level.logicEntities ?? []).flatMap((entity) =>
      entity.kind === 'npcSpawner' ? entity.npcs : [],
    )),
  ];
  return new Set(named.map((entity) => effectiveName(entity)));
}

function allConnections(): Array<{ owner: string; connection: EntityConnection }> {
  const sources: Array<{ id: string; name?: string; connections?: EntityConnection[] }> = [
    ...level.doors,
    ...level.npcs,
    ...level.triggers,
    ...logicEntities,
    ...(level.sequences ?? []),
    ...(level.vehicles ?? []),
    ...((level.logicEntities ?? []).flatMap((entity) =>
      entity.kind === 'npcSpawner' ? entity.npcs : [],
    )),
  ];
  return sources.flatMap((source) =>
    (source.connections ?? []).map((connection) => ({
      owner: effectiveName(source),
      connection,
    })),
  );
}

describe('Demo 3 — el paso blanco', () => {
  it('conserva el id de campaña y la cadena de niveles', () => {
    expect(level.id).toBe('demo-03-whiteout-flight');
    expect(level.nextLevel).toBe('snow-field');
    expect(level.entryLandmark).toBeDefined();
    expect(normalizeLandmark(level.entryLandmark!).position).toEqual(level.playerStart);
  });

  it('no deja ninguna conexión apuntando a un nombre inexistente', () => {
    // Un target mal escrito no rompe nada al cargar: simplemente no pasa nada
    // en el juego, que es la peor forma de romper un nivel.
    const known = addressableNames();
    const dangling = allConnections()
      .filter(({ connection }) => !connection.target.startsWith('!'))
      .filter(({ connection }) => !known.has(connection.target))
      .map(({ owner, connection }) => `${owner} → ${connection.target}.${connection.input}`);

    expect(dangling).toEqual([]);
  });

  it('cierra cada contador con la cuenta exacta de enemigos que lo alimentan', () => {
    const spawned = (level.logicEntities ?? []).flatMap((entity) =>
      entity.kind === 'npcSpawner' ? entity.npcs : [],
    );
    const feeders = [...level.npcs, ...spawned];

    for (const counterId of ['d3-count-bowl', 'd3-count-depot', 'd3-count-gate', 'd3-count-relay']) {
      const counter = logicById(counterId, 'counter');
      const contributors = feeders.filter((npc) =>
        (npc.connections ?? []).some(
          (connection) => connection.target === counterId && connection.input === 'Add',
        ),
      );
      // Si sobran enemigos el contador nunca cierra y el capítulo se traba; si
      // faltan, cierra antes de tiempo y la puerta se abre sola.
      expect(contributors.length, counterId).toBe(counter.max);
    }
  });

  it('cubre cada spawner con una red de OnSpawnFailed', () => {
    const spawners = logicEntities.filter((entity) => entity.kind === 'npcSpawner');
    expect(spawners.length).toBeGreaterThanOrEqual(4);
    for (const spawner of spawners) {
      expectConnection(spawner, { output: 'OnSpawnFailed' });
    }
  });

  it('esconde el buggy detrás del portón del depósito', () => {
    const buggy = level.vehicles?.find((vehicle) => vehicle.id === 'd3-player-buggy');
    expect(buggy).toMatchObject({
      presetId: 'buggy',
      accessPolicy: 'player',
      engineOn: false,
      weaponEnabled: true,
    });
    // Adentro del galpón: se ve por el portón cerrado y es la recompensa de
    // despejar el depósito, no un vehículo tirado en la nieve.
    expect(buggy?.position[0]).toBeLessThan(-63);

    const gate = level.doors.find((door) => door.id === 'd3-depot-gate');
    expect(gate, 'Falta el portón del depósito').toBeDefined();
    expectConnection(gate!, { output: 'OnOpen', target: 'd3-obj-take-buggy', input: 'Apply' });
  });

  it('deja el transporte Combine inerte hasta que el guion da la alarma', () => {
    const helicopter = level.vehicles?.find((vehicle) => vehicle.id === 'd3-cmb-helicopter');
    expect(helicopter).toMatchObject({
      presetId: 'helicopterFree',
      faction: 'combine',
      startDisabled: true,
    });
    // La oferta arranca apagada: los guardias del pad siguen siendo guardias
    // hasta que suena la alarma, y se los puede matar antes de que suba.
    expect(helicopter?.aiCrew).toMatchObject({ enabled: false, roles: ['pilot', 'gunner'] });

    const alarm = logicById('d3-relay-air-alarm', 'relay');
    expectConnection(alarm, { target: 'd3-cmb-helicopter', input: 'Enable' });
    expectConnection(alarm, { target: 'd3-cmb-helicopter', input: 'EnableCrewing' });

    const trigger = level.triggers.find((entry) => entry.id === 'd3-trg-air-alarm');
    // Habilitado por la barrera: si sonara antes, el jugador se comería el
    // helicóptero sin haber podido recoger la RPG del puesto.
    expect(trigger?.startDisabled).toBe(true);
    expectConnection(logicById('d3-relay-gate-open', 'relay'), {
      target: 'd3-trg-air-alarm',
      input: 'Enable',
    });
  });

  it('traba el helicóptero de extracción hasta terminar el asedio', () => {
    const extraction = level.vehicles?.find(
      (vehicle) => vehicle.id === 'd3-extraction-helicopter',
    );
    expect(extraction).toMatchObject({
      presetId: 'helicopterFree',
      accessPolicy: 'player',
      startLocked: true,
      engineOn: false,
      allowPlayerExit: true,
    });

    const clear = logicById('d3-relay-siege-clear', 'relay');
    expectConnection(clear, { target: 'd3-extraction-helicopter', input: 'Unlock' });
    expectConnection(clear, { target: 'd3-extraction-helicopter', input: 'TurnOn' });
    expectConnection(clear, { target: 'd3-trg-extraction', input: 'Enable' });
  });

  it('deja la salida alcanzable aunque el helicóptero termine hecho chatarra', () => {
    const exit = level.triggers.find((trigger) => trigger.id === 'd3-trg-extraction');
    expect(exit?.startDisabled).toBe(true);
    // El volumen toca el piso: si sólo cazara al aparato en vuelo, perderlo
    // dejaría al jugador encerrado en el mapa sin forma de terminar.
    expect(exit!.position[1] - exit!.size[1] / 2).toBeLessThanOrEqual(0.5);
    expectConnection(exit!, { target: 'd3-changelevel-north', input: 'Trigger' });
  });

  it('encadena el asedio en tres oleadas separadas en el tiempo', () => {
    const siege = logicById('d3-relay-siege-start', 'relay');
    const delays = (siege.connections ?? [])
      .filter((connection) => connection.input === 'Spawn')
      .map((connection) => connection.delay ?? 0)
      .sort((a, b) => a - b);

    expect(delays).toHaveLength(3);
    for (let index = 1; index < delays.length; index += 1) {
      expect(delays[index] - delays[index - 1]).toBeGreaterThanOrEqual(20);
    }
  });

  it('no aplica ningún objetivo desde una coreografía', () => {
    // Una secuencia termina cuando el NPC llega y habla, y eso puede demorarse
    // arbitrariamente si le trabaron el paso o lo metieron en combate. Aplicar
    // el objetivo desde su `OnEnd` hace que el HUD retroceda a mitad del
    // capítulo: los objetivos salen de triggers y contadores, que son
    // deterministas y están ordenados.
    const objectiveNames = new Set(
      logicEntities
        .filter((entity) => entity.kind === 'objective')
        .map((entity) => effectiveName(entity)),
    );
    const fromSequences = (level.sequences ?? []).flatMap((sequence) =>
      (sequence.connections ?? [])
        .filter((connection) => objectiveNames.has(connection.target))
        .map((connection) => `${sequence.id} → ${connection.target}`),
    );

    expect(fromSequences).toEqual([]);
  });

  it('deja cada objetivo aplicado exactamente por una fuente determinista', () => {
    const objectives = logicEntities.filter((entity) => entity.kind === 'objective');
    const applied = new Set(
      allConnections()
        .filter(({ connection }) => connection.input === 'Apply')
        .map(({ connection }) => connection.target),
    );
    const orphans = objectives
      .map((objective) => effectiveName(objective))
      .filter((name) => !applied.has(name));

    expect(orphans).toEqual([]);
  });

  it('reparte cinco puntos de control por acto', () => {
    expect((level.checkpoints ?? []).map((checkpoint) => checkpoint.id)).toEqual([
      'd3-cp-start',
      'd3-cp-bowl',
      'd3-cp-depot',
      'd3-cp-gate',
      'd3-cp-relay',
    ]);
  });

  it('arma el capítulo con combate a pie por encima del vehicular', () => {
    const spawned = (level.logicEntities ?? []).flatMap((entity) =>
      entity.kind === 'npcSpawner' ? entity.npcs : [],
    );
    const hostiles = [...level.npcs, ...spawned].filter((npc) =>
      npc.characterId.startsWith('combine') || npc.characterId === 'manhack',
    );
    // El pedido del capítulo es explícito: los vehículos son el hilo, el peso
    // está en el combate a pie.
    expect(hostiles.length).toBeGreaterThanOrEqual(30);
    expect(level.vehicles?.length).toBeLessThanOrEqual(6);
  });
});
