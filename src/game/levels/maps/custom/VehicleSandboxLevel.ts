import { createMap } from '@game/levels/builders/MapCreator';
import type {
  VehicleDefinition,
  VehicleNavAreaDefinition,
  VehicleNavLaneDefinition,
  VehicleNavMarkerDefinition,
  VehicleWaypointDefinition,
} from '@game/levels/LevelDefinition';
import { cargoContainer, coverWall, crateStack, sandbagLine } from '@game/levels/builders/PropBuilder';

const ACTIVE_VEHICLES = [
  {
    id: 'vs-ai-res-buggy-lead',
    presetId: 'buggy',
    position: [-105, 1.1, 62],
    rotation: [0, Math.PI, 0],
    faction: 'resistance',
    accessPolicy: 'resistance',
    crew: [
      { actor: 'vs-driver-res-lead', role: 'driver', seatId: 'driver' },
      { actor: 'vs-gunner-res-lead', role: 'gunner', seatId: 'gunner' },
    ],
    weaponEnabled: true,
    engineOn: true,
    ai: { enabled: true, behavior: 'patrol', goal: 'vs-marker-convoy-goal' },
    portalTraversal: 'blocked',
  },
  {
    id: 'vs-ai-res-buggy-wing',
    presetId: 'buggy',
    position: [-105, 1.1, 74],
    rotation: [0, Math.PI, 0],
    faction: 'resistance',
    accessPolicy: 'resistance',
    crew: [{ actor: 'vs-driver-res-wing', role: 'driver', seatId: 'driver' }],
    weaponEnabled: true,
    engineOn: true,
    ai: { enabled: true, behavior: 'escort', goal: 'vs-ai-res-buggy-lead' },
    portalTraversal: 'blocked',
  },
  {
    id: 'vs-ai-combine-buggy-hunter',
    presetId: 'buggy',
    position: [-78, 1.1, -72],
    faction: 'combine',
    accessPolicy: 'combine',
    crew: [
      { actor: 'vs-driver-combine-hunter', role: 'driver', seatId: 'driver' },
      { actor: 'vs-gunner-combine-hunter', role: 'gunner', seatId: 'gunner' },
    ],
    weaponEnabled: true,
    engineOn: true,
    ai: { enabled: true, behavior: 'intercept', goal: 'vs-ai-res-buggy-lead' },
    portalTraversal: 'blocked',
  },
  {
    id: 'vs-ai-combine-buggy-flank',
    presetId: 'buggy',
    position: [-38, 1.1, -72],
    faction: 'combine',
    accessPolicy: 'combine',
    crew: [{ actor: 'vs-driver-combine-flank', role: 'driver', seatId: 'driver' }],
    weaponEnabled: true,
    engineOn: true,
    ai: { enabled: true, behavior: 'flank', goal: 'vs-marker-convoy-goal' },
    portalTraversal: 'blocked',
  },
  {
    // Sin `crew` autorada a propósito: los dos Combine de al lado tienen que
    // repartirse los puestos solos. Es el banco de pruebas de la coordinación.
    id: 'vs-ai-combine-helicopter',
    presetId: 'helicopterFree',
    position: [128, 1, -40],
    rotation: [0, Math.PI, 0],
    faction: 'combine',
    accessPolicy: 'combine',
    weaponEnabled: true,
    engineOn: true,
    ai: { enabled: true, behavior: 'intercept', goal: 'vs-ai-res-buggy-lead' },
    aiCrew: { roles: ['pilot', 'gunner'], radius: 25 },
    portalTraversal: 'blocked',
  },
  {
    id: 'vs-ai-res-airboat',
    presetId: 'airboat',
    position: [60, 0.6, 66],
    rotation: [0, Math.PI, 0],
    faction: 'resistance',
    accessPolicy: 'resistance',
    crew: [{ actor: 'vs-driver-res-airboat', role: 'driver', seatId: 'driver' }],
    weaponEnabled: true,
    engineOn: true,
    ai: { enabled: true, behavior: 'patrol', goal: 'vs-marker-water-south' },
    portalTraversal: 'blocked',
  },
  {
    id: 'vs-ai-combine-airboat',
    presetId: 'airboat',
    position: [60, 0.6, -64],
    faction: 'combine',
    accessPolicy: 'combine',
    crew: [{ actor: 'vs-driver-combine-airboat', role: 'driver', seatId: 'driver' }],
    weaponEnabled: true,
    engineOn: true,
    ai: { enabled: true, behavior: 'intercept', goal: 'vs-ai-res-airboat' },
    portalTraversal: 'blocked',
  },
] as const satisfies readonly VehicleDefinition[];

