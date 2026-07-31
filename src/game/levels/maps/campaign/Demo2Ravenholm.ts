import { createMap } from '@game/levels/builders/MapCreator';
import {
  crateStack,
  coverWall,
  pillar,
  sandbagLine,
  watchtower,
} from '@game/levels/builders/PropBuilder';
import { DEMO2_DETAIL_ARTIFACT } from './Demo2RavenholmGeometry';

/**
 * Demo 2 — «La última campana».
 *
 * Capítulo de horror autocontenido, construido como un distrito plegado en vez
 * de un corredor: llegada y cementerio → plaza del crematorio → capilla-refugio
 * → patio de cuarentena → osario → techos → estación → fundición → mina.
 *
 * La historia y la mecánica comparten el mismo objetivo. Un grupo de civiles
 * espera en los túneles de la cantera, pero sólo se moverá cuando oiga la vieja
 * sirena de Ravenholm. La escalera del control de cuarentena colapsó; el jugador
 * debe recuperar una portal gun, alcanzar el balcón con un par de portales y
 * abrir el único portón hacia la central. Activar la sirena atrae a la horda y
 * convierte la salida por la mina en el clímax del nivel.
 *
 * Contratos importantes:
 * - El ID permanece estable porque Demo 1 encadena a `demo-02-ravenholm`.
 * - El puzzle de portal no depende de eventos `portal.*`: un trigger confirma
 *   la llegada al balcón y el botón físico de la puerta completa la acción.
 * - Los contadores de combates críticos tienen fallback ante fallos de spawn;
 *   el clímax además dispone de un timer de seguridad para no hardlockear.
 */
const map = createMap({
  id: 'demo-02-ravenholm',
  title: 'Demo 2 — La última campana',
  description: 'Capítulo de horror completo: un pueblo plegado, una historia autocontenida, combate por capas, portal gun, puzzle vertical y defensa final.',
  nextLevel: 'demo-03-whiteout-flight',
  entryLandmark: { position: [-92, 1.2, 140], yaw: 0 },
  objective: { text: 'Encontrá al hombre de la linterna en el cementerio', marker: [-84, 1.6, 136] },
  background: 0x05070a,
  sun: { direction: [-0.28, 0.62, -0.42], color: 0x526176, intensity: 0.48 },
  playerStart: [-92, 1.2, 140],
  audio: {
    ambiences: ['background.wind', 'background.hl2.wind.wasteland', 'background.hl2.atmosphere.cityRumble'],
    footstepSounds: ['footsteps.hl2.concrete1', 'footsteps.hl2.concrete2', 'footsteps.hl2.concrete3', 'footsteps.hl2.concrete4'],
    soundscape: 'wasteland',
  },
})
  .ground({
    size: [240, 320],
    material: 'grass',
    boundary: { height: 14, thickness: 0.8, material: 'rock' },
  })
  .building(DEMO2_DETAIL_ARTIFACT)

  // ── Masas arquitectónicas principales ──────────────────────────────────────
  .house({
    id: 'd2-building-keepers-house',
    center: [-88, 126],
    floorY: 0,
    width: 15,
    depth: 12,
    height: 3.4,
    door: { side: 'south', width: 1.5 },
    windows: 'auto',
    groundSlab: true,
    wallMaterial: 'woodDark',
    roofMaterial: 'roof',
  })
  .structure({
    id: 'd2-building-crematorium',
    center: [-68, 108],
    groundY: 0,
    width: 24,
    depth: 20,
    storyHeight: 4.4,
    roof: 'flat',
    pilasters: true,
    palette: { base: 'brick', upper: 'plaster', trim: 'metalRusted', roof: 'roof', floor: 'concrete' },
    stories: [
      { doors: [{ side: 'east', width: 2.4 }, { side: 'south', width: 1.6 }], windows: 'auto' },
      { windows: 'auto' },
    ],
  })
  .structure({
    id: 'd2-building-chapel',
    center: [-10, 86],
    groundY: 0,
    width: 24,
    depth: 24,
    storyHeight: 5.1,
    roof: 'gable',
    pilasters: true,
    palette: { base: 'plaster', upper: 'brick', trim: 'concrete', roof: 'roof', floor: 'woodDark' },
    stories: [
      { doors: [{ side: 'west', width: 2.8 }, { side: 'east', width: 2.8 }], windows: 'auto' },
    ],
  })
  .structure({
    id: 'd2-building-ossuary',
    center: [74, 29],
    groundY: 0,
    width: 18,
    depth: 18,
    storyHeight: 3.8,
    roof: 'gable',
    pilasters: true,
    palette: { base: 'brick', upper: 'plaster', trim: 'concrete', roof: 'roof', floor: 'concrete' },
    stories: [
      { doors: [{ side: 'west', width: 2.2 }, { side: 'south', width: 2.2 }], windows: 'auto' },
    ],
  })
  .structure({
    id: 'd2-building-foundry',
    center: [28, -47],
    groundY: 0,
    width: 30,
    depth: 24,
    storyHeight: 5,
    roof: 'flat',
    pilasters: true,
    palette: { base: 'brick', upper: 'wall', trim: 'metalRusted', roof: 'metalRusted', floor: 'concrete' },
    stories: [
      { doors: [{ side: 'north', width: 3.5 }, { side: 'west', width: 3.5 }], windows: 'auto' },
      { windows: 'auto' },
    ],
  })
  .structure({
    id: 'd2-building-mine',
    center: [-84, -118],
    groundY: 0,
    width: 22,
    depth: 22,
    storyHeight: 4.6,
    roof: 'flat',
    pilasters: true,
    palette: { base: 'rock', upper: 'concrete', trim: 'metalRusted', roof: 'roof', floor: 'concrete' },
    stories: [
      { doors: [{ side: 'south', width: 5.6 }], windows: 'none' },
    ],
  })

  // ── Cobertura y siluetas jugables: cada hub tiene lectura propia ────────────
  .prop(
    sandbagLine({ id: 'd2-arrival-barricade', from: [-101, 134], to: [-94, 128] }),
    watchtower({ id: 'd2-cemetery-watch', at: [-79, 133], rampSide: 'west' }),
    pillar({ id: 'd2-cemetery-gate-a', at: [-72, 126] }),
    pillar({ id: 'd2-cemetery-gate-b', at: [-66, 121] }),
    crateStack({ id: 'd2-crematorium-crates-a', at: [-54, 115], layers: 2, seed: 12 }),
    crateStack({ id: 'd2-crematorium-crates-b', at: [-42, 102], layers: 1, seed: 21 }),
    coverWall({ id: 'd2-crematorium-cover-a', at: [-52, 104], axis: 'z', length: 6 }),
    coverWall({ id: 'd2-crematorium-cover-b', at: [-39, 112], axis: 'x', length: 5 }),
    crateStack({ id: 'd2-ossuary-crates', at: [59, 24], layers: 1, seed: 8 }),
    coverWall({ id: 'd2-ossuary-cover-a', at: [64, 35], axis: 'x', length: 6 }),
    coverWall({ id: 'd2-ossuary-cover-b', at: [78, 15], axis: 'z', length: 5 }),
    crateStack({ id: 'd2-station-crates-a', at: [2, -37], layers: 2, seed: 5 }),
    crateStack({ id: 'd2-station-crates-b', at: [-6, -53], layers: 1, seed: 14 }),
    coverWall({ id: 'd2-station-cover-a', at: [11, -35], axis: 'x', length: 7 }),
    coverWall({ id: 'd2-station-cover-b', at: [-3, -49], axis: 'z', length: 6 }),
    sandbagLine({ id: 'd2-final-barricade', from: [-57, -75], to: [-49, -81] }),
    coverWall({ id: 'd2-final-cover-a', at: [-39, -67], axis: 'x', length: 6 }),
    coverWall({ id: 'd2-final-cover-b', at: [-31, -80], axis: 'z', length: 6 }),
    crateStack({ id: 'd2-final-crates', at: [-50, -68], layers: 1, seed: 19 }),
  )

  // ── Puzzle de portales ──────────────────────────────────────────────────────
  // El portón es dinámico (no portalable). Su único botón está en el balcón,
  // 4.15 m sobre el piso y sin escalera. El suelo del patio y el gran panel
  // estático del muro este permiten crear el par piso → pared y aterrizar arriba.
  .door({
    id: 'd2-door-quarantine-gate',
    position: [39, 1.7, 52],
    size: [5, 3.4, 0.48],
    openOffset: [0, 3.8, 0],
    speed: 2.1,
    material: 'door',
    button: {
      id: 'd2-door-quarantine-gate-btn',
      label: 'LIBERAR PORTÓN DE CUARENTENA',
      position: [45, 5.35, 61],
      size: [0.48, 0.48, 0.16],
    },
    connections: [
      { output: 'OnOpen', target: 'd2-relay-portal-complete', input: 'Trigger', maxFires: 1 },
    ],
  })

  // Panel de arranque de la sirena. Se modela como una puerta mínima para
  // reutilizar interacción + OnOpen sin introducir una acción de desarrollo.
  .door({
    id: 'd2-door-siren-switch',
    position: [-42, 1.05, -77],
    size: [1.7, 1.8, 0.3],
    openOffset: [0, 1.95, 0],
    speed: 1.35,
    material: 'signalRed',
    button: {
      id: 'd2-door-siren-switch-btn',
      label: 'ARRANCAR SIRENA Y MALACATE',
      position: [-40.8, 1.05, -76.82],
      size: [0.46, 0.46, 0.16],
    },
    connections: [
      { output: 'OnOpen', target: 'd2-relay-final-start', input: 'Trigger' },
    ],
  })

  // Separa la estación del patio de la sirena. La botonera queda fuera de uso:
  // el counter de la estación levanta el portón al terminar el encuentro.
  .door({
    id: 'd2-door-foundry-gate',
    position: [-16, 1.75, -58.5],
    size: [5.8, 3.5, 0.5],
    rotation: [0, -2.05, 0],
    openOffset: [0, 3.9, 0],
    speed: 2.2,
    material: 'door',
    button: {
      id: 'd2-door-foundry-gate-btn',
      label: 'PORTÓN DE FUNDICIÓN',
      position: [-16, -1.2, -58.5],
      size: [0.34, 0.34, 0.12],
    },
  })

  // La botonera de esta puerta queda enterrada: sólo la lógica del clímax puede
  // abrirla. Así la mina funciona como una salida real y no como un atajo.
  .door({
    id: 'd2-door-mine-lift',
    position: [-84, 1.8, -107],
    size: [5.6, 3.6, 0.5],
    openOffset: [0, 4.1, 0],
    speed: 2.2,
    material: 'metalRusted',
    button: {
      id: 'd2-door-mine-lift-btn',
      label: 'COMPUERTA DEL MALACATE',
      position: [-80.5, -1.2, -107],
      size: [0.34, 0.34, 0.12],
    },
    connections: [
      { output: 'OnOpen', target: 'd2-msg-mine-open', input: 'Show', maxFires: 1 },
    ],
  });

