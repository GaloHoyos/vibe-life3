# Roadmap de gameplay — "Half-Life 3"

Progreso de las mejoras de gameplay/contenido para que el juego se sienta como un
Half-Life completo. Ordenado por impacto. Marcá cada ítem al cerrarlo.

> Documento de seguimiento entre sesiones. La fuente de verdad del diseño de cada
> tanda vive en el plan correspondiente; acá solo se trackea el estado.

---

## Tier 1 — Lo que lo vuelve un juego (no un demo)

- [x] **Muerte → Game Over → Respawn/Checkpoint** *(hecho)*
  - Muerte estilo HL2: la cámara cae al piso (con el arma) y sube un tinte rojo
    (`DeathSequence` + `DeathScreen`); al asentarse aparece una tarjeta del traje H.E.V.
    en flatline. Un clic o cualquier tecla reanima; `Esc` sale al menú.
  - `CheckpointSystem` (`src/game/levels/CheckpointSystem.ts`): volúmenes invisibles que
    capturan un snapshot del jugador (posición + vida/armadura + inventario/munición).
  - Respawn estilo HL: "Reintentar" persiste el snapshot en `sessionStorage` y recarga la
    página (teardown limpio), reapareciendo en el último checkpoint con el encuentro reseteado.
  - Setters de restauración: `Health.set`, `PlayerHealth.restore`, `Weapon.restoreAmmo`,
    `WeaponController.capture/restoreLoadout`.
  - Checkpoints declarados por nivel vía `LevelDefinition.checkpoints` (demo en `DemoLevel`).
  - **Limitaciones / pendientes:** respawn solo para niveles del registro (campaña +
    `maps/custom/`); mapas de biblioteca/Workshop solo ofrecen "Salir al menú". El editor de
    niveles todavía no expone checkpoints. La vida se restaura tal cual se capturó (sin piso mínimo).
- [x] **Triggers con acción** *(hecho; luego reemplazado por Entity I/O)* — el runtime actual usa
  `connections` sobre `TriggerDefinition`: `OnStartTouch`/`OnEndTouch` alimentan el grafo y los
  inputs `Enable`/`Disable`/`Toggle` controlan el volumen. Soporta `once`, cooldown `wait`, rotación
  y cierre balanceado del touch al deshabilitar. El formato intermedio `TriggerAction` ya no existe
  en runtime; `migrateDocument` convierte automáticamente mapas legacy (`dialogue`/`actions`) al
  cargarlos para conservar biblioteca y Workshop.
- [x] **Encadenar niveles** *(hecho — transición seamless estilo HL2)* — `LevelDefinition.nextLevel`
  + entidad `changelevel` disparada por I/O. Al cruzar la salida, `Game.goToNextLevel` hace una transición
  **in-place (sin recargar la página)**: overlay translúcido "Cargando" sobre el frame congelado
  (render freezado) mientras `loadLevelDefinition` desmonta el nivel viejo y arma el nuevo.
  Teardown completo: `PhysicsWorld.reset()` (recrea el mundo Rapier → borra todos los bodies),
  `SceneManager.clearLevel()` (preserva las luces; remove-only para no romper la caché de assets),
  `clear()` de la cola larga (`WeaponEffects`/`GrenadeSystem`/`PositionalSoundManager`) + dispose
  de player/pickups. **Continuidad estilo `info_landmark`**: el jugador reaparece en
  `entryLandmark + offset` (offset relativo al `landmark` de salida) conservando loadout, vida y
  **yaw** — parece un mundo continuo. Sin `nextLevel` → fin de campaña (menú). En playtest no navega.
  Editable: "Nivel siguiente" + "Landmark de entrada" en config. del nivel, `landmark` en la acción
  `endLevel`; todo viaja por el codegen. **Pendiente:** sin pantalla de victoria al terminar la
  campaña; chaining solo a niveles del registro; landmarks sin rotación (mapas alineados al mismo eje).
