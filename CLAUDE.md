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

| Carpeta / archivo        | Responsabilidad                                                          |
| ------------------------ | ------------------------------------------------------------------------ |
| `Engine.ts`              | Orquestador. Registra servicios en `ServiceContainer`, corre el loop.    |
| `EventBus.ts`            | Pub/sub genérico `EventBus<TEvents>`. Sin tipos del juego.               |
| `ServiceContainer.ts`    | DI tipado. Servicios se resuelven por `ServiceToken`.                    |
| `ServiceTokens.ts`       | `EngineTokens` — tokens canónicos del motor.                             |
| `GameLoop.ts`, `Time.ts` | RAF, delta time, sub-stepping.                                           |
| `Input.ts`               | Teclado, mouse, pointer-lock.                                            |
| `render/`                | `Renderer` (ACES tone mapping), `CameraSystem`, `LightingSystem` (sol direccional + ambient/hemisphere bajos — IBL hace el grueso del fill), `EnvironmentSystem` (HDRI → background + IBL vía PMREM), `TerrainMesh`, `PrimitiveFactory`, `Materials` (defs data-driven, color o PBR), `Textures` (`TextureSets` PBR), `Skybox` (`SkyboxManifest` HDRI). |
| `physics/`               | `PhysicsWorld` (Rapier: boxes + heightfields), `Raycast`, `KinematicCharacterBase`. |
| `audio/`                 | `AudioSystem`, `SoundManager`, `PositionalSoundManager`, `MusicManager`, `AudioManifest`. |
| `animation/`             | Animación procedural, ragdoll (`RagdollSystem`), `HitReactionAnimator`.  |
| `assets/`                | `AssetManager`, manifests de GLB y audio. Carpetas `textures/`, `hdri/`, `sounds/`. |
| `ai/StateMachine.ts`     | Máquina de estados genérica reutilizable.                                |
| `characters/`            | `CharacterDefinition` (tipo de configuración).                           |
| `debug/Gizmos.ts`        | Helpers visuales para debug.                                             |

### `game/`

| Carpeta / archivo   | Responsabilidad                                                             |
| ------------------- | --------------------------------------------------------------------------- |
| `Game.ts`           | Bootstrap. Recibe el `Engine`, registra `GameTokens`, drive del loop.       |
| `GameEvents.ts`     | `GameEventMap` + alias `GameEventBus = EventBus<GameEventMap>`.             |
| `ServiceTokens.ts`  | `GameTokens` — tokens de servicios específicos del juego.                   |
| `characters/`       | `CharacterFactory` + `CharacterPresets`.                                    |
| `npc/`              | `NPC` (FSM AI + FSM balance), `NpcCombat`, `NpcAnimationBridge`.            |
| `gameplay/`         | `Player`, `Health`, `PlayerHealth`, interactions.                           |
| `gameplay/weapons/` | `Weapon` base, `HitscanWeapon`, `MeleeWeapon`, `GravityGunWeapon`, etc.     |
| `levels/`           | `LevelDefinition`, `LevelRegistry`, `LevelLoader`, `TriggerSystem`, `builders/` (ej. `HouseBuilder`). |
| `narrative/`        | `DialogueSystem`, `ScriptedSequence`, `LevelEvents`.                        |
| `ui/`               | `HUD`, `MainMenu`, `PauseMenu`, `DebugOverlay`, `Subtitles`, widgets.       |
| `audio/`            | Sistemas reactivos a eventos: weapon/enemy/dialogue/UI sound.               |
| `config/`           | `weapons.config.ts`, `audio.config.ts`, `gameplay.config.ts`, `strings.ts`. |

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

Servicio nuevo → declarar token en `engine/ServiceTokens.ts` o `game/ServiceTokens.ts` según capa.

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
| Niveles | `game/levels/<Level>.ts` + `LevelRegistry.ts` |
| Sets PBR | `engine/render/Textures.ts` (`TextureSets`) |
| HDRIs | `engine/render/Skybox.ts` (`SkyboxManifest`) |
| Materials | `engine/render/Materials.ts` |
| Audio clips | `engine/audio/AudioManifest.ts` |

Agregar contenido = editar tabla o registrar entrada. Casi nunca implica clase nueva.

### Path aliases

Configurados en `tsconfig.json`. Para archivos nuevos preferir el alias.

```ts
import { Engine } from "@engine/Engine";
import { GameTokens } from "@game/ServiceTokens";
import { Vec3 } from "@shared/math/Vec3";
```