// ── Personajes y progresión de armas ─────────────────────────────────────────
map
  .npc({ id: 'd2-npc-grigori', name: 'd2-grigori', characterId: 'rebelM3', position: [-84, 1, 136] })
  .npcInRoom('d2-building-chapel', 0, [-3, 1], {
    id: 'd2-npc-tomas',
    name: 'd2-tomas',
    characterId: 'rebelM1',
  })
  .npc({ id: 'd2-npc-marta', name: 'd2-marta', characterId: 'rebelF2', position: [-55, 1, -76] })

  // Si se entra desde el selector, el nivel sigue siendo autosuficiente. Si se
  // llega desde Demo 1, los duplicados sólo reponen munición según el inventario.
  .pickup({ id: 'd2-pickup-crowbar', weaponId: 'crowbar', position: [-96, 0.45, 142] })
  .pickup({ id: 'd2-pickup-pistol', weaponId: 'pistol', position: [-93.8, 0.45, 142] })
  .ammo({ id: 'd2-ammo-pistol-start', ammoId: 'pistol', position: [-91.8, 0.45, 142] })
  .item({ id: 'd2-item-medkit-start', itemId: 'medkit', position: [-98.2, 0.45, 142] })

  // La escopeta es la recompensa del crematorio, antes de entrar a interiores.
  .pickup({ id: 'd2-pickup-shotgun', weaponId: 'shotgun', position: [-41, 0.48, 104] })
  .ammo({ id: 'd2-ammo-shotgun-plaza-a', ammoId: 'shotgun', position: [-39.7, 0.45, 104] })
  .ammo({ id: 'd2-ammo-shotgun-plaza-b', ammoId: 'shotgun', position: [-38.4, 0.45, 104] })
  .item({ id: 'd2-item-medkit-plaza', itemId: 'medkit', position: [-41, 0.45, 102.6] })

  // Pickup obligatorio: está en el eje de salida de la capilla. El trigger de
  // tutorial ocupa el mismo umbral para explicar controles y aplicar objetivo.
  .pickup({ id: 'd2-pickup-portal-gun', weaponId: 'portalGun', position: [-1.5, 0.52, 86] })
  .itemInRoom('d2-building-chapel', 0, [4, -5], { id: 'd2-item-battery-chapel', itemId: 'hevBattery' })
  .ammoInRoom('d2-building-chapel', 0, [3, 5], { id: 'd2-ammo-shotgun-chapel', ammoId: 'shotgun' })
  .chargerInRoom('d2-building-chapel', 0, [-7.5, -8.5], { id: 'd2-charger-chapel-health', kind: 'health' })
  .chargerInRoom('d2-building-chapel', 0, [-5.7, -8.5], { id: 'd2-charger-chapel-armor', kind: 'armor' })

  // Después del tutorial, el osario introduce física y combate vertical.
  .pickup({ id: 'd2-pickup-gravity-gun', weaponId: 'gravityGun', position: [55, 0.5, 43] })
  .pickup({ id: 'd2-pickup-smg', weaponId: 'smg', position: [62, 0.48, 42] })
  .ammo({ id: 'd2-ammo-shotgun-ossuary', ammoId: 'shotgun', position: [56.4, 0.45, 43] })
  .ammo({ id: 'd2-ammo-smg-ossuary', ammoId: 'smg', position: [63.4, 0.45, 42] })
  .item({ id: 'd2-item-medkit-ossuary', itemId: 'medkit', position: [57.8, 0.45, 43] })
  .pickupInRoom('d2-building-ossuary', 0, [4, 4], { id: 'd2-pickup-revolver-secret', weaponId: 'revolver' })
  .ammoInRoom('d2-building-ossuary', 0, [2, 4], { id: 'd2-ammo-revolver-secret', ammoId: 'revolver' })

  // Estación y clímax: recursos repartidos entre rutas opuestas, no en fila.
  .pickup({ id: 'd2-pickup-grenade', weaponId: 'grenade', position: [18, 0.45, -31] })
  .ammo({ id: 'd2-ammo-grenade-station', ammoId: 'grenade', position: [19.4, 0.45, -31] })
  .ammo({ id: 'd2-ammo-shotgun-station', ammoId: 'shotgun', position: [-7, 0.45, -57] })
  .ammo({ id: 'd2-ammo-smg-station', ammoId: 'smg', position: [7, 0.45, -58] })
  .item({ id: 'd2-item-medkit-station-a', itemId: 'medkit', position: [-9, 0.45, -38] })
  .item({ id: 'd2-item-battery-station', itemId: 'hevBattery', position: [17, 0.45, -55] })
  .pickupInRoom('d2-building-foundry', 1, [8, 6], { id: 'd2-pickup-crossbow-secret', weaponId: 'crossbow' })
  .ammoInRoom('d2-building-foundry', 1, [5.5, 6], { id: 'd2-ammo-crossbow-secret', ammoId: 'crossbow' })
  .ammo({ id: 'd2-ammo-shotgun-final', ammoId: 'shotgun', position: [-55, 0.45, -72] })
  .ammo({ id: 'd2-ammo-grenade-final', ammoId: 'grenade', position: [-53.6, 0.45, -72] })
  .item({ id: 'd2-item-medkit-final-a', itemId: 'medkit', position: [-52.2, 0.45, -72] })
  .item({ id: 'd2-item-medkit-final-b', itemId: 'medkit', position: [-31, 0.45, -83] })
  .charger({ id: 'd2-charger-final-health', kind: 'health', position: [-57, 0, -80], rotationY: Math.PI / 2 })
  .charger({ id: 'd2-charger-final-armor', kind: 'armor', position: [-57, 0, -82], rotationY: Math.PI / 2 });

