# vibe-life 3

FPS 3D singleplayer para navegador, fan project Half-Life 3. Stack: **TypeScript estricto + Vite + Three.js (0.164) + Rapier3D-compat (0.14)**.

## Comandos

| Script            | Qué hace                      |
| ----------------- | ----------------------------- |
| `npm run dev`     | Vite dev server con HMR       |
| `npm run build`   | `tsc --noEmit` + `vite build` |
| `npm run preview` | Sirve el build de producción  |

Para verificar rápido sin compilar bundle: `npx tsc --noEmit`.

## Arquitectura

Separación estricta en tres capas. **El motor NO importa de `game/`.** Si una clase del engine necesita conocer un evento o tipo de juego, está en la capa incorrecta.

```
src/
├─ engine/      → infraestructura genérica, agnóstica del contenido
├─ game/        → contenido y reglas específicas de este juego
└─ shared/      → tipos/utilidades comunes a ambos (math, lifecycle)
```

### `engine/` (infra)

Subsistemas reutilizables sin acoplamiento al juego concreto:

- `Engine.ts` — orquestador. Registra servicios en un `ServiceContainer` y corre el game loop con el callback que le pasa `Game`.
- `EventBus.ts` — clase genérica `EventBus<T>`. NO contiene tipos de eventos del juego.
- `ServiceContainer.ts` + `ServiceTokens.ts` (`EngineTokens`) — DI tipado para servicios del motor.
- `render/`, `physics/`, `input/`, `assets/`, `audio/` (core: AudioSystem, SoundManager, PositionalSoundManager, MusicManager, BackgroundAmbienceSystem, FootstepSoundSystem), `animation/`, `ai/StateMachine.ts`, `debug/Gizmos.ts`, `characters/CharacterDefinition.ts` (config-type).

### `game/` (contenido)

Todo lo que conoce reglas concretas (armas, NPCs, niveles, narrativa, UI propia):

- `Game.ts` — bootstrap del juego. Recibe el `Engine`, registra `GameTokens` (event bus tipado, gameplay, narrativa, UI, audio reactivo a eventos), carga niveles, drive del loop.
- `GameEvents.ts` — `GameEventMap` + `GameEventBus = EventBus<GameEventMap>`.
- `ServiceTokens.ts` (`GameTokens`) — tokens para servicios específicos del juego.
- `characters/` (factory + presets), `npc/`, `gameplay/` (Player, weapons, interactions), `levels/`, `narrative/`, `ui/` (HUD, menu, DebugOverlay), `audio/` (Weapon/Enemy/Dialogue/UISoundSystem — escuchan game events).

### `shared/`

`math/Vec3.ts`, `math/VectorTuple.ts`, `types/lifecycle.ts` (Damageable, Disposable, Updatable). Nada de Three.js fuera de tipos estructurales.

## Patrones clave

### ServiceContainer

```ts
// Engine registra servicios
const camera = container.register(EngineTokens.Camera, new CameraSystem(root));

// Game registra encima de eso
container.register(GameTokens.EventBus, new EventBus<GameEventMap>());

// Cualquiera resuelve
const camera = container.resolve(EngineTokens.Camera);
```

Tokens están separados: `EngineTokens` en `engine/ServiceTokens.ts`, `GameTokens` en `game/ServiceTokens.ts`. Quien añade un servicio nuevo: declara su token en el archivo de la capa correcta.

### EventBus

Un solo bus tipado por `GameEventMap` se registra en `GameTokens.EventBus` desde `Game.registerEventBus()`. Engine subsystems que necesitan emitir/escuchar eventos del juego viven en `game/` (no en `engine/`).

Nombres canónicos (ya migrados): `weapon.ammo.changed`, `player.health.changed`, `interaction.focus`/`interaction.blur`. Evitar revivir `ammo.changed`, `player.healthChanged`, `interact.changed`.

### Patrón Component + View para UI

Cada panel de UI no trivial se divide en dos archivos:

- **Component** (`HUD.ts`, `Subtitles.ts`, `MainMenu.ts`) — lifecycle, suscripciones al `GameEventBus`, estado en memoria, API pública. Implementa `Disposable` y limpia listeners + delega `dispose()` al view.
- **View** (`HUDView.ts`, `SubtitlesView.ts`, `MainMenuView.ts`) — render puro: composita subwidgets, hace mutaciones DOM, expone métodos imperativos (`setX(...)`). Implementa `Disposable` y limpia timers/elementos.

Subwidgets (`Crosshair`, `DamageIndicator`, `WeaponHUD`, …) son hojas: clase con `element` y métodos `pulseX`/`setX`, sin tocar el event bus. Si tienen `setTimeout` pendiente exponen `dispose()`.

### Path aliases (configurados en `tsconfig.json`)

`@engine/*`, `@game/*`, `@shared/*`. La base actual usa relativos; nuevos archivos pueden usar los aliases.

## Estado del refactor (plan de 12 fases)

✅ Fase 0 — Higiene previa (aliases, flags TS estrictos extra)  
✅ Fase 1 — Eliminar duplicados/dead code  
✅ Fase 2 — Normalizar nombres canónicos de eventos  
✅ Fase 3 — Service Container + Engine delgado  
✅ Fase 4 — Migración Engine vs Game vs Shared + extracción de `Game.ts`  
✅ Fase 5 — Niveles 100% data-driven (LevelRegistry, ambiences/footstepSounds/music en LevelDefinition)  
✅ Fase 6 — Armas data-driven (WeaponDefinitions en `game/config/weapons.config.ts`, WeaponFactory por tipo, WeaponEffects cleanup robusto)  
✅ Fase 7 — IA modular (NPC = StateMachine<NpcAiState> + StateMachine<NpcBalanceState> + NpcCombat + NpcAnimationBridge)  
✅ Fase 8 — Ragdoll fachada documentada (`RagdollSystem` con `liveSensors`/`passiveRagdoll`), `ActiveRagdollController` → `HitReactionAnimator`, `KinematicCharacterBase` compartido Player/NPC  
✅ Fase 9 — UI consistente (HUDState inlined, `SubtitleView` → `SubtitlesView`, dispose en todos los widgets con timers/DOM)  
✅ Fase 10 — Audio data-driven (tablas declarativas `WeaponAudio`/`EnemyAudio` en `game/config/audio.config.ts`; `npc.*` lleva `characterId`)  
⬜ Fase 11 — Strings/diálogos fuera del código  
⬜ Fase 12 — JSDoc en APIs públicas + smoke test

## Convenciones

- TypeScript estricto. Sin `any`. Sin `@ts-ignore`. Las flags están en `tsconfig.json` (strict, noImplicitOverride, noFallthroughCasesInSwitch, forceConsistentCasingInFileNames).
- Cero comentarios redundantes. Solo JSDoc/comentario cuando explica _por qué_, no _qué_.
- Idioma de strings de usuario: español (mensajes, subtítulos, UI). Identificadores y comentarios técnicos: inglés.
- Cada fase debe terminar con `tsc --noEmit` verde antes de cerrarse. Idealmente también `vite build`.

## Reglas duras

1. **`engine/` nunca importa de `game/`**. Si necesita un tipo del juego, el tipo va a `shared/` o se invierte la dependencia.
2. **No crear archivos nuevos sin razón**. Preferir editar existentes. No generar docs/README a menos que se pida.
3. **No crear commits sin que el usuario lo pida**. Cuando los pida: mensajes concisos, en español, sin co-author de IA salvo que se solicite.
4. **No tocar `models/` ni `assets/sounds/`** — son binarios versionados que pertenecen al artista.
5. **No usar `git -i`, `git --no-verify`, `rm -rf`, `git reset --hard`** sin permiso explícito.

## Cómo arrancar la siguiente fase

Mirar la lista de fases pendientes arriba, pedir confirmación al usuario sobre cuál atacar, planificarla en sub-fases pequeñas (cada una con `tsc --noEmit` verde al final), ejecutarlas con commits opcionales entre fases.