- [x] **Sistema de objetivos** *(hecho)* — evento `objective.updated` (`{ text, completed?, marker? }`)
  + widget `ObjectiveHUD` (panel arriba-centro con el objetivo actual + brújula: un waypoint
  world-space que se proyecta a pantalla cada frame, clamped a los bordes cuando queda fuera de
  cuadro, con distancia en metros). Objetivo inicial por nivel (`LevelDefinition.objective`) y
  acción de trigger `objective` para actualizar/cumplir/mover el marcador. Editable: campo en
  config. del nivel + entidad lógica `objective` (input `Apply`); viaja por el codegen (`MapMeta`).

## Tier 2 — Profundidad de combate y contenido

- [ ] **Más enemigos** (data-driven vía `CharacterPresets` + `aiProfileId`): headcrab/fast
  zombie, manhack (drone aéreo), turret Combine, variedad Combine (shotgunner/elite).
  - [x] **Headcrab** *(hecho)* — criatura melee no-humanoide (modelo `headcrab.glb`). Para los
    no-humanoides se introdujo la interfaz `NpcAnimator` + un `CreatureAnimator` liviano (bob/tilt +
    muerte `tumble`/`drop`, lunge en ataque) que el `Npc` usa en lugar del bridge humanoide cuando
    `type !== 'humanoid'`. Preset `headcrabMelee`: veloz, rango melee corto, fragil.
  - [x] **Manhack** *(hecho)* — drone volador. Modo `flying` del `CharacterMotor` (ignora gravedad,
    steering 3D incluido Y, sin snap-to-ground) + `NpcLocomotion` directa sin NavSpace (beeline al
    threat + `hoverHeight`). Visual procedural `ManhackVisual` (cuchilla girada por el animador, sin
    GLB). Contacto melee reusando `NpcCombat`. **Gotcha:** el `eyeHeight` del flyer debe quedar fuera
    de su cápsula — el LOS de percepción es un raycast *solid* y un origen dentro del propio collider
    se auto-impacta (perdía `SeeEnemy` siempre). *Cosmético:* el trace recorder marca un falso-positivo
    "path vacío con threat" en flyers (no usan path).
  - [x] **Torreta de piso** *(hecho)* — sensor + ametralladora montada sobre un trípode físico,
    estilo HL2 `npc_turret_floor`. No navega ni decide táctica: corre sobre el runtime `Npc` con un
    `StationaryDynamicMotor` (rigid body dinámico que descansa, se empuja, se vuelca y lo agarra la
    gravity gun), un `TurretCombat` (apunta el cañón a 360°/s, dispara hitscan sólo alineada dentro de
    ~10°, supresión al último punto visto, deploy/retract auto-gestionados, *thrash* caótico al
    volcarse) y un `TurretAnimator` + visual procedural (`turret-barrel`/`turret-eye`/`turret-muzzle`).
    Condición nueva `Cond.Tipped` (up-vector del cuerpo). **Derrota = física** (vida altísima: las
    balas casi no la dañan; se neutraliza tumbándola). Preset `floorTurret`; `patrol[0]` define la
    dirección de montaje.
  - [x] **Variedad Combine: shotgunner + elite** *(hecho)* — dos variantes que reusan el esqueleto,
    las animaciones procedurales y el `aiProfileId: "combineSoldier"` del combine común (mismos
    schedules + percepción). El `combineShotgunner` cambia el AR3 por la escopeta con cadencia
    ajustada (rango ~14m, ráfagas de 2, pausa larga) y su propia pose de attachment; el `combineElite`
    es copia 1:1 del combine común (AR3, mismas stats), distinto sólo en el modelo (ojos rojos
    emisivos). Ambos con entrada propia en `RestPoseTuning` para que el idle calce con el combine.
  - [x] **Gunship mini boss** *(hecho)* — NPC Combine volador con `KinematicFlyerMotor`
    no agarrable por gravity gun mientras vive, visual procedural (`gunship-rotor` /
    `gunship-eye` / `gunship-muzzle`), `GunshipCannonCombat` hitscan con telegraph,
    ráfagas con stitching lateral y crash explosivo al morir vía `GrenadeSystem.detonate()`.
    Encuentro de prueba en `SnowFieldLevel`.
  - [x] **Strider full-size boss** *(hecho)* — NPC Combine trípode de escala completa,
    visual procedural, `StriderWalkerMotor` con foot planting/IK y colliders cinemáticos
    por extremidades, minigun con stitching, cañón cargado explosivo y stomp cercano.
    Muerte con colapso explosivo vía `GrenadeSystem.detonate()`. Mapa de prueba:
    `strider-test`.
  - [ ] **Pendiente:** audio propio de headcrab/manhack/torreta
    (faltan clips del artista — la torreta usa placeholders), VFX de muerte del manhack
    (chispa/explosión) y GLB del modelo de la torreta (hoy procedural).