// Cajas móviles separadas de los targets de portal: sirven para gravedad,
// cobertura improvisada y experimentación a través de los portales.
map.dynamicBoxes(
  { id: 'd2-dynamic-crematorium-a', position: [-49, 0.65, 115], size: [1.3, 1.3, 1.3], mass: 18, material: 'crate' },
  { id: 'd2-dynamic-crematorium-b', position: [-44, 0.5, 99], size: [1, 1, 1], mass: 14, material: 'crate' },
  { id: 'd2-dynamic-chapel-pew-a', position: [-10, 0.45, 92], size: [3.2, 0.9, 0.7], mass: 28, material: 'woodDark' },
  { id: 'd2-dynamic-chapel-pew-b', position: [-10, 0.45, 80], size: [3.2, 0.9, 0.7], mass: 28, material: 'woodDark' },
  { id: 'd2-dynamic-portal-crate', position: [24, 0.55, 58], size: [1.1, 1.1, 1.1], mass: 16, material: 'crate' },
  { id: 'd2-dynamic-ossuary-a', position: [61, 0.6, 30], size: [1.2, 1.2, 1.2], mass: 17, material: 'crate' },
  { id: 'd2-dynamic-ossuary-b', position: [69, 0.45, 17], size: [1.6, 0.9, 0.9], mass: 20, material: 'metalRusted' },
  { id: 'd2-dynamic-station-a', position: [4, 0.65, -39], size: [1.3, 1.3, 1.3], mass: 18, material: 'crate' },
  { id: 'd2-dynamic-station-b', position: [-2, 0.5, -55], size: [1, 1, 1], mass: 14, material: 'crate' },
  { id: 'd2-dynamic-final-a', position: [-35, 0.65, -69], size: [1.3, 1.3, 1.3], mass: 18, material: 'crate' },
  { id: 'd2-dynamic-final-b', position: [-47, 0.5, -86], size: [1, 1, 1], mass: 14, material: 'metalRusted' },
);

for (const [id, position] of [
  ['d2-barrel-crematorium-a', [-55, 0, 108]],
  ['d2-barrel-crematorium-b', [-43, 0, 115]],
  ['d2-barrel-crematorium-c', [-36, 0, 104]],
  ['d2-barrel-ossuary-a', [59, 0, 36]],
  ['d2-barrel-ossuary-b', [73, 0, 18]],
  ['d2-barrel-rooftop-a', [66, 0, -5]],
  ['d2-barrel-station-a', [14, 0, -36]],
  ['d2-barrel-station-b', [-5, 0, -46]],
  ['d2-barrel-station-c', [5, 0, -58]],
  ['d2-barrel-final-a', [-35, 0, -72]],
  ['d2-barrel-final-b', [-48, 0, -65]],
  ['d2-barrel-final-c', [-29, 0, -84]],
] as const) {
  map.explosiveBarrel({ id, position: [...position] });
}

