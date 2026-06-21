# vibe-life 3

FPS 3D singleplayer en navegador. Fan project de Half-Life 3.

**Stack:** TypeScript estricto · Vite · Three.js 0.164 · Rapier3D-compat 0.14 · Node 18+

## Comandos

| Script             | Qué hace                                          |
| ------------------ | ------------------------------------------------- |
| `npm install`      | Instala dependencias                              |
| `npm run dev`      | Vite dev server con HMR (`http://127.0.0.1:5173`) |
| `npm run build`    | `tsc --noEmit` + `vite build`                     |
| `npm run preview`  | Sirve el build de producción                      |
| `npx tsc --noEmit` | Verificación rápida de tipos sin bundle           |

---

## Reglas

1. **`engine/` nunca importa de `game/`.** Si la dependencia es real, el tipo va a `shared/` o se invierte vía interface.
2. **Preferir editar archivos existentes** antes que crear nuevos. No generar documentación nueva (`*.md`, README) salvo pedido explícito.
3. **No crear commits sin que el usuario lo pida.** Mensajes concisos, en español, sin co-author de IA salvo pedido.
4. **Binarios del artista intocables:** `src/models/` y `src/engine/assets/sounds/`. Texturas (`src/engine/assets/textures/`) y HDRIs (`src/engine/assets/hdri/`) sí se modifican, pero con permiso explícito del usuario.
5. **Prohibido sin permiso:** `git -i`, `git --no-verify`, `rm -rf`, `git reset --hard`.
6. **TypeScript estricto.** Cero `any`, cero `@ts-ignore`. Flags activos: `strict`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`.
7. **Cero comentarios redundantes.** Solo JSDoc o comentario inline cuando explica el *por qué* (constraint oculto, workaround, comportamiento sorprendente). Nunca el *qué*.
8. **Idioma.** Strings visibles al jugador (UI, subtítulos, mensajes) en español. Identificadores y comentarios técnicos en inglés.
9. **Al cerrar un cambio:** correr `npx tsc --noEmit`. Idealmente también `npm run build`.

---

## Arquitectura

Tres capas con separación estricta.

```
src/
├─ engine/    → infraestructura genérica, agnóstica del contenido
├─ game/      → contenido y reglas específicas del juego
└─ shared/    → tipos/utilidades comunes a ambas capas
```

### `engine/`

| Carpeta              | Responsabilidad                                                          |
| -------------------- | ------------------------------------------------------------------------ |
| `core/`              | `Engine` (orquestador), `GameLoop` + `Time`, `SceneManager`, `ResourceManager`, `ServiceContainer`, `ServiceTokens` (`EngineTokens`), `EventBus<TEvents>` genérico, `System` base. |
| `input/`             | `Input` (teclado, mouse, pointer-lock) y `KeyBindings`.                  |
| `render/`            | `Renderer` (ACES tone mapping), `CameraSystem`, `PrimitiveFactory`, `TerrainMesh`. Subcarpetas: `material/` (`Materials` data-driven + `Textures` con `TextureSets` PBR) y `environment/` (`LightingSystem` con sol direccional + ambient/hemisphere bajos, `EnvironmentSystem` HDRI → background + IBL vía PMREM, `Skybox` con `SkyboxManifest`). |
| `physics/`           | Núcleo (`PhysicsWorld` con Rapier — boxes + heightfields, `Raycast`, `Colliders`) + `character/` (`CharacterController`, `CharacterMotor`, `KinematicCharacterBase`, `SpawnValidator`). |
| `audio/`             | `core/` (`AudioBus`, `AudioSystem`, `SoundManager`, `PositionalSoundManager`, `MusicManager`), `systems/` (`BackgroundAmbienceSystem`, `FootstepSoundSystem`), `AudioManifest` en raíz. |
| `animation/`         | `AnimationSystem`, `AnimationInput`, `AnimationDebug`, `HitReactionAnimator` en raíz. Subcarpetas: `layers/` (capas aditivas: locomotion, aim, attack, hit, idle, lookAt, posture, reload, velocityLean), `pose/` (`BoneMapper`, `BoneRotation`, `HumanoidRestPose`, `PoseSnapshot`, `RestPoseTuning`), `procedural/` (`ProceduralCharacterAnimator`, `ProceduralWalk`, `ProceduralBalance`), `ragdoll/` (`RagdollSystem` y los `Ragdoll*`/`Physical*` helpers). |
| `assets/`            | `AssetManager`, `AssetManifest`. Carpetas `textures/`, `hdri/`, `sounds/`. |
| `ai/`                | `Faction` en raíz. Subcarpetas: `brain/` (`Brain` runner de schedules por prioridad + `Task` + `Condition` bitmask), `perception/` (`PerceptionSystem` — cono de visión + LOS + memoria), `locomotion/` (`NpcLocomotion` — path following + stuck detection + separación de vecinos), `nav/` (`NavSpace` celdas+portales, `NavSpaceBuilder`, `AStar`, `PathRequestQueue` presupuestada, `PathSmoother`). |
| `characters/`        | `CharacterDefinition` (tipo de configuración).                           |
| `debug/`             | `Gizmos` — helpers visuales para debug.                                  |

### `game/`

| Carpeta / archivo            | Responsabilidad                                                             |
| ---------------------------- | --------------------------------------------------------------------------- |
| `Game.ts`                    | Bootstrap. Recibe el `Engine`, registra `GameTokens`, drive del loop.       |
| `GameEvents.ts`              | `GameEventMap` + alias `GameEventBus = EventBus<GameEventMap>`.             |
| `ServiceTokens.ts`           | `GameTokens` — tokens de servicios específicos del juego.                   |
| `characters/`                | `CharacterFactory` (construye el `Npc` v2: motor + combat handle + preset por `aiProfileId`) + `CharacterPresets`. |
| `npc/`                       | `Npc.ts` (runtime unificado: perception → conditions → brain → locomotion). `core/` (`INpc`, `ActorSpatialIndex`, `NpcDebugFlags`), `brain/` (`NpcBrainContext`, `NpcConditions`, `NpcSensors`, `NpcNoiseSensor`, `NpcCoverSensor`, `tasks/` con `CoreTasks` + `TacticalTasks`), `presets/` (`combinePreset`, `zombiePreset`, `alyxPreset` — schedules data-driven por arquetipo), `combat/` (`NpcCombat` melee core, `NpcMeleeCombat` y `RealRangedCombat` adapters de `NpcCombatHandle`, `NpcRangedCombat`, `NpcWeaponAttachment`, `WeaponAttachmentTuning`), `ai/` (`SquadDirector` roles de squad, `TacticalMap` cover/firing points), `animation/` (`NpcAnimationBridge`). |
| `gameplay/`                  | `Health` (compartido Player/NPC) en raíz. `player/` (`Player`, `PlayerHealth`, `Stamina`, `Controls`). `interactions/` (`Interactable`, `InteractSystem`, `SlidingDoor`, `DoorButton`). |
| `gameplay/weapons/`          | `core/` (`Weapon` base, `WeaponDefinition`, `WeaponController`, `WeaponFactory`, `WeaponInventory`), `types/` (`HitscanWeapon`, `MeleeWeapon`, `GravityGunWeapon`), `effects/` (`MuzzleFlash`, `Recoil`, `WeaponEffects`, `WeaponViewModel`), `pickup/` (`WeaponPickup`). |
| `levels/`                    | `LevelDefinition`, `LevelRegistry`, `LevelLoader`, `TriggerSystem`, `CoverSystem`. Subcarpetas: `maps/` (`DemoLevel`, `SnowFieldLevel`, …), `builders/` (`MapCreator` — builder fluido `createMap()` que compone el nivel completo; `BuildingBuilder` multi-piso con fachada compuesta — ventanas auto/manuales, puertas 2.2 m con dintel y marquesina, zócalo/bandas/cornisa/parapeto/pilastras, techos flat/walkable/gable, `palette` de materiales, escaleras con zancas y baranda perimetral del hueco del stairwell, y validación de descansos (warn si una boca de escalera tiene <1.5 m libres — ideal ≥2 m); `HouseBuilder` wrapper de 1 piso, `RampBuilder`, `PropBuilder` — crates/sandbags/cover walls/watchtower/container), `buildings/` (`BuildingArtifact`, `BuildingRegistry` — rooms/doorways para nav y AI). |
| `narrative/`                 | `DialogueSystem`, `ScriptedSequence`, `LevelEvents`.                        |
| `ui/`                        | `hud/` (`HUD`, `HUDView`, `Crosshair`, `DamageIndicator`, `HealthArmorHUD`, `HudIcons`, `WeaponHUD`, `WeaponSelectorView`), `subtitles/` (`Subtitles`, `SubtitlesView`), `overlay/` (`InteractionPrompt`, `debug/` con `DebugMenu` + `DebugMenuView` + `DebugModule` + `widgets` y `modules/` por pestania), `menu/` (`MainMenu`, `MainMenuView`, `MainMenuState`, `PauseMenu`, `OptionsMenu`, `NewGameMenu`, `CreditsMenu`, `MenuStyles.css`). |
| `audio/`                     | Sistemas reactivos a eventos: weapon/enemy/dialogue/UI sound.               |
| `config/`                    | `weapons.config.ts`, `audio.config.ts`, `gameplay.config.ts`, `controls.config.ts`, `strings.ts`. |
| `debug/`                     | Recursos puros (sin DOM ni keybinds) que consume el `DebugMenu`: `NpcAiDebugOverlay` (overlay 3D del `NavSpace` + NPCs), `NpcAiTraceRecorder` (grabador offline) y `SceneInspector` (`window.__inspectScene`). |

### `shared/`

- `math/Vec3.ts`, `math/VectorTuple.ts` — utilidades de vectores.
- `math/Noise.ts` — value noise 2D + fbm fractal, determinista por seed.
- `math/HeightField.ts` — `HeightField` + generador desde `HeightSource` (noise|flat).
- `types/lifecycle.ts` — `Damageable`, `Disposable`, `Updatable`.

Nada de Three.js fuera de tipos estructurales (`Vector3`, `Object3D`).

---

## Patrones

### ServiceContainer (DI por tokens)

Engine y Game registran servicios contra el mismo contenedor; se resuelven por token. Tokens separados por capa para que la dirección de las dependencias quede visible.

```ts
container.register(EngineTokens.Camera, new CameraSystem(root));
container.register(GameTokens.EventBus, new EventBus<GameEventMap>());
const camera = container.resolve(EngineTokens.Camera);
```

Servicio nuevo → declarar token en `engine/core/ServiceTokens.ts` o `game/ServiceTokens.ts` según capa.

### EventBus tipado

Un solo bus por juego, tipado por `GameEventMap`. Registrado en `GameTokens.EventBus` desde `Game.registerEventBus()`. Handlers reciben payload tipado sin casts.

```ts
eventBus.on("player.health.changed", ({ current, max }) => { /* … */ });
eventBus.emit("weapon.ammo.changed", { current: 12, reserve: 90 });
```

Eventos canónicos definidos en `src/game/GameEvents.ts`:
`weapon.ammo.changed`, `weapon.fired`, `weapon.hit`, `weapon.changed`, `player.health.changed`, `player.armor.changed`, `player.damaged`, `player.dead`, `npc.damaged`, `npc.killed`, `npc.alert`, `npc.attack`, `interaction.focus`, `interaction.blur`, `subtitle.show`, `dialogue.show`, `objective.updated`. Agregar uno = extender ese map.

Naming: `dominio.acción` minúsculas. Sin camelCase ni tiempos verbales mezclados.

### Component + View para UI

Cada panel no trivial vive en dos archivos:

- **Component** (`HUD.ts`, `Subtitles.ts`, `MainMenu.ts`) — lifecycle, suscripciones al bus, estado en memoria, API pública. Implementa `Disposable`, limpia listeners, delega `dispose()` al view.
- **View** (`HUDView.ts`, `SubtitlesView.ts`, `MainMenuView.ts`) — render puro, composite de subwidgets, métodos imperativos (`setX(...)`).

Subwidgets (`Crosshair`, `DamageIndicator`, `WeaponHUD`) son hojas: clase con `element` + métodos `pulseX/setX`, sin tocar el bus. Si tienen `setTimeout` pendiente exponen `dispose()`.

### Data-driven

Donde antes había `if (weaponType === "pistol") …`, hoy hay tablas declarativas:

| Tabla | Archivo |
|-------|---------|
| Armas | `game/config/weapons.config.ts` |
| Audio de armas y enemigos | `game/config/audio.config.ts` |
| Vitals del Player | `game/config/gameplay.config.ts` |
| Strings visibles | `game/config/strings.ts` |
| Niveles | `game/levels/maps/<Level>.ts` + `LevelRegistry.ts` |
| Sets PBR | `engine/render/material/Textures.ts` (`TextureSets`) |
| HDRIs | `engine/render/environment/Skybox.ts` (`SkyboxManifest`) |
| Materials | `engine/render/material/Materials.ts` |
| Audio clips | `engine/audio/AudioManifest.ts` |

Agregar contenido = editar tabla o registrar entrada. Casi nunca implica clase nueva.

### Path aliases

Configurados en `tsconfig.json` y replicados en `vite.config.ts`. Tras la reestructuración casi todos los imports usan alias; los `./` relativos quedan solo para vecinos del mismo directorio.

```ts
import { Engine } from "@engine/core/Engine";
import { GameTokens } from "@game/ServiceTokens";
import { Vec3 } from "@shared/math/Vec3";
import { SubtitlesView } from "./SubtitlesView"; // mismo directorio → relativo
```

Regla práctica: si el import cruza directorios (`..`), usar alias. Si es vecino (`./`), relativo.

---

## Cómo extender

### Agregar un arma

1. Entrada en `game/config/weapons.config.ts` con todos los campos de `WeaponDefinition`.
2. Si el comportamiento no encaja en `hitscan` / `melee` / `special`:
   - Subclase de `Weapon` (de `game/gameplay/weapons/core/Weapon.ts`) en `game/gameplay/weapons/types/`.
   - Mapearla en `WeaponFactory.createWeapon()` (`game/gameplay/weapons/core/WeaponFactory.ts`).
3. Clips en `engine/audio/AudioManifest.ts`, mapeados en `WeaponAudio` (`audio.config.ts`).
4. Drop del GLB en `src/models/weapons/`.
5. Entrada en `LevelDefinition.weaponPickups` del nivel.

### Agregar un nivel

1. Crear `src/game/levels/maps/MyLevel.ts` exportando un `LevelDefinition`. **Camino recomendado:** `createMap()` de `builders/MapCreator.ts` — builder fluido que compone suelo (`.ground` con boundary opcional), terreno (`.terrain`), estructuras (`.structure` = `BuildingBuilder` multi-piso con rooms/escaleras/doorways, `.house` = `HouseBuilder`), props (`.prop` con los helpers de `PropBuilder`: `crateStack`, `sandbagLine`, `coverWall`, `pillar`, `cargoContainer`, `watchtower`), NPCs/items dentro de habitaciones (`.npcInRoom`, `.pickupInRoom`, `roomPoint()` — coords locales al room, sin calcular world a mano) y emite el `LevelDefinition` validado (ids únicos). Ver `BuildingTestLevel.ts` como referencia.
2. Sumar el id al type `LevelId` y la entrada al mapa en `LevelRegistry`.
3. Audio (`ambiences`, `footstepSounds`, `music`) se resuelve solo vía `LevelLoader`.
4. (Opcional) `skybox: SkyboxId` — HDRI propio. Si se omite usa `'default'`. `background: number` queda como fallback.
5. (Opcional) `sun: { direction, color, intensity }` — sobrescribe el sol. Sub-campos omitidos caen al default del `LightingSystem`.
6. (Opcional) `terrain` — colinas/dunas. Ver receta abajo.
7. Navegabilidad: el `NavSpaceBuilder` deriva las celdas de la **colisión real** (scan multi-capa con headroom + clearance), así que todo lo que el builder coloca queda navegable por NPCs sin paso extra — interiores, escaleras, props como obstáculo/cover. Ojo: un id que contenga `stair`/`ramp` taguea la celda como escalera (cadena no podable); `roof`/`floor` también infieren superficie.
8. Escaleras de `BuildingBuilder`: dejar ≥1.5 m (ideal ≥2 m) libres más allá de ambos extremos del tramo (descarga arriba, aproximación abajo) — con menos no entran celdas y los NPCs no conectan el piso (el builder avisa por consola). La boca de aproximación debe abrir hacia área conectada del piso, no hacia un rincón cercado por el hueco del otro tramo. Los puntos de `npcInRoom`/`pickupInRoom` no deben caer sobre el hueco del stairwell del piso (la columna no tiene superficie ahí y el spawn se va a otra capa).
9. Si una geometría va a aparecer en otro nivel, **proponer extraerla a un builder nuevo** (prop en `PropBuilder` o builder propio) antes de inlinearla.

### Agregar terreno a un nivel

Heightfield 2.5D (no cuevas/overhangs). Mesh visual y collider físico se generan del mismo `HeightField`, así quedan alineados.

1. En `LevelDefinition.terrain` definir `size`, `widthSamples`/`depthSamples` (resolución), `position` (centro), `material`.
2. `source`:
   - `{ kind: 'flat', height: 0 }` — terreno plano (debug).
   - `{ kind: 'noise', seed, octaves, frequency, amplitude, persistence?, lacunarity?, baseHeight?, flattenRegions? }` — fbm fractal. `frequency` chico = features grandes; `amplitude` en metros pico-a-valle.
3. Para asentar edificios sobre terreno: `flattenRegions` en el noise source — array de `{ center: [x, z], radius, falloff, height }` (coords locales). Plateaus circulares con anillo de transición. Múltiples regiones se combinan, gana la de mayor peso.
4. `LevelLoader` crea automáticamente el mesh (`createTerrainMesh`) y el collider (`PhysicsWorld.createHeightfield`, internamente trimesh).
5. Spawnear player/pickups unos metros arriba — la gravedad los asienta.

Ejemplo: `src/game/levels/maps/SnowFieldLevel.ts`.

### Agregar un NPC

1. Entrada en `game/characters/CharacterPresets.ts` (extiende `CharacterDefinition`: modelo, collider, stats de ataque).
2. Entrada en `EnemyAudio` (`audio.config.ts`) por `CharacterId`.
3. `NPCDefinition` en `LevelDefinition.npcs` (con `patrol?: VectorTuple[]` opcional para ruta de patrulla).
4. **Si comparte un comportamiento existente** (`zombieMelee`, `combineSoldier`, `alyxSupport`): alcanza con el `aiProfileId` — `CharacterFactory.resolvePresetFor` lo mapea al preset v2 correspondiente.
5. **Si necesita comportamiento nuevo** (ej. headcrab, antlion): crear `game/npc/presets/<nombre>Preset.ts` siguiendo el patrón de `zombiePreset.ts`/`combinePreset.ts` — un array de schedules (prioridad + condition masks + tasks de `CoreTasks`/`TacticalTasks`) y stats de percepción/movimiento. Sumar el `aiProfileId` al union de `CharacterDefinition` y al dispatch de `resolvePresetFor`. Tasks nuevas van en `game/npc/brain/tasks/`. No se crean clases de NPC: el runtime `Npc` es único.

### Agregar un evento del juego

1. Extender `GameEventMap` en `src/game/GameEvents.ts` con `"namespace.action": PayloadType`.
2. Emitir donde se origina: `bus.emit("…", payload)`.
3. Suscribir desde quien reacciona: `bus.on("…", handler)`. Guardar el disposer y llamarlo en `dispose()`.

### Agregar un panel de UI

1. `MyPanel.ts` (componente) y `MyPanelView.ts` (vista). Ambos implementan `Disposable`.
2. El componente se suscribe al bus, delega DOM al view.
3. Si otros sistemas necesitan resolverlo: registrar en `Game.registerUI()` bajo nuevo `GameTokens.MyPanel`.

### Agregar un servicio

1. Decidir capa: **engine** si es genérico, **game** si conoce reglas del juego.
2. Token en `engine/core/ServiceTokens.ts` o `game/ServiceTokens.ts`.
3. Registrar en `Engine.registerServices()` o `Game.registerServices()`.
4. Consumir vía `container.resolve(Token)`.

### Agregar un sonido

1. `.mp3` en `src/engine/assets/sounds/`.
2. Registrar el clip en `engine/audio/AudioManifest.ts` con id estable.
3. Mapearlo al evento que lo dispara en `audio.config.ts`, o emitirlo directo.

### Agregar un material PBR

Materials data-driven: cada `MaterialKey` apunta a una def de color sólido o un `TextureSet` PBR. Los sets se descubren vía `import.meta.glob` (cualquier `.jpg/.png/.webp` bajo `src/engine/assets/textures/`).

1. Bajar set PBR de [Poly Haven](https://polyhaven.com/textures) o [AmbientCG](https://ambientcg.com/). Settings: **JPG**, **2K**, **NormalGL** (no DX).
2. Carpeta por material en la categoría correcta:
   - `environment/` — terreno (snow, rock, grass, sand). Tiling alto (16-64).
   - `architecture/` — construcción (brick, roof, concrete, wood). Tiling bajo (2-8).
   - `props/` — objetos sueltos. Tiling mínimo (1-2).
3. Renombrar archivos a nombres estándar: `albedo.jpg`, `normal.jpg`, `roughness.jpg`, `ao.jpg`. Solo `albedo` es obligatorio.
4. Registrar el set en `TextureSets` de `engine/render/material/Textures.ts`:
   ```ts
   miMaterial: {
     maps: { albedo: 'environment/mi_material/albedo.jpg', normal: '…', /* … */ },
     tiling: 8,
   },
   ```
5. Cablear a un `MaterialKey` en `engine/render/material/Materials.ts`:
   ```ts
   wall: { textureSet: 'miMaterial' },
   ```
6. `MaterialKey` nuevo → agregarlo al union.

`uv` → `uv1` se copia automáticamente en boxes y terreno cuando el material tiene AO (Three.js requiere segundo canal de UV para `aoMap`).

### Agregar un HDRI / skybox

1. Bajar HDRI **2K** `.hdr` de [Poly Haven HDRIs](https://polyhaven.com/hdris) (no EXR, no 4K).
2. Drop en `src/engine/assets/hdri/<nombre>.hdr`.
3. Registrar en `SkyboxManifest` de `engine/render/environment/Skybox.ts`:
   ```ts
   miCielo: { file: 'mi_cielo.hdr' },
   ```
4. Usar en un nivel: `skybox: 'miCielo'`. Si se omite, usa `'default'`.

El `EnvironmentSystem` aplica el HDRI como `scene.background` y como `scene.environment` (IBL — los `MeshStandardMaterial` lo usan automáticamente para reflejos y ambient). Por eso `LightingSystem` mantiene ambient/hemisphere bajos: el IBL provee el fill.

---

## Checklist al cerrar

- [ ] `npx tsc --noEmit` verde.
- [ ] Archivo modificado en la capa correcta (engine / game / shared).
- [ ] Ningún import cruza `engine/` → `game/`.
- [ ] Eventos nuevos usan `dominio.acción`.
- [ ] Suscriptores del `EventBus.on(...)` guardan y disponen el disposer.
- [ ] Widgets/sistemas con `setTimeout` o DOM exponen `dispose()`.
- [ ] Contenido nuevo agregado vía tabla en `config/` o manifest, no creando clase.
- [ ] Sin `any`, sin `@ts-ignore`, sin comentarios redundantes.