const PARKED_VEHICLES = [
  {
    // Tripulación quieta al lado del spawn: sirve para revisar la pose sentada
    // y las transiciones de subida/bajada sin correr atrás de un convoy.
    id: 'vs-parked-crewed-buggy',
    presetId: 'buggy',
    position: [-109, 1.1, 91],
    rotation: [0, Math.PI, 0],
    faction: 'resistance',
    accessPolicy: 'resistance',
    crew: [
      { actor: 'vs-parked-driver', role: 'driver', seatId: 'driver' },
      { actor: 'vs-parked-gunner', role: 'gunner', seatId: 'gunner' },
    ],
    weaponEnabled: true,
    engineOn: false,
    portalTraversal: 'blocked',
  },
  {
    id: 'vs-player-buggy',
    presetId: 'buggy',
    position: [-118, 1.1, 91],
    rotation: [0, Math.PI, 0],
    faction: 'resistance',
    accessPolicy: 'player',
    weaponEnabled: true,
    engineOn: false,
    transitionKey: 'sandbox-player-buggy',
    portalTraversal: 'blocked',
  },
  {
    id: 'vs-player-airboat',
    presetId: 'airboat',
    position: [47, 0.65, 88],
    rotation: [0, Math.PI, 0],
    faction: 'resistance',
    accessPolicy: 'player',
    weaponEnabled: true,
    engineOn: false,
    transitionKey: 'sandbox-player-airboat',
    portalTraversal: 'blocked',
  },
  {
    id: 'vs-player-helicopter',
    presetId: 'helicopter',
    position: [111, 2.1, 78],
    rotation: [0, Math.PI, 0],
    faction: 'resistance',
    accessPolicy: 'resistance',
    crew: [{ actor: 'vs-heli-pilot', role: 'pilot', seatId: 'pilot' }],
    weaponEnabled: true,
    engineOn: true,
    allowPlayerExit: true,
    pathStart: 'vs-heli-route-01',
    crashPathStart: 'vs-heli-crash-01',
    crashPolicy: 'survivable',
    pathLoop: true,
    transitionKey: 'sandbox-helicopter',
    portalTraversal: 'blocked',
    connections: [
      { output: 'OnStarted', target: 'vs-msg-heli-start', input: 'Show' },
      { output: 'OnStopped', target: 'vs-msg-heli-stop', input: 'Show' },
      { output: 'OnCrashed', target: 'vs-msg-heli-crash', input: 'Show' },
    ],
  },
  {
    // Arranca un metro sobre la plataforma: con el rotor al ralentí sostiene el
    // 94 % del peso, así que se posa solo en vez de golpear el hormigón.
    id: 'vs-free-helicopter',
    presetId: 'helicopterFree',
    position: [120, 1, 78],
    rotation: [0, Math.PI, 0],
    faction: 'resistance',
    accessPolicy: 'player',
    weaponEnabled: true,
    engineOn: true,
    transitionKey: 'sandbox-free-helicopter',
    portalTraversal: 'blocked',
  },
  {
    id: 'vs-parked-res-buggy',
    presetId: 'buggy',
    position: [-100, 1.1, 91],
    rotation: [0, Math.PI, 0],
    faction: 'resistance',
    accessPolicy: 'resistance',
    weaponEnabled: false,
    engineOn: false,
    portalTraversal: 'blocked',
  },
  {
    id: 'vs-parked-combine-buggy',
    presetId: 'buggy',
    position: [-82, 1.1, 91],
    rotation: [0, Math.PI, 0],
    faction: 'combine',
    accessPolicy: 'combine',
    weaponEnabled: true,
    engineOn: false,
    startLocked: true,
    portalTraversal: 'blocked',
  },
  {
    id: 'vs-parked-airboat',
    presetId: 'airboat',
    position: [73, 0.65, 88],
    rotation: [0, Math.PI, 0],
    faction: 'neutral',
    accessPolicy: 'player',
    weaponEnabled: false,
    engineOn: false,
    portalTraversal: 'blocked',
  },
  {
    id: 'vs-player-rebel-crawler',
    presetId: 'rebelCrawler',
    position: [-64, 1.25, 91],
    rotation: [0, Math.PI, 0],
    faction: 'resistance',
    accessPolicy: 'resistance',
    weaponEnabled: false,
    engineOn: false,
    transitionKey: 'sandbox-rebel-crawler',
    portalTraversal: 'blocked',
  },
  {
    id: 'vs-player-combine-glider',
    presetId: 'combineGlider',
    position: [96, 1.15, 86],
    rotation: [0, Math.PI, 0],
    faction: 'combine',
    accessPolicy: 'combine',
    weaponEnabled: false,
    engineOn: false,
    transitionKey: 'sandbox-combine-glider',
    portalTraversal: 'blocked',
  },
] as const satisfies readonly VehicleDefinition[];