// El fuego recorta rutas, pero siempre deja flancos anchos y legibles.
map
  .hazardVolume({ id: 'd2-hazard-crematorium-fire', position: [-58, 0.7, 100], size: [7, 2.2, 5], kind: 'fire', damagePerSecond: 34 })
  .hazardVolume({ id: 'd2-hazard-ossuary-fire', position: [69, 0.7, 7], size: [8, 2.2, 5], kind: 'fire', damagePerSecond: 36 })
  .hazardVolume({ id: 'd2-hazard-burning-street-a', position: [-18, 0.7, -64], size: [10, 2.2, 5], kind: 'fire', damagePerSecond: 40 })
  .hazardVolume({ id: 'd2-hazard-burning-street-b', position: [-25, 0.7, -75], size: [5, 2.2, 9], kind: 'fire', damagePerSecond: 40 });

// ── Objetivos, diálogos y paisajes sonoros ───────────────────────────────────
map
  .logic({
    kind: 'auto',
    id: 'd2-auto-boot',
    name: 'd2-auto-boot',
    connections: [
      { output: 'OnMapSpawn', target: 'd2-msg-cold-open', input: 'Show' },
      { output: 'OnMapSpawn', target: 'd2-obj-find-grigori', input: 'Apply' },
    ],
  })
  .logic({ kind: 'objective', id: 'd2-obj-find-grigori', name: 'd2-obj-find-grigori', text: 'Encontrá al hombre de la linterna en el cementerio', marker: [-84, 1.6, 136] })
  .logic({ kind: 'objective', id: 'd2-obj-clear-crematorium', name: 'd2-obj-clear-crematorium', text: 'Cruzá la plaza del crematorio y despejá el acceso', marker: [-48, 1.6, 108] })
  .logic({ kind: 'objective', id: 'd2-obj-reach-chapel', name: 'd2-obj-reach-chapel', text: 'Buscá al hermano Tomás en la capilla', marker: [-18, 1.6, 86] })
  .logic({ kind: 'objective', id: 'd2-obj-take-portal-gun', name: 'd2-obj-take-portal-gun', text: 'Recuperá el prototipo de fase junto al altar', marker: [-1.5, 1.2, 86] })
  .logic({ kind: 'objective', id: 'd2-obj-portal-gate', name: 'd2-obj-portal-gate', text: 'Usá dos portales para alcanzar el control elevado', marker: [45, 5.35, 61] })
  .logic({ kind: 'objective', id: 'd2-obj-press-gate', name: 'd2-obj-press-gate', text: 'Accioná el control de cuarentena desde el balcón', marker: [45, 5.35, 61] })
  .logic({ kind: 'objective', id: 'd2-obj-clear-ossuary', name: 'd2-obj-clear-ossuary', text: 'Atravesá el osario y alcanzá los techos', marker: [68, 1.6, 14] })
  .logic({ kind: 'objective', id: 'd2-obj-reach-station', name: 'd2-obj-reach-station', text: 'Seguí la línea férrea hasta la fundición', marker: [10, 1.6, -45] })
  .logic({ kind: 'objective', id: 'd2-obj-clear-station', name: 'd2-obj-clear-station', text: 'Despejá la estación para llegar al tablero de la sirena', marker: [2, 1.6, -48] })
  .logic({ kind: 'objective', id: 'd2-obj-start-siren', name: 'd2-obj-start-siren', text: 'Arrancá la sirena y el malacate de la mina', marker: [-42, 1.4, -77] })
  .logic({ kind: 'objective', id: 'd2-obj-defend', name: 'd2-obj-defend', text: 'Defendé el tablero mientras la sirena guía a los refugiados', marker: [-42, 1.6, -77] })
  .logic({ kind: 'objective', id: 'd2-obj-escape', name: 'd2-obj-escape', text: 'La señal llegó: escapá por el malacate de la mina', marker: [-84, 1.6, -118] })

  .logic({ kind: 'message', id: 'd2-msg-cold-open', name: 'd2-msg-cold-open', speaker: 'Radio de emergencia', text: 'Cantera Norte a cualquiera que escuche: treinta y dos personas bajo tierra. No saldremos sin la señal.', duration: 5.5 })
  .logic({ kind: 'message', id: 'd2-msg-plaza', name: 'd2-msg-plaza', speaker: 'Grigori', text: 'El crematorio está lleno de ellos. Usá los hornos, las esquinas y todo lo que explote.', duration: 4.5 })
  .logic({ kind: 'message', id: 'd2-msg-plaza-clear', name: 'd2-msg-plaza-clear', speaker: 'Grigori', text: 'La capilla sigue en pie. Tomás guardó allí una herramienta capaz de alcanzar lugares imposibles.', duration: 5 })
  .logic({ kind: 'message', id: 'd2-msg-chapel-entry', name: 'd2-msg-chapel-entry', speaker: 'Hermano Tomás', text: 'Cerrá la puerta detrás tuyo. Acá adentro el pueblo todavía recuerda el silencio.', duration: 4.5 })
  .logic({ kind: 'message', id: 'd2-msg-portal-tutorial', name: 'd2-msg-portal-tutorial', speaker: 'Hermano Tomás', text: 'Tecla 1 cicla hasta el prototipo. Disparo primario abre el portal azul; alternativo, el naranja. Necesitás ambos.', duration: 7 })
  .logic({ kind: 'message', id: 'd2-msg-courtyard', name: 'd2-msg-courtyard', speaker: 'Grigori', text: 'El portón no cede y la escalera del control ya no existe. Piso amplio, pared alta... pensá con esa máquina.', duration: 6 })
  .logic({ kind: 'message', id: 'd2-msg-portal-landing', name: 'd2-msg-portal-landing', speaker: 'Hermano Tomás', text: 'Eso es. El botón está al otro extremo del balcón. No mires hacia abajo.', duration: 4 })
  .logic({ kind: 'message', id: 'd2-msg-portal-complete', name: 'd2-msg-portal-complete', speaker: 'Grigori', text: '¡Abierto! El osario desemboca en los techos; desde allí vas a ver la estación.', duration: 4.5 })
  .logic({ kind: 'message', id: 'd2-msg-ossuary', name: 'd2-msg-ossuary', speaker: 'Grigori', text: 'Los viejos enterraban nombres. Los nuevos sólo apilan cuerpos. Hacé lugar.', duration: 4.5 })
  .logic({ kind: 'message', id: 'd2-msg-ossuary-clear', name: 'd2-msg-ossuary-clear', speaker: 'Grigori', text: 'Subí. Las chapas rojas marcan la ruta segura sobre los patios.', duration: 4 })
  .logic({ kind: 'message', id: 'd2-msg-rooftops', name: 'd2-msg-rooftops', speaker: 'Radio de emergencia', text: 'Vemos tu linterna desde la cantera. La sirena sigue muda.', duration: 4 })
  .logic({ kind: 'message', id: 'd2-msg-station', name: 'd2-msg-station', speaker: 'Marta', text: 'La fundición alimenta el malacate. Primero sacamos a esos bichos de las vías.', duration: 4.5 })
  .logic({ kind: 'message', id: 'd2-msg-station-clear', name: 'd2-msg-station-clear', speaker: 'Marta', text: 'El tablero está al oeste, detrás de la calle incendiada. Cuando lo prendas, van a venir todos.', duration: 5 })
  .logic({ kind: 'message', id: 'd2-msg-siren', name: 'd2-msg-siren', speaker: 'Marta', text: '¡La sirena vive! Mantenelos lejos del tablero hasta que el malacate tome velocidad.', duration: 5 })
  .logic({ kind: 'message', id: 'd2-msg-final-mid', name: 'd2-msg-final-mid', speaker: 'Radio de emergencia', text: 'Señal recibida. Los primeros refugiados ya están cruzando el túnel.', duration: 4.5 })
  .logic({ kind: 'message', id: 'd2-msg-final-clear', name: 'd2-msg-final-clear', speaker: 'Marta', text: 'Velocidad estable. La compuerta de la mina está abierta: bajá antes de que vuelva a frenarse.', duration: 5 })
  .logic({ kind: 'message', id: 'd2-msg-mine-open', name: 'd2-msg-mine-open', speaker: 'Sistema del malacate', text: 'Carga evacuada. Plataforma de descenso disponible.', duration: 3.5 })
  .logic({ kind: 'message', id: 'd2-msg-end', name: 'd2-msg-end', speaker: 'Radio de emergencia', text: 'Último grupo adentro. La campana nos dio una salida. Buen viaje, desconocido.', duration: 6 })
  .logic({ kind: 'message', id: 'd2-msg-memorial', name: 'd2-msg-memorial', speaker: 'Grabación del sacristán', text: 'No toquen la herramienta azul. Abre puertas donde nunca hubo puertas, pero también muestra cuánto dejamos atrás.', duration: 6 })
  .logic({ kind: 'message', id: 'd2-msg-foundry-log', name: 'd2-msg-foundry-log', speaker: 'Registro de turno', text: 'Día 41: desconectamos la sirena. Cada prueba atrae algo nuevo desde el pueblo.', duration: 5 })

  .logic({ kind: 'soundscape', id: 'd2-ss-outdoor', name: 'd2-ss-outdoor', soundscape: 'wasteland' })
  .logic({ kind: 'soundscape', id: 'd2-ss-chapel', name: 'd2-ss-chapel', soundscape: 'smallInterior' })
  .logic({ kind: 'soundscape', id: 'd2-ss-portal', name: 'd2-ss-portal', soundscape: 'lab' })
  .logic({ kind: 'soundscape', id: 'd2-ss-ossuary', name: 'd2-ss-ossuary', soundscape: 'warehouse' })
  .logic({ kind: 'soundscape', id: 'd2-ss-rooftops', name: 'd2-ss-rooftops', soundscape: 'outdoor' })
  .logic({ kind: 'soundscape', id: 'd2-ss-station', name: 'd2-ss-station', soundscape: 'factory' })
  .logic({ kind: 'soundscape', id: 'd2-ss-mine', name: 'd2-ss-mine', soundscape: 'metalTunnel' });

