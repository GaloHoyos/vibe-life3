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
- [x] **Triggers con acción** *(hecho)* — `TriggerDefinition` ahora lleva `actions: TriggerAction[]`
  (union serializable: `dialogue` | `spawnNpcs` | `door` | `levelAction`), cada una con `delay?`
  opcional para dar ritmo tipo scripted sequence sin código. El `TriggerSystem` dispara al
  **entrar** al volumen (flanco, ya no cada frame), encola las acciones con delay y emite
  `trigger.action`; `Game.runTriggerAction` las ejecuta (spawn de NPCs, abrir/cerrar puertas vía
  `SlidingDoor.setOpen`, reusar `level.action`). La forma vieja `dialogue` queda como legacy y se
  normaliza (compat con mapas serializados de biblioteca/Workshop). Editado en el editor: lista de
  acciones por trigger en el inspector (el editor migra `dialogue`→`actions` al tocarlo).
  **Pendiente:** acción de fin de nivel se cubre con "Encadenar niveles" (abajo).
- [x] **Encadenar niveles** *(hecho — transición seamless estilo HL2)* — `LevelDefinition.nextLevel`
  + acción de trigger `endLevel`. Al cruzar la salida, `Game.goToNextLevel` hace una transición
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
  config. del nivel + acción en el inspector de triggers; viaja por el codegen (`MapMeta`).

## Tier 2 — Profundidad de combate y contenido

- [ ] **Más enemigos** (data-driven vía `CharacterPresets` + `aiProfileId`): headcrab/fast
  zombie, manhack (drone aéreo), turret Combine, variedad Combine (shotgunner/elite).
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
- [ ] **Encuentro con jefe** (gunship / mini-strider): preset de mucha vida + ataque ranged fuerte.

## Tier 3 — Armas (huecos del arsenal clásico)

- [ ] Crossbow (sniper silencioso, proyectil).
- [ ] .357 Magnum (pistola de alto impacto).
- [ ] RPG con cohete guiable (anti-vehículo/jefe).
- [ ] Energy orb del pulse rifle como alt-fire del AR3 (hoy sin secundario).

## Tier 4 — Lo que da "alma" (más caro)

- [ ] Setpieces guionados + compañera que sigue/escolta (Alyx ya dispara, falta follow/escort).
- [ ] Vehículos (airboat/buggy). El ítem más caro; dejar para el final.

---

### Soporte transversal pendiente
- [ ] Checkpoints en el editor de niveles (`EditorDocument` + codegen + UI).
- [ ] Respawn para mapas de biblioteca/Workshop (requiere serializar el nivel o re-resolver por fuente).
