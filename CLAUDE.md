# vibe-life 3

FPS 3D singleplayer para navegador. Fan project de Half-Life 3.

**Stack:** TypeScript estricto · Vite · Three.js 0.164 · Rapier3D-compat 0.14

---

## Para agentes IA — leer antes de modificar código

1. Respetar la separación engine / game / shared (ver Arquitectura).
2. Preferir editar archivos existentes antes que crear nuevos.
3. Ejecutar `npx tsc --noEmit` al terminar cada cambio.
4. No tocar assets binarios ni modelos salvo pedido explícito.
5. No crear commits sin que el usuario lo pida.

---

## Requisitos

- Node.js 18 o superior
- npm

## Comandos

| Script             | Qué hace                                          |
| ------------------ | ------------------------------------------------- |
| `npm install`      | Instala dependencias                              |
| `npm run dev`      | Vite dev server con HMR (`http://127.0.0.1:5173`) |
| `npm run build`    | `tsc --noEmit` + `vite build` (genera `dist/`)    |
| `npm run preview`  | Sirve el build de producción                      |
| `npx tsc --noEmit` | Verificación rápida de tipos sin bundle           |

## Controles

| Tecla             | Acción                              |
| ----------------- | ----------------------------------- |
| `Click`           | Capturar mouse (pointer-lock)       |
| `WASD`            | Mover                               |
| `Mouse`           | Mirar                               |
| `Espacio`         | Saltar                              |
| `Click izquierdo` | Disparar / golpear                  |
| `1`–`5`, rueda    | Cambiar de arma                     |
| `R`               | Recargar                            |
| `E`               | Interactuar                         |
| `F3`              | Debug overlay (FPS, posición, NPCs) |
| `Esc`             | Pausar / liberar mouse              |

---

## Arquitectura

Tres capas con separación estricta. **El motor NO importa de `game/`.** Si una clase del engine necesita un tipo del juego, el tipo va a `shared/` o se invierte la dependencia vía interface.

```
src/
├─ engine/    → infraestructura genérica, agnóstica del contenido
├─ game/      → contenido y reglas específicas de este juego
└─ shared/    → tipos/utilidades comunes a ambas capas
```

### `engine/` — el motor

Subsistemas reutilizables. No conoce armas, NPCs, niveles ni UI concreta.

| Carpeta / archivo        | Responsabilidad                                                          |
| ------------------------ | ------------------------------------------------------------------------ |
| `Engine.ts`              | Orquestador. Registra servicios en `ServiceContainer` y corre el loop.   |
| `EventBus.ts`            | Pub/sub genérico `EventBus<TEvents>`. No contiene tipos del juego.       |
| `ServiceContainer.ts`    | DI tipado. Los servicios se resuelven por `ServiceToken`.                |
| `ServiceTokens.ts`       | `EngineTokens` — tokens canónicos del motor.                             |
| `GameLoop.ts`, `Time.ts` | RAF, delta time, sub-stepping.                                           |
| `Input.ts`               | Teclado, mouse, pointer-lock.                                            |
| `render/`                | `Renderer`, `CameraSystem`, `LightingSystem`, materiales y primitivas.   |
| `physics/`               | `PhysicsWorld` (Rapier), `Raycast`, `KinematicCharacterBase`.            |
| `audio/`                 | `AudioSystem`, `SoundManager`, `PositionalSoundManager`, `MusicManager`. |
| `animation/`             | Animación procedural, ragdoll (`RagdollSystem`), `HitReactionAnimator`.  |
| `assets/`                | `AssetManager`, manifest de GLB/audio.                                   |
| `ai/StateMachine.ts`     | Máquina de estados genérica reutilizable.                                |
| `characters/`            | `CharacterDefinition` (tipo de configuración).                           |
| `debug/Gizmos.ts`        | Helpers visuales para debug.                                             |

### `game/` — el juego

Todo lo que conoce las reglas concretas: armas, NPCs, niveles, narrativa, HUD propio.