// ── Coreografías breves en zonas seguras ─────────────────────────────────────
map
  .sequence({
    id: 'd2-seq-grigori-intro',
    name: 'd2-seq-grigori-intro',
    targetNpc: 'd2-grigori',
    position: [-84, 1, 136],
    moveMode: 'walk',
    overrideAi: true,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'gesture', gesture: 'point', duration: 1.1 },
      { kind: 'say', speaker: 'Grigori', text: 'Los refugiados están vivos, abajo de la cantera. Pero la niebla se los va a tragar si salen sin guía.', duration: 6 },
      { kind: 'say', speaker: 'Grigori', text: 'Hacé sonar la vieja sirena y arrancá el malacate. Una campana, una ventana, una sola oportunidad.', duration: 6 },
    ],
    connections: [
      { output: 'OnEnd', target: 'd2-obj-clear-crematorium', input: 'Apply' },
      { output: 'OnCanceled', target: 'd2-obj-clear-crematorium', input: 'Apply' },
    ],
  })
  .sequence({
    id: 'd2-seq-tomas',
    name: 'd2-seq-tomas',
    targetNpc: 'd2-tomas',
    position: [-10, 1, 86],
    moveMode: 'walk',
    overrideAi: true,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'say', speaker: 'Hermano Tomás', text: 'La sirena está detrás del control de cuarentena. La escalera cayó y el portón no tiene mando abajo.', duration: 6 },
      { kind: 'gesture', gesture: 'point', duration: 1.1 },
      { kind: 'say', speaker: 'Hermano Tomás', text: 'Un técnico Combine murió escondiendo ese prototipo. Hace dos huecos y los convence de ser el mismo lugar.', duration: 6.5 },
    ],
    connections: [
      { output: 'OnEnd', target: 'd2-obj-take-portal-gun', input: 'Apply' },
      { output: 'OnCanceled', target: 'd2-obj-take-portal-gun', input: 'Apply' },
    ],
  })
  .sequence({
    id: 'd2-seq-marta',
    name: 'd2-seq-marta',
    targetNpc: 'd2-marta',
    position: [-55, 1, -76],
    moveMode: 'walk',
    overrideAi: true,
    steps: [
      { kind: 'face', target: '!player' },
      { kind: 'say', speaker: 'Marta', text: 'El tablero todavía tiene carga. Cuando lo abras, cubrí ambas calles; yo cuido el flanco de la mina.', duration: 5.5 },
      { kind: 'gesture', gesture: 'point', duration: 1.1 },
    ],
  });