- [x] **Peligros ambientales** *(hecho)*
  - **Daño por caída:** `CharacterController` captura la velocidad de impacto en el flanco
    aire→suelo (`consumeLandingImpact`); `Player` la mapea a daño vía `PlayerConfig.fallDamage`
    (`safeSpeed`/`fatalSpeed`/`fatalDamage`). Respeta godMode y dispara la secuencia de muerte HL.
  - **Barriles explosivos:** `ExplosiveBarrel` (`Damageable` dinámico) + `ExplosiveBarrelSystem`.
    Reusan `GrenadeSystem.detonate()` (extraído como primitiva de explosión genérica: daño radial
    con falloff + impulso + ruido + `weapon.hit`). Disparables, encadenan barril a barril
    (explosión diferida al `update` → cadena escalonada), y atribuyen el kill a quien los detonó.
  - **Kill-volumes:** `HazardVolumeSystem` (espeja `CheckpointSystem` pero continuo) — daño por
    segundo en ticks mientras el jugador está dentro, `instantKill` para `void`. Tipos
    tóxico/fuego/eléctrico/vacío. Emite `player.hazard`; `Game` lo aplica.
  - **Efectos visuales:** `VfxSystem` (engine, `render/effects/`) — pool de partículas GPU
    (`ParticleField`, shader propio) + luces de destello + onda expansiva. Primitiva genérica
    `explosion()` (bola de fuego + chispas balísticas + humo + flash) que reusan granadas y
    barriles vía `detonate()`, y emisores continuos `createEmitter()` para el ambiente de los
    kill-volumes (humo tóxico / llamas + brasas / arcos eléctricos). El efecto ambiente es
    **toggleable por volumen** (`HazardVolumeDefinition.showEffect`, default on; `void` nunca dibuja).
  - **Editor:** barril y kill-volume cableados de punta a punta (paleta "Peligros", inspector con
    toggle "Efecto visual", preview, codegen `to`/`from`/`toTypeScript`). *Pendiente para publicar
    por Workshop: ampliar el `validateDocument` del backend (repo hermano) a los campos nuevos.*
- [x] **VFX de sangre para NPCs orgánicos** *(hecho)* — daño con contexto espacial
  (`hitPoint`/dirección/body part), filtro por tipo de personaje (humanoides/criaturas sangran;
  robots/props no), `VfxSystem.bloodImpact()` con puff/gotas y decals oscuros proyectados en
  paredes/piso cercanos. Incluye throttling por NPC/frame y metadata física para excluir al NPC
  golpeado durante los raycasts.
- [x] **Encuentro con jefe: Strider full-size**: boss trípode inspirado en HL2, no mini.

## Tier 3 — Armas (arsenal clásico)

- [x] **.357 Magnum / revolver** *(hecho)* — sidearm de alto impacto con modelo
  propio, pickup, HUD/icono, munición `.357` separada y balance de daño/cadencia
  distinto de la pistola 9mm.
- [x] **Crossbow** *(hecho)* — arma monotiro de alto daño con `BoltSystem`
  balístico, recarga automática desde reserva y mira telescópica con overlay +
  FOV reducido. Incluye modelo, pickup, ammo de flechas y HUD/icono.