const HELICOPTER_WAYPOINTS = [
  { id: 'vs-heli-route-01', position: [111, 10, 70], next: 'vs-heli-route-02', speed: 12 },
  { id: 'vs-heli-route-02', position: [78, 18, 52], next: 'vs-heli-route-03', speed: 20, bank: 0.18 },
  { id: 'vs-heli-route-03', position: [18, 21, 28], next: 'vs-heli-route-04', speed: 23, bank: 0.24 },
  { id: 'vs-heli-route-04', position: [-76, 19, 18], next: 'vs-heli-route-05', speed: 22, bank: -0.2 },
  { id: 'vs-heli-route-05', position: [-104, 16, -42], next: 'vs-heli-route-06', speed: 18, bank: -0.28 },
  { id: 'vs-heli-route-06', position: [-34, 20, -76], next: 'vs-heli-route-07', speed: 24, bank: 0.2 },
  { id: 'vs-heli-route-07', position: [68, 18, -62], next: 'vs-heli-route-08', speed: 22, bank: 0.24 },
  { id: 'vs-heli-route-08', position: [112, 12, 8], next: 'vs-heli-route-01', speed: 15, bank: -0.16 },
  { id: 'vs-heli-crash-01', position: [96, 11, 34], next: 'vs-heli-crash-02', speed: 17, bank: 0.32 },
  { id: 'vs-heli-crash-02', position: [115, 6, 50], next: 'vs-heli-crash-03', speed: 13, bank: -0.25 },
  { id: 'vs-heli-crash-03', position: [118, 1.4, 67], speed: 8 },
] as const satisfies readonly VehicleWaypointDefinition[];

const NAV_AREAS = [
  {
    id: 'vs-nav-ground-west',
    polygon: [[-136, 0, -106], [27, 0, -106], [27, 0, 106], [-136, 0, 106]],
    surface: 'ground',
    speedLimit: 24,
  },
  {
    id: 'vs-nav-water-channel',
    polygon: [[36, 0.7, -104], [84, 0.7, -104], [84, 0.7, 104], [36, 0.7, 104]],
    surface: 'water',
    speedLimit: 25,
  },
  {
    id: 'vs-nav-shore-west',
    polygon: [[25, 0, -100], [45, 0.7, -100], [45, 0.7, 100], [25, 0, 100]],
    surface: 'both',
    cost: 1.25,
    speedLimit: 9,
    flags: ['shore'],
  },
  {
    id: 'vs-nav-ground-east',
    polygon: [[92, 0, -106], [136, 0, -106], [136, 0, 106], [92, 0, 106]],
    surface: 'ground',
    speedLimit: 14,
    flags: ['parking'],
  },
] as const satisfies readonly VehicleNavAreaDefinition[];