| Carpeta / archivo   | Responsabilidad                                                             |
| ------------------- | --------------------------------------------------------------------------- |
| `Game.ts`           | Bootstrap. Recibe el `Engine`, registra `GameTokens`, drive del loop.       |
| `GameEvents.ts`     | `GameEventMap` + alias `GameEventBus = EventBus<GameEventMap>`.             |
| `ServiceTokens.ts`  | `GameTokens` — tokens de servicios específicos del juego.                   |
| `characters/`       | `CharacterFactory` + `CharacterPresets`.                                    |
| `npc/`              | `NPC` (FSM AI + FSM balance), `NpcCombat`, `NpcAnimationBridge`.            |
| `gameplay/`         | `Player`, `Health`, `PlayerHealth`, interactions.                           |
| `gameplay/weapons/` | `Weapon` base, `HitscanWeapon`, `MeleeWeapon`, `GravityGunWeapon`, etc.     |
| `levels/`           | `LevelDefinition`, `LevelRegistry`, `LevelLoader`, `TriggerSystem`.         |
| `narrative/`        | `DialogueSystem`, `ScriptedSequence`, `LevelEvents`.                        |
| `ui/`               | `HUD`, `MainMenu`, `PauseMenu`, `DebugOverlay`, `Subtitles`, widgets.       |
| `audio/`            | Sistemas reactivos a eventos: weapon/enemy/dialogue/UI sound.               |
| `config/`           | `weapons.config.ts`, `audio.config.ts`, `gameplay.config.ts`, `strings.ts`. |

### `shared/` — código compartido

- `math/Vec3.ts`, `math/VectorTuple.ts` — utilidades de vectores.
- `types/lifecycle.ts` — interfaces `Damageable`, `Disposable`, `Updatable`.

Nada de Three.js fuera de tipos estructurales (`Vector3`, `Object3D`).

---

## Patrones clave

### ServiceContainer (DI por tokens)

Engine y Game registran servicios contra el mismo contenedor; quien los necesita los resuelve por token. Los tokens están separados por capa para que la dirección de las dependencias sea visible.

```ts
// engine/Engine.ts
container.register(EngineTokens.Camera, new CameraSystem(root));

// game/Game.ts
container.register(GameTokens.EventBus, new EventBus<GameEventMap>());

// Cualquier consumidor
const camera = container.resolve(EngineTokens.Camera);
const bus = container.resolve(GameTokens.EventBus);
```

Quien añade un servicio nuevo declara su token en el archivo de la capa correcta (`engine/ServiceTokens.ts` o `game/ServiceTokens.ts`).

### EventBus tipado

Existe **un solo bus** por juego, tipado por `GameEventMap`. Se registra en `GameTokens.EventBus` desde `Game.registerEventBus()`. Los handlers reciben el payload tipado sin casts.

```ts
eventBus.on("player.health.changed", ({ current, max }) => { /* … */ });
eventBus.emit("weapon.ammo.changed", { current: 12, reserve: 90 });
```

Nombres canónicos: `weapon.ammo.changed`, `weapon.fired`, `weapon.hit`, `weapon.changed`, `player.health.changed`, `player.armor.changed`, `player.damaged`, `player.dead`, `npc.damaged`, `npc.killed`, `npc.alert`, `npc.attack`, `interaction.focus`, `interaction.blur`, `subtitle.show`, `dialogue.show`, `objective.updated`. Definidos en `src/game/GameEvents.ts` — agregar uno nuevo es extender ese map.

Nombrado: `dominio.acción` en minúsculas. Evitar camelCase en la clave o tiempos verbales mezclados.

### Component + View para UI

Cada panel no trivial vive en dos archivos:

- **Component** (`HUD.ts`, `Subtitles.ts`, `MainMenu.ts`) — lifecycle, suscripciones al `GameEventBus`, estado en memoria, API pública. Implementa `Disposable` y limpia listeners + delega `dispose()` al view.
- **View** (`HUDView.ts`, `SubtitlesView.ts`, `MainMenuView.ts`) — render puro: composita subwidgets, mutaciones DOM, métodos imperativos (`setX(...)`). Implementa `Disposable`.