Conviven con rutas relativas existentes.

---

## Cómo extender

### Agregar un arma

1. Entrada en `game/config/weapons.config.ts` con todos los campos de `WeaponDefinition`.
2. Si el comportamiento no encaja en `hitscan` / `melee` / `special`, subclase de `Weapon` en `game/gameplay/weapons/` y mapearla en `WeaponFactory.createWeapon()`.
3. Clips en `engine/audio/AudioManifest.ts`, mapeados en `WeaponAudio` (`audio.config.ts`).
4. Drop del GLB en `src/models/weapons/`.
5. Entrada en `LevelDefinition.weaponPickups` del nivel.

### Agregar un nivel

1. Crear `src/game/levels/MyLevel.ts` exportando un `LevelDefinition`.
2. Sumar el id al type `LevelId` y la entrada al mapa en `LevelRegistry`.
3. Audio (`ambiences`, `footstepSounds`, `music`) se resuelve solo vía `LevelLoader`.
4. (Opcional) `skybox: SkyboxId` — HDRI propio. Si se omite usa `'default'`. `background: number` queda como fallback.
5. (Opcional) `sun: { direction, color, intensity }` — sobrescribe el sol. Sub-campos omitidos caen al default del `LightingSystem`.
6. (Opcional) `terrain` — colinas/dunas. Ver receta abajo.
7. (Opcional) Builders de `src/game/levels/builders/` (ej. `buildHouse`) para generar grupos de `StaticBoxDefinition`. Si la geometría va a aparecer en otro nivel, **proponer extraerla a un builder nuevo** antes de inlinearla.

### Agregar terreno a un nivel

Heightfield 2.5D (no cuevas/overhangs). Mesh visual y collider físico se generan del mismo `HeightField`, así quedan alineados.

1. En `LevelDefinition.terrain` definir `size`, `widthSamples`/`depthSamples` (resolución), `position` (centro), `material`.
2. `source`:
   - `{ kind: 'flat', height: 0 }` — terreno plano (debug).
   - `{ kind: 'noise', seed, octaves, frequency, amplitude, persistence?, lacunarity?, baseHeight?, flattenRegions? }` — fbm fractal. `frequency` chico = features grandes; `amplitude` en metros pico-a-valle.
3. Para asentar edificios sobre terreno: `flattenRegions` en el noise source — array de `{ center: [x, z], radius, falloff, height }` (coords locales). Plateaus circulares con anillo de transición. Múltiples regiones se combinan, gana la de mayor peso.
4. `LevelLoader` crea automáticamente el mesh (`createTerrainMesh`) y el collider (`PhysicsWorld.createHeightfield`, internamente trimesh).
5. Spawnear player/pickups unos metros arriba — la gravedad los asienta.

Ejemplo: `src/game/levels/SnowFieldLevel.ts`.

### Agregar un NPC

1. Preset en `game/characters/CharacterPresets.ts` (extiende `CharacterDefinition`).
2. Entrada en `EnemyAudio` (`audio.config.ts`) por `CharacterId`.
3. `NPCDefinition` en `LevelDefinition.npcs`.
4. La AI (`NPC.ts`) compone dos `StateMachine` (AI + balance) + `NpcCombat` + `NpcAnimationBridge`. Subclasear solo si cambia el combate.

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
2. Token en `engine/ServiceTokens.ts` o `game/ServiceTokens.ts`.
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
4. Registrar el set en `TextureSets` de `engine/render/Textures.ts`:
   ```ts
   miMaterial: {
     maps: { albedo: 'environment/mi_material/albedo.jpg', normal: '…', /* … */ },
     tiling: 8,
   },
   ```
5. Cablear a un `MaterialKey` en `engine/render/Materials.ts`:
   ```ts
   wall: { textureSet: 'miMaterial' },
   ```
6. `MaterialKey` nuevo → agregarlo al union.

`uv` → `uv1` se copia automáticamente en boxes y terreno cuando el material tiene AO (Three.js requiere segundo canal de UV para `aoMap`).

### Agregar un HDRI / skybox

1. Bajar HDRI **2K** `.hdr` de [Poly Haven HDRIs](https://polyhaven.com/hdris) (no EXR, no 4K).
2. Drop en `src/engine/assets/hdri/<nombre>.hdr`.
3. Registrar en `SkyboxManifest` de `engine/render/Skybox.ts`:
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