const NAV_LANES = [
  {
    id: 'vs-lane-circuit-clockwise',
    points: [
      [-112, 0, 76],
      [-118, 0, 8],
      [-102, 0, -72],
      [-38, 0, -82],
      [12, 0, -56],
      [16, 0, 18],
      [-18, 0, 76],
      [-112, 0, 76],
    ],
    width: 6,
    direction: 'forward',
    speedLimit: 23,
    priority: 4,
    tags: ['circuito', 'convoy'],
  },
  {
    id: 'vs-lane-circuit-counter',
    points: [
      [-102, 0, 62],
      [-28, 0, 62],
      [4, 0, 14],
      [0, 0, -44],
      [-24, 0, -64],
      [-42, 0, -68],
      [-78, 0, -72],
      [-96, 0, -58],
      [-108, 0, 6],
      [-102, 0, 62],
    ],
    width: 5,
    direction: 'backward',
    speedLimit: 19,
    priority: 3,
    tags: ['circuito', 'tráfico'],
  },
  {
    id: 'vs-lane-water-northbound',
    points: [[51, 0.7, 88], [51, 0.7, 35], [51, 0.7, -25], [51, 0.7, -88]],
    width: 8,
    direction: 'forward',
    speedLimit: 24,
    priority: 3,
    tags: ['canal'],
  },
  {
    id: 'vs-lane-water-southbound',
    points: [
      [69, 0.7, -88],
      [60, 0.7, -64],
      [69, 0.7, -25],
      [69, 0.7, 35],
      [60, 0.7, 66],
      [69, 0.7, 88],
    ],
    width: 8,
    direction: 'forward',
    speedLimit: 24,
    priority: 3,
    tags: ['canal'],
  },
  {
    id: 'vs-lane-shore-transfer',
    points: [[-4, 0, 86], [22, 0, 82], [35, 0.35, 79], [49, 0.7, 78]],
    width: 7,
    direction: 'both',
    speedLimit: 8,
    priority: 2,
    tags: ['costa'],
  },
] as const satisfies readonly VehicleNavLaneDefinition[];

const NAV_MARKERS = [
  { id: 'vs-marker-player-buggy', position: [-118, 0, 91], heading: Math.PI, kind: 'boarding', allowedPresets: ['buggy'] },
  { id: 'vs-marker-player-airboat', position: [47, 0.7, 88], heading: Math.PI, kind: 'boarding', allowedPresets: ['airboat'] },
  { id: 'vs-marker-player-rebel-crawler', position: [-64, 0, 91], heading: Math.PI, kind: 'boarding', allowedPresets: ['rebelCrawler'] },
  { id: 'vs-marker-player-combine-glider', position: [96, 0, 86], heading: Math.PI, kind: 'boarding', allowedPresets: ['combineGlider'] },
  { id: 'vs-marker-heli-pad', position: [111, 0, 78], heading: Math.PI, kind: 'landingZone', allowedPresets: ['helicopter'] },
  { id: 'vs-marker-heli-free-pad', position: [128, 0, -40], heading: Math.PI, kind: 'landingZone', allowedPresets: ['helicopterFree'] },
  { id: 'vs-marker-convoy-goal', position: [-24, 0, -64], heading: Math.PI / 2, kind: 'dropZone', allowedPresets: ['buggy'] },
  { id: 'vs-marker-water-north', position: [60, 0.7, -88], heading: 0, kind: 'dropZone', allowedPresets: ['airboat'] },
  { id: 'vs-marker-water-south', position: [60, 0.7, 88], heading: Math.PI, kind: 'dropZone', allowedPresets: ['airboat'] },
  { id: 'vs-marker-passing-west', position: [-116, 0, -8], heading: 0, kind: 'passingBay', allowedPresets: ['buggy'] },
  { id: 'vs-marker-passing-east', position: [9, 0, -18], heading: Math.PI, kind: 'passingBay', allowedPresets: ['buggy'] },
  {
    id: 'vs-marker-recovery',
    position: [-14, 0, 88],
    heading: Math.PI / 2,
    kind: 'recovery',
    allowedPresets: ['buggy'],
    allowRecoverySnap: true,
  },
  { id: 'vs-marker-parking', position: [106, 0, 92], heading: Math.PI, kind: 'parking' },
] as const satisfies readonly VehicleNavMarkerDefinition[];