Subwidgets (`Crosshair`, `DamageIndicator`, `WeaponHUD`, etc.) son hojas: clase con `element` y métodos `pulseX/setX`, sin tocar el bus. Si tienen `setTimeout` pendiente exponen `dispose()`.

### Data-driven

Donde antes había `if (weaponType === "pistol") …`, hoy hay tablas declarativas:

- `game/config/weapons.config.ts` — definición completa de cada arma.
- `game/config/audio.config.ts` — `WeaponAudio` y `EnemyAudio`.
- `game/config/gameplay.config.ts` — magic numbers del Player y vitals.
- `game/config/strings.ts` — todos los textos visibles al jugador.
- `game/levels/LevelDefinition.ts` + `LevelRegistry.ts` — niveles como datos.

Agregar contenido = editar tabla o registrar entrada. Casi nunca implica crear una clase nueva.

### Path aliases

Configurados en `tsconfig.json`. Nuevos archivos pueden usarlos.

```ts
import { Engine } from "@engine/Engine";
import { GameTokens } from "@game/ServiceTokens";
import { Vec3 } from "@shared/math/Vec3";
```

La base actual usa rutas relativas; ambos estilos conviven.

---

## Cómo extender

### Agregar un arma

1. Añadir entrada en `game/config/weapons.config.ts` con todos los campos de `WeaponDefinition`.
2. Si el comportamiento no encaja en `hitscan` / `melee` / `special`, crear subclase de `Weapon` en `game/gameplay/weapons/` y mapearla en `WeaponFactory.createWeapon()`.
3. Registrar clips en `engine/audio/AudioManifest.ts` y mapearlos en `WeaponAudio` (`audio.config.ts`).
4. Drop del GLB en `src/models/weapons/`.
5. Añadir entrada en `LevelDefinition.weaponPickups` del nivel correspondiente.

### Agregar un nivel

1. Crear `src/game/levels/MyLevel.ts` exportando un `LevelDefinition`.
2. Sumar el id al type `LevelId` y la entrada al mapa en `LevelRegistry`.
3. El `audio.ambiences` / `audio.footstepSounds` / `audio.music` se resuelven solos vía `LevelLoader`.

### Agregar un NPC

1. Añadir preset en `game/characters/CharacterPresets.ts` (extiende `CharacterDefinition`).
2. Agregar entrada en `EnemyAudio` (`audio.config.ts`) por `CharacterId`.
3. Añadir `NPCDefinition` en `LevelDefinition.npcs`.
4. La AI (`NPC.ts`) compone dos `StateMachine` (AI + balance) + `NpcCombat` + `NpcAnimationBridge` — solo se subclasea si el comportamiento de combate cambia.

### Agregar un evento del juego

1. Extender `GameEventMap` en `src/game/GameEvents.ts` con `"namespace.action": PayloadType`.
2. Emitir desde donde se origina: `bus.emit("…", payload)`.
3. Suscribir desde quien reacciona: `bus.on("…", handler)`. Guardar el disposer y llamarlo en `dispose()`.

### Agregar un panel de UI

1. Crear `MyPanel.ts` (componente) y `MyPanelView.ts` (vista). Ambos implementan `Disposable`.
2. El componente se suscribe al `GameEventBus` y delega DOM al view.
3. Registrar en `Game.registerUI()` bajo un nuevo `GameTokens.MyPanel` si otros sistemas necesitan resolverlo.

### Agregar un servicio

1. Decidir capa: **engine** si es genérico, **game** si conoce reglas del juego.
2. Declarar token en `engine/ServiceTokens.ts` o `game/ServiceTokens.ts`.
3. Registrar instancia en `Engine.registerServices()` o `Game.registerServices()`.
4. Consumir vía `container.resolve(Token)`.

