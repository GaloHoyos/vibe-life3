import { createMap } from '@game/levels/builders/MapCreator';
import type { VehicleWaypointDefinition } from '@game/levels/LevelDefinition';
import { cargoContainer, coverWall, crateStack, sandbagLine } from '@game/levels/builders/PropBuilder';

const FLIGHT_WAYPOINTS = [
  {
    id: 'd3-flight-01',
    position: [0, 6.5, 90],
    next: 'd3-flight-02',
    speed: 10,
    wait: 1,
    connections: [{ output: 'OnPass', target: 'd3-msg-liftoff', input: 'Show' }],
  },
  {
    id: 'd3-flight-02',
    position: [0, 17, 58],
    next: 'd3-flight-03',
    speed: 18,
    bank: 0.08,
  },
  {
    id: 'd3-flight-03',
    position: [-28, 23, 28],
    next: 'd3-flight-04',
    speed: 22,
    bank: 0.24,
    connections: [
      { output: 'OnPass', target: 'd3-msg-contact', input: 'Show' },
      { output: 'OnPass', target: 'd3-objective-fight', input: 'Apply' },
    ],
  },
  {
    id: 'd3-flight-04',
    position: [-40, 22, -12],
    next: 'd3-flight-05',
    speed: 21,
    bank: -0.2,
    connections: [{ output: 'OnPass', target: 'd3-damage-stage-one', input: 'Enable' }],
  },
  {
    id: 'd3-flight-05',
    position: [-20, 20, -54],
    next: 'd3-flight-06',
    speed: 18,
    bank: -0.28,
  },
  {
    id: 'd3-flight-06',
    position: [14, 17, -84],
    speed: 14,
    bank: 0.1,
  },
  {
    id: 'd3-crash-01',
    position: [14, 16, -72],
    next: 'd3-crash-02',
    speed: 16,
    bank: 0.34,
  },
  {
    id: 'd3-crash-02',
    position: [34, 10, -62],
    next: 'd3-crash-03',
    speed: 13,
    bank: -0.38,
  },
  {
    id: 'd3-crash-03',
    position: [52, 4.5, -49],
    next: 'd3-crash-04',
    speed: 10,
    bank: 0.28,
  },
  {
    id: 'd3-crash-04',
    position: [62, 1.35, -38],
    speed: 7,
  },
] as const satisfies readonly VehicleWaypointDefinition[];

const map = createMap({
  id: 'demo-03-whiteout-flight',
  title: 'Demo 3 — Cielo blanco',
  description: 'Gordon y Alyx cruzan la tormenta en un helicóptero de la Resistencia, repelen un ataque y sobreviven al choque.',
  nextLevel: 'snow-field',
  entryLandmark: { position: [0, 1.2, 100], yaw: 0 },
  objective: { text: 'Subí al helicóptero con Alyx', marker: [0, 5.5, 90] },
  background: 0xd9e4e8,
  sun: { direction: [-0.2, 0.7, 0.15], color: 0xe5f2f6, intensity: 0.72 },
  playerStart: [-6, 1.2, 96],
  audio: {
    ambiences: ['background.wind', 'background.hl2.wind.wasteland'],
    footstepSounds: ['footsteps.snow1', 'footsteps.snow2', 'footsteps.snow3', 'footsteps.snow4'],
    soundscape: 'wasteland',
  },
})
  .ground({
    size: [240, 260],
    material: 'snow',
    boundary: { height: 16, thickness: 1, material: 'rock' },
  })
  .boxes(
    { id: 'd3-ridge-west-a', position: [-94, 5, 48], size: [22, 10, 86], material: 'rock', rotation: [0, 0.18, 0] },
    { id: 'd3-ridge-west-b', position: [-101, 7, -55], size: [26, 14, 82], material: 'rock', rotation: [0, -0.12, 0] },
    { id: 'd3-ridge-east-a', position: [96, 4, 34], size: [18, 8, 92], material: 'rock', rotation: [0, -0.16, 0] },
    { id: 'd3-ridge-east-b', position: [102, 6, -74], size: [25, 12, 65], material: 'rock', rotation: [0, 0.2, 0] },
    { id: 'd3-landing-pad', position: [0, 0.08, 90], size: [24, 0.16, 24], material: 'concrete' },
    { id: 'd3-crash-clearing', position: [62, 0.08, -38], size: [34, 0.16, 30], material: 'snow' },
    { id: 'd3-save-station-board', position: [-10, 1.2, 99], size: [0.8, 2.4, 0.8], material: 'signalBlue' },
    { id: 'd3-save-station-crash', position: [72, 1.2, -30], size: [0.8, 2.4, 0.8], material: 'signalBlue' },
  )
  .house({
    id: 'd3-hangar',
    center: [-34, 92],
    floorY: 0,
    width: 28,
    depth: 22,
    height: 6,
    removeWall: 'east',
    groundSlab: true,
    wallMaterial: 'concrete',
    roofMaterial: 'metalRusted',
  })
  .prop(
    cargoContainer({ id: 'd3-pad-container-a', at: [-16, 78], axis: 'z' }),
    cargoContainer({ id: 'd3-pad-container-b', at: [17, 81], axis: 'x' }),
    crateStack({ id: 'd3-pad-supplies', at: [-17, 99], rows: 2, cols: 2, layers: 2, seed: 303 }),
    sandbagLine({ id: 'd3-crash-bags', from: [45, -25], to: [55, -20] }),
    coverWall({ id: 'd3-crash-cover', at: [70, -52], axis: 'x', length: 7 }),
  )
  .vehicle({
    id: 'd3-resistance-helicopter',
    presetId: 'helicopter',
    position: [0, 6.5, 90],
    faction: 'resistance',
    crew: [
      { actor: 'd3-pilot', role: 'pilot', seatId: 'pilot' },
      { actor: '!player', role: 'gunner', seatId: 'door-gunner' },
      { actor: 'd3-alyx', role: 'passenger', seatId: 'passenger' },
    ],
    weaponEnabled: true,
    engineOn: true,
    pathStart: 'd3-flight-01',
    crashPathStart: 'd3-crash-01',
    crashPolicy: 'survivable',
    transitionKey: 'northbound-resistance-helicopter',
    portalTraversal: 'blocked',
    connections: [
      { output: 'OnPlayerEntered', target: 'd3-msg-boarded', input: 'Show' },
      { output: 'OnStarted', target: 'd3-objective-gun', input: 'Apply' },
      { output: 'OnDamaged', target: 'd3-msg-alarm', input: 'Show', maxFires: 1 },
      { output: 'OnCrashed', target: 'd3-msg-survived', input: 'Show' },
      { output: 'OnCrashed', target: 'd3-objective-whiteout', input: 'Apply', delay: 1.5 },
      { output: 'OnCrashed', target: 'd3-resistance-helicopter', input: 'Detach', param: '!player', delay: 1.5 },
      { output: 'OnCrashed', target: 'd3-resistance-helicopter', input: 'Detach', param: 'd3-alyx', delay: 1.5 },
      { output: 'OnCrashed', target: 'd3-whiteout-exit', input: 'Enable', delay: 2.5 },
    ],
  });