const map = createMap({
  id: 'vehicle-sandbox',
  title: 'Sandbox vehicular',
  description: 'Circuito de tierra, canal navegable, convoy, transporte oruga, deslizador Combine y helicóptero sobre rieles.',
  objective: { text: 'Probá el transporte oruga, el deslizador Combine y el resto de los vehículos', marker: [-64, 1.2, 91] },
  background: 0x91a9b5,
  sun: { direction: [0.35, 0.9, 0.25], color: 0xffe3ba, intensity: 1.65 },
  playerStart: [-126, 1.2, 96],
  audio: {
    ambiences: ['background.wind', 'background.hl2.wind.wasteland'],
    footstepSounds: [
      'footsteps.hl2.concrete1',
      'footsteps.hl2.concrete2',
      'footsteps.hl2.concrete3',
      'footsteps.hl2.concrete4',
    ],
    soundscape: 'wasteland',
  },
})
  .boxes(
    { id: 'vs-land-west', position: [-55, -0.25, 0], size: [170, 0.5, 220], material: 'sand' },
    { id: 'vs-land-east', position: [115, -0.25, 0], size: [50, 0.5, 220], material: 'concrete' },
    { id: 'vs-canal-bed', position: [60, -3.25, 0], size: [60, 0.5, 220], material: 'rock' },
    { id: 'vs-canal-bank-west', position: [34, -1.5, 0], size: [8.7, 0.5, 218], material: 'sand', rotation: [0, 0, -0.36] },
    { id: 'vs-canal-bank-east', position: [86, -1.5, 0], size: [8.7, 0.5, 218], material: 'concrete', rotation: [0, 0, 0.36] },
    { id: 'vs-boundary-west', position: [-140, 3, 0], size: [0.8, 6, 220], material: 'rock' },
    { id: 'vs-boundary-east', position: [140, 3, 0], size: [0.8, 6, 220], material: 'rock' },
    { id: 'vs-boundary-north', position: [0, 3, -110], size: [280, 6, 0.8], material: 'rock' },
    { id: 'vs-boundary-south', position: [0, 3, 110], size: [280, 6, 0.8], material: 'rock' },
    { id: 'vs-track-west', position: [-113, 0.04, 2], size: [11, 0.08, 150], material: 'asphalt' },
    { id: 'vs-track-north', position: [-55, 0.04, -79], size: [112, 0.08, 11], material: 'asphalt' },
    { id: 'vs-track-east', position: [5, 0.04, -20], size: [11, 0.08, 108], material: 'asphalt' },
    { id: 'vs-track-south', position: [-52, 0.04, 70], size: [116, 0.08, 11], material: 'asphalt' },
    { id: 'vs-jump-deck', position: [-78, 2.15, -31.5], size: [8, 0.5, 7], material: 'metalRusted' },
    { id: 'vs-save-station-spawn', position: [-129, 1.2, 89], size: [0.8, 2.4, 0.8], material: 'signalBlue' },
    { id: 'vs-save-station-track', position: [-104, 1.2, -54], size: [0.8, 2.4, 0.8], material: 'signalBlue' },
    { id: 'vs-save-station-canal', position: [28, 1.2, 82], size: [0.8, 2.4, 0.8], material: 'signalBlue' },
    { id: 'vs-save-station-heli', position: [102, 1.2, 91], size: [0.8, 2.4, 0.8], material: 'signalBlue' },
  )
  .ramp({
    id: 'vs-ramp-jump',
    start: [-78, -54],
    end: [-78, -35],
    startY: 0,
    endY: 2.4,
    width: 8,
    steps: 10,
    material: 'metalRusted',
  })
  .ramp({
    id: 'vs-ramp-hill',
    start: [-24, 48],
    end: [-7, 48],
    startY: 0,
    endY: 2,
    width: 7,
    steps: 9,
    material: 'sand',
  })
  .house({
    id: 'vs-control-shack',
    center: [113, 92],
    floorY: 0,
    width: 18,
    depth: 12,
    height: 3.4,
    removeWall: 'west',
    groundSlab: true,
    wallMaterial: 'concrete',
    roofMaterial: 'metalRusted',
  })
  .prop(
    cargoContainer({ id: 'vs-garage-container-a', at: [-124, 82], axis: 'z' }),
    cargoContainer({ id: 'vs-garage-container-b', at: [-94, 82], axis: 'z' }),
    sandbagLine({ id: 'vs-combat-cover-a', from: [-55, -56], to: [-42, -56] }),
    sandbagLine({ id: 'vs-combat-cover-b', from: [-24, -48], to: [-24, -35] }),
    coverWall({ id: 'vs-combat-cover-c', at: [-49, -42], axis: 'z', length: 7 }),
    crateStack({ id: 'vs-track-crates', at: [-20, 58], rows: 2, cols: 2, layers: 2, seed: 73 }),
  )
  .waterVolume({
    id: 'vs-canal-water',
    position: [60, -1.3, 0],
    size: [52, 4, 208],
    flow: [0, 0, -0.7],
    surface: 'canal',
  })
  .door({
    id: 'vs-console-heli-start',
    position: [108, 0.55, 94],
    size: [1.4, 1.1, 0.35],
    openOffset: [0, 1.25, 0],
    speed: 2,
    material: 'signalBlue',
    button: {
      id: 'vs-console-heli-start-button',
      label: 'INICIAR HELICÓPTERO / VELOCIDAD 20',
      position: [108, 1.05, 93.75],
      size: [0.45, 0.45, 0.16],
    },
    connections: [
      { output: 'OnOpen', target: 'vs-player-helicopter', input: 'Start' },
      { output: 'OnOpen', target: 'vs-player-helicopter', input: 'SetSpeed', param: 20 },
    ],
  })
  .door({
    id: 'vs-console-heli-stop',
    position: [113, 0.55, 94],
    size: [1.4, 1.1, 0.35],
    openOffset: [0, 1.25, 0],
    speed: 2,
    material: 'signalRed',
    button: {
      id: 'vs-console-heli-stop-button',
      label: 'DETENER HELICÓPTERO',
      position: [113, 1.05, 93.75],
      size: [0.45, 0.45, 0.16],
    },
    connections: [{ output: 'OnOpen', target: 'vs-player-helicopter', input: 'Stop' }],
  })
  .door({
    id: 'vs-console-heli-crash',
    position: [118, 0.55, 94],
    size: [1.4, 1.1, 0.35],
    openOffset: [0, 1.25, 0],
    speed: 2,
    material: 'hazard',
    button: {
      id: 'vs-console-heli-crash-button',
      label: 'PRUEBA DE CHOQUE',
      position: [118, 1.05, 93.75],
      size: [0.45, 0.45, 0.16],
    },
    connections: [{ output: 'OnOpen', target: 'vs-player-helicopter', input: 'Crash' }],
  });

