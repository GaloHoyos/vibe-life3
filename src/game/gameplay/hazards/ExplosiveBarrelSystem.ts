import type { Disposable } from "@shared/types/lifecycle";
import type { PropSystem } from "@game/gameplay/props/PropSystem";
import type { PropDefinition } from "@game/levels/LevelDefinition";
import type {
  ExplosiveBarrelSaveSnapshot,
  ExplosiveBarrelDefinition,
} from "./ExplosiveBarrel";

const DEFAULTS = { health: 25, damage: 90, radius: 4.5, impulse: 14 } as const;

export interface ExplosiveBarrelSystemSaveSnapshot {
  version: 1;
  barrels: ExplosiveBarrelSaveSnapshot[];
}

/**
 * Adaptador de guardado de los barriles explosivos.
 *
 * El barril dejó de ser un destructible propio: ahora es el arquetipo
 * `explosiveBarrel` del catálogo, con vida, casco cilíndrico de verdad y
 * fragmentos como cualquier otro prop. Lo único que sobrevive de la clase vieja
 * es este adaptador, porque borrar el id de guardado `system:explosive-barrels`
 * haría fallar el chequeo de campos requeridos de todas las partidas guardadas.
 */
export class ExplosiveBarrelSystem implements Disposable {
  private readonly barrelIds = new Set<string>();

  constructor(private readonly props: PropSystem) {}

  /** Traduce la definición vieja a un prop del catálogo. */
  static toPropDefinition(definition: ExplosiveBarrelDefinition): PropDefinition {
    return {
      id: definition.id,
      archetypeId: "explosiveBarrel",
      position: [...definition.position],
      ...(definition.rotation ? { rotation: [...definition.rotation] } : {}),
      health: definition.health ?? DEFAULTS.health,
      breakOverride: {
        kind: "explode",
        damage: definition.damage ?? DEFAULTS.damage,
        radius: definition.radius ?? DEFAULTS.radius,
        impulse: definition.impulse ?? DEFAULTS.impulse,
      },
    };
  }

  /** Lo llama el loader por cada barril convertido, para poder proyectarlo. */
  track(id: string): void {
    this.barrelIds.add(id);
  }

  captureSaveState(): ExplosiveBarrelSystemSaveSnapshot {
    return {
      version: 1,
      barrels: [...this.barrelIds]
        .sort((a, b) => a.localeCompare(b))
        .map((id): ExplosiveBarrelSaveSnapshot => {
          const prop = this.props.get(id);
          if (!prop) return { id, destroyed: true };
          const snapshot = prop.captureSaveState();
          return {
            id,
            destroyed: false,
            health: snapshot.health,
            alive: snapshot.alive,
            pendingExplosion: snapshot.pendingBreak,
            lastAttackerId: snapshot.lastAttackerId,
            body: snapshot.body,
          };
        }),
    };
  }

  /**
   * Aplica el formato v1 sobre los props migrados. Una partida vieja trae acá
   * el estado de sus barriles y lo recupera igual, aunque su `system:props`
   * todavía no los conociera.
   */
  restoreSaveState(snapshot: Readonly<ExplosiveBarrelSystemSaveSnapshot>): void {
    for (const entry of snapshot.barrels) {
      const prop = this.props.get(entry.id);
      if (entry.destroyed) {
        if (prop) this.props.remove(prop);
        continue;
      }
      if (!prop) continue;
      prop.restoreSaveState({
        id: entry.id,
        destroyed: false,
        health: entry.health,
        alive: entry.alive,
        pendingBreak: entry.pendingExplosion,
        lastAttackerId: entry.lastAttackerId,
        body: entry.body,
      });
    }
  }

  clear(): void {
    this.barrelIds.clear();
  }

  dispose(): void {
    this.clear();
  }
}