- [x] **RPG con cohete guiable** *(hecho)* — launcher + cohete GLB optimizados,
  misil único activo estilo HL2, punto láser siempre activo al equipar, guía suave
  hacia la mira, retardo de ignición, colisión continua y explosión radial
  reutilizando `GrenadeSystem.detonate()`. Incluye pickup de cohete como munición
  RPG y HUD/icono.
- [x] **Energy orb del AR3 / pulse rifle alt-fire** *(hecho)* — secundario del AR3
  con reserva `energyBall`, proyectil Combine que rebota/vaporiza enemigos y pickup
  de munición propio.
- [x] **Pickups de munición HL2-style** *(hecho)* — `AmmoDefinitions` +
  `AmmoInventory` global, pickups separados de armas para pistol/revolver/SMG/AR3/
  crossbow/shotgun/RPG/grenade/energyBall, compatibilidad con checkpoints/transición
  y soporte completo en niveles, loader, editor, codegen, paleta e inspector.
- [x] **Calibración visual de armas, viewmodels y munición** *(hecho)* —
  escalas/colliders runtime para worldmodels y ammo, poses de viewmodel ajustadas
  hacia una lectura tipo HL2, `weapon-scale-test` como mapa custom permanente de
  verificación y `WeaponsModule` extendido para copiar config de armas y ammo.

## Tier 4 — Lo que da "alma" (más caro)

- [x] **Setpieces guionados + compañera que sigue/escolta** *(hecho)* — sistema de **entity I/O
  estilo Source (HL2)** que reemplazó por completo al viejo `TriggerAction`: cada entidad tiene un
  `targetname`, emite *outputs* y recibe *inputs*, atados por `EntityConnection` (`output → target →
  input`, con `delay?` y `maxFires?`; fan-out por nombre compartido y outputs/refire por instancia).
  Nuevo módulo `src/game/script/`: `EntityIOSystem` (cola temporal estable, comodines, keywords
  `!self`/`!caller`/`!activator`/`!player`, cadenas relay-0 síncronas y lifecycle seguro para efectos
  asíncronos), entidades lógicas (`relay`/`auto`/`timer`/`counter`/`marker`/`message`/
  `objective`/`soundscape`/`npcSpawner`/`levelAction`/`changelevel`), `EntityEventBridge` (eventos
  del juego → outputs: `trigger.entered`/`exited`, `door.opened`, `npc.killed`/`damaged`) y
  `WorldEntityBinder`. **Scripted sequences** de NPC (`scripted_sequence`): mueven al NPC nombrado a
  un punto (walk/run/teleport), lo encaran y ejecutan pasos (gesto/espera/cue/decir/encarar) con
  outputs `OnBegin`/`OnArrived`/`OnEnd`/`OnCanceled`; corren sobre un `scripted` schedule (prioridad
  2000 ininterrumpible / 900 interrumpible). **Gestos procedurales** (`GestureLayer`: señalar/saludar/
  hablar + crouch). **Compañera** (Alyx) con follow/wait/escort como override del ancla (reusa los
  schedules follow/regroup): toggle con **E** (follow↔wait) y comandable por script
  (`StartFollowing`/`StopFollowing`/`EscortTo`), con `OnEscortArrived`. `ConditionMask` migrado a dos
  words (bits para el estado scripted). Editor completo: paleta de lógicas/secuencias, inspector de
  conexiones contextuales con parámetros tipados, validación del grafo, codegen y `migrateDocument`
  (documentos viejos de biblioteca/Workshop se migran al cargar). Campaña migrada al modelo nuevo;
  mapa de verificación
  `setpiece-test`. **Pendiente:** voces por línea/personaje (hoy subtítulo + clip placeholder);
  ampliar el `validateDocument` del backend de Workshop a `connections`/`logicEntities`/`sequences`.
- [ ] Vehículos (airboat/buggy). El ítem más caro; dejar para el final.

---

### Soporte transversal pendiente
- [ ] Checkpoints en el editor de niveles (`EditorDocument` + codegen + UI).
- [ ] Respawn para mapas de biblioteca/Workshop (requiere serializar el nivel o re-resolver por fuente).