// ── Encuentros y lógica de progresión ─────────────────────────────────────────
map
  .logic({
    kind: 'npcSpawner',
    id: 'd2-spawn-crematorium',
    name: 'd2-spawn-crematorium',
    npcs: [
      { id: 'd2-enemy-crematorium-z1', characterId: 'zombie', position: [-58, 1, 114], connections: [{ output: 'OnDeath', target: 'd2-count-crematorium', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-crematorium-z2', characterId: 'zombie', position: [-49, 1, 111], connections: [{ output: 'OnDeath', target: 'd2-count-crematorium', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-crematorium-z3', characterId: 'zombie', position: [-38, 1, 115], connections: [{ output: 'OnDeath', target: 'd2-count-crematorium', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-crematorium-z4', characterId: 'zombie', position: [-42, 1, 100], connections: [{ output: 'OnDeath', target: 'd2-count-crematorium', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-crematorium-h1', characterId: 'headcrab', position: [-53, 1, 102], connections: [{ output: 'OnDeath', target: 'd2-count-crematorium', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-crematorium-h2', characterId: 'headcrab', position: [-34, 1, 108], connections: [{ output: 'OnDeath', target: 'd2-count-crematorium', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-crematorium-h3', characterId: 'headcrab', position: [-47, 1, 119], connections: [{ output: 'OnDeath', target: 'd2-count-crematorium', input: 'Add', param: 1 }] },
    ],
    connections: [{ output: 'OnSpawnFailed', target: 'd2-count-crematorium', input: 'SetValue', param: 7 }],
  })
  .logic({
    kind: 'counter',
    id: 'd2-count-crematorium',
    name: 'd2-count-crematorium',
    max: 7,
    connections: [{ output: 'OnHitMax', target: 'd2-relay-crematorium-clear', input: 'Trigger' }],
  })
  .logic({
    kind: 'relay',
    id: 'd2-relay-crematorium-clear',
    name: 'd2-relay-crematorium-clear',
    triggerOnce: true,
    connections: [
      { output: 'OnTrigger', target: 'd2-msg-plaza-clear', input: 'Show' },
      { output: 'OnTrigger', target: 'd2-obj-reach-chapel', input: 'Apply' },
    ],
  })

  .logic({
    kind: 'relay',
    id: 'd2-relay-portal-complete',
    name: 'd2-relay-portal-complete',
    triggerOnce: true,
    connections: [
      { output: 'OnTrigger', target: 'd2-msg-portal-complete', input: 'Show' },
      { output: 'OnTrigger', target: 'd2-obj-clear-ossuary', input: 'Apply' },
      { output: 'OnTrigger', target: 'd2-spawn-ossuary', input: 'Spawn', delay: 1.3 },
      { output: 'OnTrigger', target: 'd2-ss-outdoor', input: 'Activate' },
      { output: 'OnTrigger', target: 'd2-trigger-station', input: 'Enable' },
    ],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd2-spawn-ossuary',
    name: 'd2-spawn-ossuary',
    npcs: [
      { id: 'd2-enemy-ossuary-z1', characterId: 'zombie', position: [56, 1, 37], connections: [{ output: 'OnDeath', target: 'd2-count-ossuary', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-ossuary-z2', characterId: 'zombie', position: [65, 1, 34], connections: [{ output: 'OnDeath', target: 'd2-count-ossuary', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-ossuary-z3', characterId: 'zombie', position: [78, 1, 39], connections: [{ output: 'OnDeath', target: 'd2-count-ossuary', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-ossuary-z4', characterId: 'zombie', position: [83, 1, 23], connections: [{ output: 'OnDeath', target: 'd2-count-ossuary', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-ossuary-z5', characterId: 'zombie', position: [66, 1, 16], connections: [{ output: 'OnDeath', target: 'd2-count-ossuary', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-ossuary-h1', characterId: 'headcrab', position: [59, 1, 27], connections: [{ output: 'OnDeath', target: 'd2-count-ossuary', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-ossuary-h2', characterId: 'headcrab', position: [75, 1, 13], connections: [{ output: 'OnDeath', target: 'd2-count-ossuary', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-ossuary-h3', characterId: 'headcrab', position: [85, 1, 34], connections: [{ output: 'OnDeath', target: 'd2-count-ossuary', input: 'Add', param: 1 }] },
    ],
    connections: [{ output: 'OnSpawnFailed', target: 'd2-count-ossuary', input: 'SetValue', param: 8 }],
  })
  .logic({
    kind: 'counter',
    id: 'd2-count-ossuary',
    name: 'd2-count-ossuary',
    max: 8,
    connections: [
      { output: 'OnHitMax', target: 'd2-msg-ossuary-clear', input: 'Show' },
      { output: 'OnHitMax', target: 'd2-obj-reach-station', input: 'Apply' },
    ],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd2-spawn-rooftops',
    name: 'd2-spawn-rooftops',
    npcs: [
      { id: 'd2-enemy-rooftop-z1', characterId: 'zombie', position: [57, 1, 3] },
      { id: 'd2-enemy-rooftop-z2', characterId: 'zombie', position: [69, 1, -4] },
      { id: 'd2-enemy-rooftop-z3', characterId: 'zombie', position: [55, 1, -12] },
      { id: 'd2-enemy-rooftop-h1', characterId: 'headcrab', position: [66, 4.5, 1] },
      { id: 'd2-enemy-rooftop-h2', characterId: 'headcrab', position: [51, 4.5, -9] },
      { id: 'd2-enemy-rooftop-h3', characterId: 'headcrab', position: [43, 1, -17] },
    ],
  })

  .logic({
    kind: 'relay',
    id: 'd2-relay-station-start',
    name: 'd2-relay-station-start',
    triggerOnce: true,
    connections: [
      { output: 'OnTrigger', target: 'd2-msg-station', input: 'Show' },
      { output: 'OnTrigger', target: 'd2-obj-clear-station', input: 'Apply' },
      { output: 'OnTrigger', target: 'd2-spawn-station-a', input: 'Spawn' },
      { output: 'OnTrigger', target: 'd2-spawn-station-b', input: 'Spawn', delay: 6 },
      { output: 'OnTrigger', target: 'd2-spawn-station-c', input: 'Spawn', delay: 13 },
    ],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd2-spawn-station-a',
    name: 'd2-spawn-station-a',
    npcs: [
      { id: 'd2-enemy-station-a1', characterId: 'zombie', position: [18, 1, -35], connections: [{ output: 'OnDeath', target: 'd2-count-station', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-station-a2', characterId: 'zombie', position: [9, 1, -39], connections: [{ output: 'OnDeath', target: 'd2-count-station', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-station-a3', characterId: 'headcrab', position: [14, 1, -47], connections: [{ output: 'OnDeath', target: 'd2-count-station', input: 'Add', param: 1 }] },
    ],
    connections: [{ output: 'OnSpawnFailed', target: 'd2-count-station', input: 'Add', param: 3 }],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd2-spawn-station-b',
    name: 'd2-spawn-station-b',
    npcs: [
      { id: 'd2-enemy-station-b1', characterId: 'zombie', position: [-4, 1, -36], connections: [{ output: 'OnDeath', target: 'd2-count-station', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-station-b2', characterId: 'zombie', position: [-8, 1, -48], connections: [{ output: 'OnDeath', target: 'd2-count-station', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-station-b3', characterId: 'headcrab', position: [1, 1, -53], connections: [{ output: 'OnDeath', target: 'd2-count-station', input: 'Add', param: 1 }] },
    ],
    connections: [{ output: 'OnSpawnFailed', target: 'd2-count-station', input: 'Add', param: 3 }],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd2-spawn-station-c',
    name: 'd2-spawn-station-c',
    npcs: [
      { id: 'd2-enemy-station-c1', characterId: 'zombie', position: [7, 1, -59], connections: [{ output: 'OnDeath', target: 'd2-count-station', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-station-c2', characterId: 'zombie', position: [20, 1, -54], connections: [{ output: 'OnDeath', target: 'd2-count-station', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-station-c3', characterId: 'headcrab', position: [-2, 1, -60], connections: [{ output: 'OnDeath', target: 'd2-count-station', input: 'Add', param: 1 }] },
    ],
    connections: [{ output: 'OnSpawnFailed', target: 'd2-count-station', input: 'Add', param: 3 }],
  })
  .logic({
    kind: 'counter',
    id: 'd2-count-station',
    name: 'd2-count-station',
    max: 9,
    connections: [
      { output: 'OnHitMax', target: 'd2-msg-station-clear', input: 'Show' },
      { output: 'OnHitMax', target: 'd2-obj-start-siren', input: 'Apply' },
      { output: 'OnHitMax', target: 'd2-door-foundry-gate', input: 'Open' },
      { output: 'OnHitMax', target: 'd2-relay-final-start', input: 'Enable' },
    ],
  })

  .logic({
    kind: 'relay',
    id: 'd2-relay-final-start',
    name: 'd2-relay-final-start',
    startDisabled: true,
    triggerOnce: true,
    connections: [
      { output: 'OnTrigger', target: 'd2-msg-siren', input: 'Show' },
      { output: 'OnTrigger', target: 'd2-obj-defend', input: 'Apply' },
      { output: 'OnTrigger', target: 'd2-spawn-final-a', input: 'Spawn', delay: 1 },
      { output: 'OnTrigger', target: 'd2-spawn-final-b', input: 'Spawn', delay: 10 },
      { output: 'OnTrigger', target: 'd2-spawn-final-c', input: 'Spawn', delay: 20 },
      { output: 'OnTrigger', target: 'd2-msg-final-mid', input: 'Show', delay: 24 },
      { output: 'OnTrigger', target: 'd2-timer-final-failsafe', input: 'Enable' },
    ],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd2-spawn-final-a',
    name: 'd2-spawn-final-a',
    npcs: [
      { id: 'd2-enemy-final-a1', characterId: 'zombie', position: [-31, 1, -67], connections: [{ output: 'OnDeath', target: 'd2-count-final', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-final-a2', characterId: 'zombie', position: [-35, 1, -85], connections: [{ output: 'OnDeath', target: 'd2-count-final', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-final-a3', characterId: 'zombie', position: [-50, 1, -66], connections: [{ output: 'OnDeath', target: 'd2-count-final', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-final-a4', characterId: 'headcrab', position: [-29, 1, -76], connections: [{ output: 'OnDeath', target: 'd2-count-final', input: 'Add', param: 1 }] },
    ],
    connections: [{ output: 'OnSpawnFailed', target: 'd2-count-final', input: 'Add', param: 4 }],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd2-spawn-final-b',
    name: 'd2-spawn-final-b',
    npcs: [
      { id: 'd2-enemy-final-b1', characterId: 'zombie', position: [-44, 1, -91], connections: [{ output: 'OnDeath', target: 'd2-count-final', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-final-b2', characterId: 'zombie', position: [-57, 1, -86], connections: [{ output: 'OnDeath', target: 'd2-count-final', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-final-b3', characterId: 'zombie', position: [-25, 1, -70], connections: [{ output: 'OnDeath', target: 'd2-count-final', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-final-b4', characterId: 'headcrab', position: [-54, 1, -68], connections: [{ output: 'OnDeath', target: 'd2-count-final', input: 'Add', param: 1 }] },
    ],
    connections: [{ output: 'OnSpawnFailed', target: 'd2-count-final', input: 'Add', param: 4 }],
  })
  .logic({
    kind: 'npcSpawner',
    id: 'd2-spawn-final-c',
    name: 'd2-spawn-final-c',
    npcs: [
      { id: 'd2-enemy-final-c1', characterId: 'zombie', position: [-61, 1, -78], connections: [{ output: 'OnDeath', target: 'd2-count-final', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-final-c2', characterId: 'zombie', position: [-41, 1, -60], connections: [{ output: 'OnDeath', target: 'd2-count-final', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-final-c3', characterId: 'headcrab', position: [-30, 1, -90], connections: [{ output: 'OnDeath', target: 'd2-count-final', input: 'Add', param: 1 }] },
      { id: 'd2-enemy-final-c4', characterId: 'headcrab', position: [-51, 1, -94], connections: [{ output: 'OnDeath', target: 'd2-count-final', input: 'Add', param: 1 }] },
    ],
    connections: [{ output: 'OnSpawnFailed', target: 'd2-count-final', input: 'Add', param: 4 }],
  })
  .logic({
    kind: 'counter',
    id: 'd2-count-final',
    name: 'd2-count-final',
    max: 12,
    connections: [{ output: 'OnHitMax', target: 'd2-relay-final-clear', input: 'Trigger' }],
  })
  .logic({
    kind: 'timer',
    id: 'd2-timer-final-failsafe',
    name: 'd2-timer-final-failsafe',
    interval: 75,
    startDisabled: true,
    connections: [
      { output: 'OnTimer', target: 'd2-relay-final-clear', input: 'Trigger' },
      { output: 'OnTimer', target: 'd2-timer-final-failsafe', input: 'Disable' },
    ],
  })
  .logic({
    kind: 'relay',
    id: 'd2-relay-final-clear',
    name: 'd2-relay-final-clear',
    triggerOnce: true,
    connections: [
      { output: 'OnTrigger', target: 'd2-timer-final-failsafe', input: 'Disable' },
      { output: 'OnTrigger', target: 'd2-door-mine-lift', input: 'Open' },
      { output: 'OnTrigger', target: 'd2-msg-final-clear', input: 'Show' },
      { output: 'OnTrigger', target: 'd2-obj-escape', input: 'Apply' },
      { output: 'OnTrigger', target: 'd2-trigger-exit', input: 'Enable', delay: 1.5 },
    ],
  })
  .logic({
    kind: 'changelevel',
    id: 'd2-changelevel',
    name: 'd2-changelevel',
    landmark: { position: [-84, 1.2, -127], yaw: 0 },
  });

// ── Triggers locales: umbrales visibles, no líneas invisibles de 80 metros ────
map
  .trigger({
    id: 'd2-trigger-intro',
    position: [-88, 1.3, 137],
    size: [8, 3.2, 8],
    once: true,
    connections: [{ output: 'OnStartTouch', target: 'd2-seq-grigori-intro', input: 'Start' }],
  })
  .trigger({
    id: 'd2-trigger-crematorium',
    position: [-48, 1.3, 108],
    size: [13, 3.2, 13],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd2-spawn-crematorium', input: 'Spawn' },
      { output: 'OnStartTouch', target: 'd2-msg-plaza', input: 'Show' },
      { output: 'OnStartTouch', target: 'd2-ss-outdoor', input: 'Activate' },
    ],
  })
  .trigger({
    id: 'd2-trigger-chapel-entry',
    position: [-21.5, 1.3, 86],
    size: [4, 3.2, 8],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd2-msg-chapel-entry', input: 'Show' },
      { output: 'OnStartTouch', target: 'd2-seq-tomas', input: 'Start', delay: 1.5 },
      { output: 'OnStartTouch', target: 'd2-ss-chapel', input: 'Activate' },
    ],
  })
  .trigger({
    id: 'd2-trigger-portal-pickup',
    position: [-1.5, 1.3, 86],
    size: [4, 3.2, 5],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd2-msg-portal-tutorial', input: 'Show' },
      { output: 'OnStartTouch', target: 'd2-obj-portal-gate', input: 'Apply' },
    ],
  })
  .trigger({
    id: 'd2-trigger-courtyard',
    position: [17, 1.3, 70],
    size: [5, 3.2, 11],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd2-msg-courtyard', input: 'Show' },
      { output: 'OnStartTouch', target: 'd2-ss-portal', input: 'Activate' },
    ],
  })
  .trigger({
    id: 'd2-trigger-portal-landing',
    position: [49.5, 5.2, 66],
    size: [11, 3, 13],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd2-msg-portal-landing', input: 'Show' },
      { output: 'OnStartTouch', target: 'd2-obj-press-gate', input: 'Apply' },
    ],
  })
  .trigger({
    id: 'd2-trigger-ossuary',
    position: [64, 1.3, 33],
    size: [13, 3.2, 13],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd2-msg-ossuary', input: 'Show' },
      { output: 'OnStartTouch', target: 'd2-ss-ossuary', input: 'Activate' },
    ],
  })
  .trigger({
    id: 'd2-trigger-rooftops',
    position: [61, 3.2, -2],
    size: [14, 7, 14],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd2-spawn-rooftops', input: 'Spawn' },
      { output: 'OnStartTouch', target: 'd2-msg-rooftops', input: 'Show' },
      { output: 'OnStartTouch', target: 'd2-ss-rooftops', input: 'Activate' },
    ],
  })
  .trigger({
    id: 'd2-trigger-station',
    position: [10, 1.3, -45],
    size: [16, 3.2, 15],
    once: true,
    startDisabled: true,
    connections: [
      { output: 'OnStartTouch', target: 'd2-relay-station-start', input: 'Trigger' },
      { output: 'OnStartTouch', target: 'd2-ss-station', input: 'Activate' },
    ],
  })
  .trigger({
    id: 'd2-trigger-siren-yard',
    position: [-47, 1.3, -76],
    size: [15, 3.2, 15],
    once: true,
    connections: [
      { output: 'OnStartTouch', target: 'd2-seq-marta', input: 'Start' },
      { output: 'OnStartTouch', target: 'd2-msg-foundry-log', input: 'Show', delay: 4 },
    ],
  })
  .trigger({
    id: 'd2-trigger-memorial',
    position: [-7, 1.3, 77],
    size: [5, 3.2, 5],
    once: true,
    connections: [{ output: 'OnStartTouch', target: 'd2-msg-memorial', input: 'Show' }],
  })
  .trigger({
    id: 'd2-trigger-mine-soundscape',
    position: [-84, 1.3, -105],
    size: [10, 3.2, 5],
    once: true,
    connections: [{ output: 'OnStartTouch', target: 'd2-ss-mine', input: 'Activate' }],
  })
  .trigger({
    id: 'd2-trigger-exit',
    position: [-84, 1.3, -121],
    size: [16, 3.2, 7],
    once: true,
    startDisabled: true,
    connections: [
      { output: 'OnStartTouch', target: 'd2-msg-end', input: 'Show' },
      { output: 'OnStartTouch', target: 'd2-changelevel', input: 'Trigger', delay: 3.2 },
    ],
  });

// Checkpoints guardan inventario; el posterior al puzzle conserva la portal gun.
map
  .checkpoint({ id: 'd2-cp-arrival', position: [-88, 1.3, 133], size: [10, 3.2, 6], respawn: [-92, 1.2, 140] })
  .checkpoint({ id: 'd2-cp-chapel', position: [-18, 1.3, 86], size: [5, 3.2, 8], respawn: [-19, 1.2, 86] })
  .checkpoint({ id: 'd2-cp-portal-complete', position: [39, 1.3, 47], size: [7, 3.2, 5], respawn: [39, 1.2, 48] })
  .checkpoint({ id: 'd2-cp-rooftops', position: [61, 3.2, -9], size: [10, 7, 5], respawn: [61, 4.2, -7] })
  .checkpoint({ id: 'd2-cp-station', position: [10, 1.3, -31], size: [12, 3.2, 5], respawn: [10, 1.2, -29] })
  .checkpoint({ id: 'd2-cp-final', position: [-52, 1.3, -74], size: [8, 3.2, 8], respawn: [-55, 1.2, -72] })
  .checkpoint({ id: 'd2-cp-mine', position: [-84, 1.3, -111], size: [9, 3.2, 5], respawn: [-84, 1.2, -109] });

export const Demo2Ravenholm = map.build();
