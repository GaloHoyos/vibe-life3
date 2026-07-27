# vibe-life 3

FPS 3D singleplayer en navegador. Fan project de Half-Life 3.

Stack: TypeScript estricto, Vite, Three.js 0.164, Rapier3D-compat 0.14, Node 20+.

Online: juego en https://vibe-life3.pages.dev. Workshop backend en Cloudflare Worker.

## Comandos

- `npm install`: instala dependencias.
- `npm run dev`: Vite dev server en `http://127.0.0.1:5173`.
- `npm run typecheck` o `npx tsc --noEmit`: TypeScript sin bundle.
- `npm run build`: typecheck + build de Vite.
- `npm run test`: suite Vitest.
- `npm run preview`: sirve el build de produccion.

## Reglas de trabajo

1. Inspeccionar antes de tocar. Si falta detalle, usar `rg`/lectura del repo en vez de asumir desde este archivo.
2. `engine/` nunca importa de `game/`. Si la dependencia es real, mover el tipo a `shared/` o invertir via interface.
3. Preferir editar archivos existentes. No crear documentacion nueva (`*.md`, README) salvo pedido explicito.
4. No crear commits sin pedido del usuario. Mensajes concisos, en espanol, sin co-author de IA salvo pedido.
5. Binarios del artista intocables: `src/models/` y `src/engine/assets/sounds/`. Texturas y HDRIs solo con permiso explicito.
6. Prohibido sin permiso: `git -i`, `git --no-verify`, `rm -rf`, `git reset --hard`.
7. TypeScript estricto: cero `any`, cero `@ts-ignore`; respetar `strict`, `noImplicitOverride`, `noFallthroughCasesInSwitch` y casing consistente.
8. Strings visibles al jugador en espanol. Identificadores y comentarios tecnicos en ingles.
9. Cero comentarios redundantes. Solo explicar el por que: constraint oculto, workaround o comportamiento sorprendente.
10. Al cerrar cambios de codigo, correr `npm run typecheck`; idealmente tambien `npm run build` si toca gameplay, engine, editor o deploy.

## Arquitectura

Tres capas estrictas:

- `src/engine/`: infraestructura generica, agnostica del contenido.
- `src/game/`: contenido, reglas, UI y bootstrap especificos del juego.
- `src/shared/`: tipos y utilidades comunes. Evitar Three.js salvo tipos estructurales (`Vector3`, `Object3D`).

Mapa rapido:

| Area | Responsabilidad |
| --- | --- |
| `engine/core` | `Engine`, loop, escenas, recursos, DI, eventos genericos y base `System`. |
| `engine/input` | Teclado, mouse, pointer-lock y bindings. |
| `engine/render` | Renderer, camara, primitivas, terreno, materiales, texturas, HDRI, skybox y luces. |
| `engine/physics` | Rapier, colliders, raycasts, character controller, motor y spawn validation. |
| `engine/audio` | Buses, carga/reproduccion, musica, ambience, footsteps y manifiesto de clips. |
| `engine/animation` | Capas, pose humanoide, procedural animation, ragdoll y debug. |
| `engine/ai` | Factions, brain/schedules, perception, locomotion, navspace, pathfinding y smoothing. |
| `engine/assets` | Manifiestos y assets compilados de texturas, HDRI y sonidos. |
| `game/Game.ts` | Bootstrap, registro de servicios, UI y carga de niveles. |
| `game/ServiceTokens.ts` / `GameEvents.ts` | Tokens y eventos tipados del juego. |
| `game/gameplay` | Player, health, stamina, interacciones, puertas, armas, pickups y efectos de armas. |
| `game/npc` / `game/characters` | Runtime unico `Npc`, presets, brain tasks, combate, squad/tactical AI y animation bridge. |
| `game/levels` | `LevelDefinition`, registry, loader, triggers, cover, mapas, builders y edificios. |
| `game/editor` | Editor visual, `EditorDocument`, codegen, persistencia, map library y gizmos. |
| `game/workshop` | Cliente Workshop, backend interface, IndexedDB/localStorage, sanitizacion y menu. |
| `game/ui` / `game/audio` / `game/config` | HUD, menus, subtitles, audio reactivo y tablas data-driven. |

## Patrones obligatorios

- ServiceContainer: servicios por token. `EngineTokens` para infraestructura generica; `GameTokens` para reglas del juego. Servicio nuevo = token en la capa correcta, registro en `Engine` o `Game`, consumo via `container.resolve(...)`.
- EventBus: un solo bus tipado por `GameEventMap` en `src/game/GameEvents.ts`. Eventos con nombre `dominio.accion` en minusculas. `on(...)` devuelve disposer: guardarlo y llamarlo en `dispose()`.
- UI Component + View: componente para lifecycle, estado y bus; view para DOM/render imperativo. Subwidgets hoja exponen `dispose()` si manejan timers, listeners o DOM propio.
- Data-driven primero: agregar contenido en tablas/manifiestos antes de crear clases. Fuentes comunes: `game/config/*.config.ts`, `game/config/strings.ts`, `engine/audio/AudioManifest.ts`, `engine/render/material/Textures.ts`, `Materials.ts`, `Skybox.ts`, `game/levels/maps/*` y `LevelRegistry.ts`.
- Imports: si cruza directorios, usar aliases `@engine`, `@game`, `@shared`, `@tests`. Relativo `./` solo para vecinos del mismo directorio.
- Tests: fuera de `src`, espejando paths en `tests/unit`, `tests/integration` o `tests/contracts`. Usar Vitest/happy-dom; no meter `.test.ts` dentro de `src`.