for (const vehicle of [...ACTIVE_VEHICLES, ...PARKED_VEHICLES]) map.vehicle(vehicle);
for (const waypoint of HELICOPTER_WAYPOINTS) map.vehicleWaypoint(waypoint);
for (const area of NAV_AREAS) map.vehicleNavArea(area);
for (const lane of NAV_LANES) map.vehicleNavLane(lane);
for (const marker of NAV_MARKERS) map.vehicleNavMarker(marker);

map
  .npc({ id: 'vs-driver-res-lead', characterId: 'rebelM1', position: [-105, 1.2, 62] })
  .npc({ id: 'vs-gunner-res-lead', characterId: 'rebelF2', position: [-104, 1.2, 62] })
  .npc({ id: 'vs-driver-res-wing', characterId: 'rebelM2', position: [-105, 1.2, 74] })
  .npc({ id: 'vs-driver-combine-hunter', characterId: 'combine', position: [-78, 1.2, -72] })
  .npc({ id: 'vs-gunner-combine-hunter', characterId: 'combineElite', position: [-77, 1.2, -72] })
  .npc({ id: 'vs-driver-combine-flank', characterId: 'combine', position: [-38, 1.2, -72] })
  .npc({ id: 'vs-driver-res-airboat', characterId: 'rebelF1', position: [60, 1, 66] })
  .npc({ id: 'vs-driver-combine-airboat', characterId: 'combine', position: [60, 1, -64] })
  .npc({ id: 'vs-heli-pilot', characterId: 'rebelM3', position: [111, 1.2, 78] })
  // Tripulación aérea sin asignar: se reparten piloto y torreta por su cuenta.
  // Uno a cada lado del aparato, como una tripulación que camina a su puerta.
  .npc({ id: 'vs-heli-crew-combine-a', characterId: 'combine', position: [124, 1.2, -40] })
  .npc({ id: 'vs-heli-crew-combine-b', characterId: 'combineElite', position: [132, 1.2, -40] })
  .npc({ id: 'vs-parked-driver', characterId: 'rebelM3', position: [-109, 1.2, 91] })
  .npc({ id: 'vs-parked-gunner', characterId: 'rebelF3', position: [-108, 1.2, 91] })
  .npc({ id: 'vs-alyx-companion', characterId: 'alyx', position: [-123, 1.2, 92] })
  // Suelto al lado del buggy vacío: banco de pruebas de `Attach`/`Detach`.
  .npc({ id: 'vs-rebel-hitchhiker', characterId: 'rebelM1', position: [-100, 1.2, 95] })
  .pickup({ id: 'vs-pickup-rpg', weaponId: 'rpg', position: [-124, 0.5, 88] })
  .pickup({ id: 'vs-pickup-gravity-gun', weaponId: 'gravityGun', position: [-122, 0.5, 88] })
  .item({ id: 'vs-item-medkit', itemId: 'medkit', position: [-120, 0.45, 88] })
  .charger({ id: 'vs-charger-health', kind: 'health', position: [106, 0, 96], rotationY: Math.PI })
  .logic({
    kind: 'auto',
    id: 'vs-auto',
    connections: [
      { output: 'OnMapSpawn', target: 'vs-msg-welcome', input: 'Show' },
      { output: 'OnMapSpawn', target: 'vs-ai-res-buggy-lead', input: 'TurnOn' },
      { output: 'OnMapSpawn', target: 'vs-ai-res-buggy-wing', input: 'TurnOn' },
      { output: 'OnMapSpawn', target: 'vs-ai-combine-buggy-hunter', input: 'TurnOn' },
      { output: 'OnMapSpawn', target: 'vs-ai-combine-buggy-flank', input: 'TurnOn' },
      { output: 'OnMapSpawn', target: 'vs-ai-res-airboat', input: 'TurnOn' },
      { output: 'OnMapSpawn', target: 'vs-ai-combine-airboat', input: 'TurnOn' },
    ],
  })
  .logic({
    kind: 'message',
    id: 'vs-msg-welcome',
    name: 'vs-msg-welcome',
    speaker: 'Campo de pruebas',
    text: 'Seis tripulaciones están activas. Usá E para subir, R para cambiar de asiento y, como artillero, V para cambiar la conducción o C para marcar un destino.',
    duration: 9,
  })
  .logic({
    kind: 'message',
    id: 'vs-msg-heli-start',
    name: 'vs-msg-heli-start',
    speaker: 'Control',
    text: 'Ruta aérea iniciada a veinte metros por segundo.',
    duration: 3,
  })
  .logic({
    kind: 'message',
    id: 'vs-msg-heli-stop',
    name: 'vs-msg-heli-stop',
    speaker: 'Control',
    text: 'Helicóptero detenido sobre el riel.',
    duration: 3,
  })
  .logic({
    kind: 'message',
    id: 'vs-msg-heli-crash',
    name: 'vs-msg-heli-crash',
    speaker: 'Control',
    text: 'Choque sobrevivible completado. Tripulación liberada.',
    duration: 4,
  })
  .checkpoint({ id: 'vs-cp-spawn', position: [-126, 1.2, 94], size: [12, 4, 12], respawn: [-126, 1.2, 96] })
  .checkpoint({ id: 'vs-cp-track', position: [-106, 1.2, -54], size: [15, 4, 10], respawn: [-118, 1.2, -50] })
  .checkpoint({ id: 'vs-cp-canal', position: [28, 1.2, 82], size: [12, 4, 12], respawn: [22, 1.2, 82] })
  .checkpoint({ id: 'vs-cp-heli', position: [102, 1.2, 91], size: [12, 4, 12], respawn: [102, 1.2, 96] });

export const VehicleSandboxLevel = map.build();