### Agregar un sonido

1. Añadir el archivo `.mp3` bajo `src/assets/sounds/`.
2. Registrar el clip en `engine/audio/AudioManifest.ts` con un id estable.
3. Mapearlo al evento que lo dispara en `audio.config.ts` o emitirlo directamente.

---

## Checklist antes de cerrar un cambio

- [ ] `npx tsc --noEmit` verde.
- [ ] `npm run build` verde (idealmente).
- [ ] El archivo modificado pertenece a la capa correcta (engine / game / shared).
- [ ] Ningún `import` cruza desde `engine/` hacia `game/`.
- [ ] Los eventos nuevos usan nombres canónicos `dominio.acción`.
- [ ] Los suscriptores guardan y disponen el disposer del `EventBus.on(...)`.
- [ ] Los widgets/sistemas con `setTimeout` o DOM exponen `dispose()`.
- [ ] Si agregaste contenido, fue editando una tabla de `config/`, no creando una clase nueva.
- [ ] Sin `any`, sin `@ts-ignore`, sin comentarios que repitan lo que dice el código.

---

## Reglas duras

1. **`engine/` nunca importa de `game/`.** Si la dependencia es real, el tipo va a `shared/` o se invierte vía interface.
2. **No crear archivos nuevos sin razón.** Preferir editar existentes. No generar documentación nueva salvo que el usuario lo pida.
3. **No crear commits sin que el usuario lo pida.** Mensajes concisos, en español, sin co-author de IA salvo solicitud explícita.
4. **No tocar `src/models/` ni `src/assets/sounds/`** — binarios versionados que pertenecen al artista.
5. **No usar `git -i`, `git --no-verify`, `rm -rf`, `git reset --hard`** sin permiso explícito.
6. **TypeScript estricto.** Cero `any`, cero `@ts-ignore`. Flags en `tsconfig.json`: `strict`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`.
7. **Cero comentarios redundantes.** Solo JSDoc/comentario cuando explica el _por qué_, no el _qué_.
8. **Idioma.** Strings de usuario en español (mensajes, subtítulos, UI). Identificadores y comentarios técnicos en inglés.

---

## Smoke test manual

Para verificar regresiones después de cambios estructurales, correr `npm run dev` y ejecutar:

- [ ] Menú principal carga sin errores en consola.
- [ ] "Nueva Partida" → Demo: el nivel se carga, el pointer-lock activa al click.
- [ ] WASD + mouse mueven al jugador; salto con espacio.
- [ ] Cambiar de arma con 1-5 y rueda del mouse.
- [ ] Disparar cada arma (pistol/SMG/AR3/crowbar/gravity gun) — todas suenan, recoil visible, tracer/decals.
- [ ] Recoger un weapon pickup duplicado suma ammo.
- [ ] E sobre el botón de la puerta: abre/cierra con diálogo.
- [ ] Recibir daño del NPC zombie: HUD parpadea, vida baja.
- [ ] Matar al NPC: ragdoll cae, subtítulo "Entidad hostil neutralizada".
- [ ] Audio de pasos suena al caminar (snow).
- [ ] F3 toggle del debug overlay (FPS, posición, NPCs).
- [ ] Esc pausa el juego; reanudar lo destraba.

---

## Estado del refactor

Las 13 fases (0–12) están completadas. El proyecto está en estado post-refactor: arquitectura estabilizada, build verde.

**Fase 0** — Higiene previa · **Fase 1** — Dead code · **Fase 2** — Nombres canónicos · **Fase 3** — Service Container · **Fase 4** — Engine/Game/Shared · **Fase 5** — Niveles data-driven · **Fase 6** — Armas data-driven · **Fase 7** — IA modular · **Fase 8** — Ragdoll fachada · **Fase 9** — UI consistente · **Fase 10** — Audio data-driven · **Fase 11** — Strings externalizados · **Fase 12** — JSDoc + build verde