## Guia de cambios frecuentes

| Cambio | Fuente de verdad | Regla critica |
| --- | --- | --- |
| Arma | `game/config/weapons.config.ts`, `WeaponFactory`, audio config/manifiesto, pickups del nivel | Crear clase solo si no encaja en `hitscan`, `melee` o `special`. No tocar modelos existentes. |
| Nivel | `game/levels/maps/*`, `LevelRegistry`, builders | Preferir `createMap()`. Si la geometria se reutiliza, proponer builder/prop en vez de inlinear. |
| Terreno | `LevelDefinition.terrain`, `HeightField`, `LevelLoader` | Mesh visual y collider salen de la misma fuente. Usar `flattenRegions` para apoyar edificios. |
| NPC | `CharacterPresets`, `EnemyAudio`, `LevelDefinition.npcs`, presets en `game/npc/presets` | El runtime es `Npc` unico. Reusar `aiProfileId`; crear preset/tasks solo para comportamiento nuevo. |
| Evento | `src/game/GameEvents.ts` | Extender el map, emitir donde nace, suscribir donde reacciona y disponer listeners. |
| Panel UI | `MyPanel.ts` + `MyPanelView.ts` | Ambos `Disposable`; registrar `GameTokens.*` solo si otros sistemas deben resolverlo. |
| Servicio | `ServiceTokens.ts`, `Engine.registerServices()` o `Game.registerServices()` | Elegir capa por conocimiento: engine generico, game reglas/contenido. |
| Sonido | `AudioManifest.ts`, `audio.config.ts` | `src/engine/assets/sounds/` requiere permiso por ser binario del artista. |
| Material PBR | `Textures.ts`, `Materials.ts`, assets en `engine/assets/textures` | Requiere permiso; nombres estandar: `albedo`, `normal`, `roughness`, `ao`; agregar `MaterialKey` si corresponde. |
| HDRI / skybox | `Skybox.ts`, assets en `engine/assets/hdri` | Requiere permiso; usar `.hdr` 2K y referenciar con `skybox` en el nivel. |

Notas de niveles:

- El `NavSpaceBuilder` deriva navegabilidad de la colision real; props, interiores y escaleras deben quedar fisicamente conectados.
- IDs con `stair`/`ramp` afectan tagging de nav; `roof`/`floor` tambien infieren superficie.
- En escaleras de `BuildingBuilder`, dejar al menos 1.5 m libres en extremos, ideal 2 m. No spawnear NPCs/pickups sobre huecos de stairwell.

## Editor, Workshop y Deploy

Editor:

- Estado `"editor"`: entra con F4 o boton del menu.
- El contenido custom es `EditorDocument` JSON: datos, no codigo. Smart objects conservan spec (`building`, `house`, `ramp`, `prop`), no geometria aplanada.
- `toLevelDefinition(doc)` corre builders y valida ids; playtest usa el mismo pipe que la campania.
- Autosave en `localStorage`; biblioteca custom via `mapLibrary`.

Workshop:

- Cliente en `src/game/workshop` depende solo de `WorkshopBackend` (`list`, `fetchDocument`, `publish`, `signIn`).
- Implementacion actual: `CloudflareWorkshopBackend` via `VITE_WORKSHOP_API`; suscripciones en IndexedDB + indice sync en `localStorage`.
- Servidor en carpeta hermana `vibe-life 3 workshop backend/`. No compartir imports ni codigo entre cliente y servidor; solo contrato HTTP.
- El servidor es autoridad de validacion (`validateDocument`). El cliente solo hace `sanitizeDocument` best-effort.
- Fase actual: solo assets built-in; no carga dinamica de GLB ni assets remotos.
- El editor no conoce Workshop: publica mediante callback hacia `Game`/`WorkshopService`.

Deploy:

- Juego: Cloudflare Pages desde `main`, build `npm run build`, output `dist`, URL estable `https://vibe-life3.pages.dev`.
- `package-lock.json` no se versiona; Pages debe correr `npm install`. Para redeployar un fix, pushear commit nuevo.
- Limite Pages: 25 MiB por archivo. Modelos GLB pesados se comprimen con `gltf-transform resize` a 2K y luego `webp`.
- `VITE_WORKSHOP_API` se hornea en build; cambiarlo requiere redeploy.
- Backend: Worker en `https://vibe-life-workshop.vibelife3.workers.dev`. Vars por `wrangler.toml` + deploy; secrets con `wrangler secret put`. `ALLOWED_ORIGIN` debe ser el origen del juego.

## Checklist al cerrar

- [ ] `npm run typecheck` o `npx tsc --noEmit` verde para cambios de codigo.
- [ ] Archivo en la capa correcta: `engine`, `game` o `shared`.
- [ ] Ningun import `engine -> game`; imports entre directorios con aliases.
- [ ] Sin `any`, sin `@ts-ignore`, sin comentarios redundantes.
- [ ] Eventos nuevos usan `dominio.accion`; subscribers/timers/DOM se disponen.
- [ ] Contenido nuevo agregado via config, registry o manifest cuando sea posible.
- [ ] Assets protegidos no tocados sin permiso.
- [ ] Strings visibles al jugador en espanol.