for (const waypoint of FLIGHT_WAYPOINTS) map.vehicleWaypoint(waypoint);

map
  .vehicleNavMarker({
    id: 'd3-marker-boarding',
    position: [0, 0, 90],
    heading: 0,
    kind: 'boarding',
    allowedPresets: ['helicopter'],
  })
  .vehicleNavMarker({
    id: 'd3-marker-crash',
    position: [62, 0, -38],
    heading: Math.PI / 4,
    kind: 'landingZone',
    allowedPresets: ['helicopter'],
  })
  .npc({ id: 'd3-pilot', name: 'd3-pilot', characterId: 'rebelM3', position: [-2, 1.2, 91] })
  .npc({ id: 'd3-alyx', name: 'd3-alyx', characterId: 'alyx', position: [-5, 1.2, 92] })
  .npc({ id: 'd3-attacker-gunship-a', characterId: 'gunship', position: [-46, 24, 18] })
  .npc({ id: 'd3-attacker-gunship-b', characterId: 'gunship', position: [22, 20, -28] })
  .npc({ id: 'd3-attacker-gunship-c', characterId: 'gunship', position: [-6, 18, -70] })
  .pickup({ id: 'd3-pickup-ar3', weaponId: 'ar3', position: [-10, 0.5, 94] })
  .pickup({ id: 'd3-pickup-rpg', weaponId: 'rpg', position: [-8.5, 0.5, 94] })
  .item({ id: 'd3-item-medkit-pad', itemId: 'medkit', position: [-7, 0.45, 94] })
  .logic({
    kind: 'auto',
    id: 'd3-auto',
    connections: [
      { output: 'OnMapSpawn', target: 'd3-msg-intro', input: 'Show' },
      { output: 'OnMapSpawn', target: 'd3-resistance-helicopter', input: 'Attach', param: 'd3-pilot', delay: 0.6 },
      { output: 'OnMapSpawn', target: 'd3-resistance-helicopter', input: 'Attach', param: 'd3-alyx', delay: 0.8 },
      { output: 'OnMapSpawn', target: 'd3-resistance-helicopter', input: 'Attach', param: '!player', delay: 1.2 },
      { output: 'OnMapSpawn', target: 'd3-resistance-helicopter', input: 'EnableGun', delay: 1.5 },
      { output: 'OnMapSpawn', target: 'd3-resistance-helicopter', input: 'Start', delay: 3.8 },
      { output: 'OnMapSpawn', target: 'd3-resistance-helicopter', input: 'SetSpeed', param: 18, delay: 3.9 },
    ],
  })
  .logic({
    kind: 'message',
    id: 'd3-msg-intro',
    name: 'd3-msg-intro',
    speaker: 'Alyx',
    text: 'Gordon, subí. La tormenta ya se está cerrando sobre el paso.',
    duration: 4,
  })
  .logic({
    kind: 'message',
    id: 'd3-msg-boarded',
    name: 'd3-msg-boarded',
    speaker: 'Piloto',
    text: 'Puerta asegurada. Tenés la ametralladora; cuidá el arco izquierdo.',
    duration: 4,
  })
  .logic({
    kind: 'message',
    id: 'd3-msg-liftoff',
    name: 'd3-msg-liftoff',
    speaker: 'Piloto',
    text: 'Despegamos. Mantengan los ojos en la línea de nubes.',
    duration: 4,
  })
  .logic({
    kind: 'message',
    id: 'd3-msg-contact',
    name: 'd3-msg-contact',
    speaker: 'Alyx',
    text: '¡Contactos aéreos! Gordon, sacalos de nuestra cola.',
    duration: 4,
  })
  .logic({
    kind: 'message',
    id: 'd3-msg-alarm',
    name: 'd3-msg-alarm',
    speaker: 'Sistema',
    text: 'Impacto confirmado. Integridad del motor comprometida.',
    duration: 3,
  })
  .logic({
    kind: 'message',
    id: 'd3-msg-damage-one',
    name: 'd3-msg-damage-one',
    speaker: 'Piloto',
    text: 'Perdemos aceite. Bajo a catorce metros por segundo.',
    duration: 4,
  })
  .logic({
    kind: 'message',
    id: 'd3-msg-damage-two',
    name: 'd3-msg-damage-two',
    speaker: 'Alyx',
    text: '¡El rotor no aguanta! Gordon, preparate para el impacto.',
    duration: 4,
  })
  .logic({
    kind: 'message',
    id: 'd3-msg-survived',
    name: 'd3-msg-survived',
    speaker: 'Alyx',
    text: 'Estoy bien. El helicóptero no. Tenemos que cruzar el whiteout a pie.',
    duration: 5,
  })
  .logic({
    kind: 'objective',
    id: 'd3-objective-gun',
    name: 'd3-objective-gun',
    text: 'Defendé el helicóptero desde la ametralladora de puerta',
    marker: [-30, 22, 20],
  })
  .logic({
    kind: 'objective',
    id: 'd3-objective-fight',
    name: 'd3-objective-fight',
    text: 'Derribá a los atacantes antes de entrar en la tormenta',
    marker: [-12, 20, -34],
  })
  .logic({
    kind: 'objective',
    id: 'd3-objective-whiteout',
    name: 'd3-objective-whiteout',
    text: 'Salí del wreckage y seguí a Alyx hacia el whiteout',
    marker: [72, 1.5, -26],
  })
  .logic({
    kind: 'timer',
    id: 'd3-damage-stage-one',
    name: 'd3-damage-stage-one',
    interval: 1,
    startDisabled: true,
    connections: [
      { output: 'OnTimer', target: 'd3-msg-damage-one', input: 'Show', maxFires: 1 },
      { output: 'OnTimer', target: 'd3-resistance-helicopter', input: 'SetSpeed', param: 14, maxFires: 1 },
      { output: 'OnTimer', target: 'd3-damage-stage-two', input: 'Enable', delay: 4, maxFires: 1 },
      { output: 'OnTimer', target: '!self', input: 'Disable', maxFires: 1 },
    ],
  })
  .logic({
    kind: 'timer',
    id: 'd3-damage-stage-two',
    name: 'd3-damage-stage-two',
    interval: 1,
    startDisabled: true,
    connections: [
      { output: 'OnTimer', target: 'd3-msg-damage-two', input: 'Show', maxFires: 1 },
      { output: 'OnTimer', target: 'd3-resistance-helicopter', input: 'SetSpeed', param: 8, maxFires: 1 },
      { output: 'OnTimer', target: 'd3-resistance-helicopter', input: 'Crash', delay: 4, maxFires: 1 },
      { output: 'OnTimer', target: '!self', input: 'Disable', maxFires: 1 },
    ],
  })
  .logic({
    kind: 'changelevel',
    id: 'd3-changelevel-whiteout',
    name: 'd3-changelevel-whiteout',
    landmark: { position: [62, 1.2, -38], yaw: 0 },
  })
  .trigger({
    id: 'd3-whiteout-exit',
    position: [74, 1.5, -23],
    size: [16, 4, 12],
    once: true,
    startDisabled: true,
    connections: [{ output: 'OnStartTouch', target: 'd3-changelevel-whiteout', input: 'Trigger' }],
  })
  .checkpoint({ id: 'd3-cp-boarding', position: [-4, 2, 94], size: [20, 5, 16], respawn: [-6, 1.2, 96] })
  .checkpoint({ id: 'd3-cp-attack', position: [-28, 20, 8], size: [90, 36, 76], respawn: [-6, 1.2, 96] })
  .checkpoint({ id: 'd3-cp-crash', position: [62, 2, -38], size: [28, 7, 25], respawn: [69, 1.2, -31] });

export const Demo3WhiteoutFlight = map.build();
