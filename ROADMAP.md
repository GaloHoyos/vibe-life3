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
- [ ] **Triggers con acción** — hoy `TriggerSystem` solo dispara diálogo. Generalizar a
  acciones (spawnear NPCs, abrir puertas, fin de nivel, iniciar `ScriptedSequence`) para
  construir encuentros/ritmo.
- [ ] **Encadenar niveles** — `nextLevel?: LevelId` + trigger de salida → `startLevel(next)`
  sin pasar por el menú. Convierte "Nueva Partida" en una campaña real.
- [ ] **Sistema de objetivos** — HUD de objetivo actual + marcador/brújula. (`objective.updated`
  está documentado en CLAUDE.md pero no existe aún en `GameEvents`.)

## Tier 2 — Profundidad de combate y contenido

- [ ] **Más enemigos** (data-driven vía `CharacterPresets` + `aiProfileId`): headcrab/fast
  zombie, manhack (drone aéreo), turret Combine, variedad Combine (shotgunner/elite).
- [ ] **Peligros ambientales:** daño por caída (no existe), barriles explosivos, kill-volumes
  (tóxico/fuego/eléctrico/vacío).
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
