import type { MaterialKey } from '@engine/render/material/Materials';
import type { SkyboxId } from '@engine/render/environment/Skybox';
import type { SunOptions } from '@engine/render/environment/LightingSystem';
import type { VectorTuple } from '@shared/math/VectorTuple';
import type { BuildingArtifact } from '@game/levels/buildings/BuildingArtifact';
import type {
  ActionButtonDefinition,
  ChargerDefinition,
  DoorDefinition,
  DynamicBoxDefinition,
  ItemPickupDefinition,
  LevelAudioDefinition,
  LevelDefinition,
  NPCDefinition,
  StaticBoxDefinition,
  TerrainDefinition,
  TriggerDefinition,
  WeaponPickupDefinition,
} from '@game/levels/LevelDefinition';
import { buildBuilding, type BuildingSpec } from './BuildingBuilder';
import { buildHouse, type HouseSpec } from './HouseBuilder';
import { buildRamp, type RampSpec } from './RampBuilder';
import type { PropArtifact } from './PropBuilder';

export interface MapMeta {
  id: string;
  title: string;
  description?: string;
  background: number;
  skybox?: SkyboxId;
  sun?: SunOptions;
  playerStart: VectorTuple;
  audio: LevelAudioDefinition;
}

export interface GroundSpec {
  /** Tamano [ancho X, profundidad Z]. */
  size: [number, number];
  /** Centro XZ. Default [0, 0]. */
  center?: [number, number];
  /** Y de la superficie superior. Default 0. */
  y?: number;
  thickness?: number;
  material?: MaterialKey;
  /** Paredes perimetrales que delimitan el mapa. */
  boundary?: { height?: number; thickness?: number; material?: MaterialKey };
}

/**
 * Punto de entrada del toolkit de mapas: builder fluido que compone suelo,
 * terreno, estructuras (BuildingBuilder/HouseBuilder), props (PropBuilder),
 * NPCs, pickups, puertas y triggers, y emite un `LevelDefinition` validado.
 *
 * ```ts
 * export const MyLevel = createMap({ id: 'my-level', ... })
 *   .ground({ size: [80, 80], boundary: { height: 3 } })
 *   .structure({ id: 'house', center: [10, 0], ... })
 *   .prop(crateStack({ id: 'cover-1', at: [-5, 8], layers: 2 }))
 *   .npcInRoom('house', 0, [2, -1], { id: 'guard', characterId: 'combine' })
 *   .pickup({ id: 'wp-1', weaponId: 'pistol', position: [0, 0.5, 4] })
 *   .build();
 * ```
 *
 * Garantia central: todo lo que el builder coloca es navegable por NPCs —
 * las estructuras aportan rooms/doorways al NavSpace, los props se integran
 * como obstaculos/cover via el scan fisico, y `roomPoint()` posiciona
 * NPCs/items DENTRO de las habitaciones sin calcular coordenadas a mano.
 */
export function createMap(meta: MapMeta): MapBuilder {
  return new MapBuilder(meta);
}

export class MapBuilder {
  private readonly staticBoxList: StaticBoxDefinition[] = [];
  private readonly dynamicBoxList: DynamicBoxDefinition[] = [];
  private readonly buildingList: BuildingArtifact[] = [];
  private readonly doorList: DoorDefinition[] = [];
  private readonly actionButtonList: ActionButtonDefinition[] = [];
  private readonly npcList: NPCDefinition[] = [];
  private readonly pickupList: WeaponPickupDefinition[] = [];
  private readonly itemPickupList: ItemPickupDefinition[] = [];
  private readonly chargerList: ChargerDefinition[] = [];
  private readonly triggerList: TriggerDefinition[] = [];
  private terrainDef: TerrainDefinition | undefined;

  constructor(private readonly meta: MapMeta) {}

  /** Piso plano + paredes perimetrales opcionales. */
  ground(spec: GroundSpec): this {
    const [w, d] = spec.size;
    const [cx, cz] = spec.center ?? [0, 0];
    const y = spec.y ?? 0;
    const t = spec.thickness ?? 0.4;
    const material = spec.material ?? 'floor';
    this.staticBoxList.push({
      id: `${this.meta.id}-ground`,
      position: [cx, y - t / 2, cz],
      size: [w, t, d],
      material,
    });
    if (spec.boundary) {
      const bh = spec.boundary.height ?? 3;
      const bt = spec.boundary.thickness ?? 0.4;
      const bm = spec.boundary.material ?? 'wall';
      const by = y + bh / 2;
      this.staticBoxList.push(
        { id: `${this.meta.id}-bound-n`, position: [cx, by, cz - d / 2], size: [w, bh, bt], material: bm },
        { id: `${this.meta.id}-bound-s`, position: [cx, by, cz + d / 2], size: [w, bh, bt], material: bm },
        { id: `${this.meta.id}-bound-e`, position: [cx + w / 2, by, cz], size: [bt, bh, d], material: bm },
        { id: `${this.meta.id}-bound-w`, position: [cx - w / 2, by, cz], size: [bt, bh, d], material: bm },
      );
    }
    return this;
  }

  terrain(def: TerrainDefinition): this {
    this.terrainDef = def;
    return this;
  }

  /** Edificio multi-piso con rooms/escaleras/doorways (BuildingBuilder). */
  structure(spec: BuildingSpec): this {
    this.buildingList.push(buildBuilding(spec));
    return this;
  }

  /** Caja-edificio simple de un ambiente (HouseBuilder). */
  house(spec: HouseSpec): this {
    this.buildingList.push(buildHouse(spec));
    return this;
  }

  /** Artifact pre-construido (builder custom del nivel). */
  building(artifact: BuildingArtifact): this {
    this.buildingList.push(artifact);
    return this;
  }

  ramp(spec: RampSpec): this {
    this.staticBoxList.push(...buildRamp(spec));
    return this;
  }

  boxes(...defs: StaticBoxDefinition[]): this {
    this.staticBoxList.push(...defs);
    return this;
  }

  dynamicBoxes(...defs: DynamicBoxDefinition[]): this {
    this.dynamicBoxList.push(...defs);
    return this;
  }

  prop(...props: PropArtifact[]): this {
    for (const p of props) {
      this.staticBoxList.push(...p.staticBoxes);
      this.dynamicBoxList.push(...p.dynamicBoxes);
    }
    return this;
  }

  door(def: DoorDefinition): this {
    this.doorList.push(def);
    return this;
  }

  actionButton(def: ActionButtonDefinition): this {
    this.actionButtonList.push(def);
    return this;
  }

  npc(def: NPCDefinition): this {
    this.npcList.push(def);
    return this;
  }

  /** Spawnea un NPC dentro de un room, en coordenadas locales al centro del edificio. */
  npcInRoom(
    buildingId: string,
    story: number,
    local: [number, number],
    def: Omit<NPCDefinition, 'position'>,
  ): this {
    this.npcList.push({ ...def, position: this.roomPoint(buildingId, story, local, 0.3) });
    return this;
  }

  pickup(def: WeaponPickupDefinition): this {
    this.pickupList.push(def);
    return this;
  }

  /** Coloca un weapon pickup dentro de un room. */
  pickupInRoom(
    buildingId: string,
    story: number,
    local: [number, number],
    def: Omit<WeaponPickupDefinition, 'position'>,
  ): this {
    this.pickupList.push({ ...def, position: this.roomPoint(buildingId, story, local, 0.5) });
    return this;
  }

  /** Pickup de vitals (botiquín / batería HEV). */
  item(def: ItemPickupDefinition): this {
    this.itemPickupList.push(def);
    return this;
  }

  /** Coloca un pickup de vitals dentro de un room. */
  itemInRoom(
    buildingId: string,
    story: number,
    local: [number, number],
    def: Omit<ItemPickupDefinition, 'position'>,
  ): this {
    this.itemPickupList.push({ ...def, position: this.roomPoint(buildingId, story, local, 0.5) });
    return this;
  }

  /** Cargador de pared (vida / HEV) estilo HL2. */
  charger(def: ChargerDefinition): this {
    this.chargerList.push(def);
    return this;
  }

  /** Coloca un cargador de pared en un room, montado a altura útil. */
  chargerInRoom(
    buildingId: string,
    story: number,
    local: [number, number],
    def: Omit<ChargerDefinition, 'position'>,
  ): this {
    this.chargerList.push({ ...def, position: this.roomPoint(buildingId, story, local, 0.8) });
    return this;
  }

  trigger(def: TriggerDefinition): this {
    this.triggerList.push(def);
    return this;
  }

  /**
   * Punto world-space dentro de un room ya agregado. `local` es el offset XZ
   * desde el centro del room, clampeado a su AABB con 0.6 m de margen de
   * paredes (un NPC spawneado ahi siempre tiene clearance). `lift` se suma a
   * la Y del piso del room.
   */
  roomPoint(buildingId: string, story: number, local: [number, number], lift = 0.2): VectorTuple {
    const building = this.buildingList.find((b) => b.id === buildingId);
    if (!building) {
      throw new Error(`MapBuilder.roomPoint: edificio '${buildingId}' no agregado todavia.`);
    }
    const room =
      building.rooms.find((r) => r.label === `floor-${story}`) ?? building.rooms[story];
    if (!room) {
      throw new Error(`MapBuilder.roomPoint: '${buildingId}' no tiene room para story ${story}.`);
    }
    const margin = 0.6;
    const cx = (room.min[0] + room.max[0]) / 2;
    const cz = (room.min[2] + room.max[2]) / 2;
    const x = clamp(cx + local[0], room.min[0] + margin, room.max[0] - margin);
    const z = clamp(cz + local[1], room.min[2] + margin, room.max[2] - margin);
    return [x, room.min[1] + lift, z];
  }

  build(): LevelDefinition {
    this.validateUniqueIds();
    return {
      id: this.meta.id,
      title: this.meta.title,
      description: this.meta.description,
      background: this.meta.background,
      skybox: this.meta.skybox,
      sun: this.meta.sun,
      playerStart: this.meta.playerStart,
      audio: this.meta.audio,
      terrain: this.terrainDef,
      staticBoxes: this.staticBoxList,
      buildings: this.buildingList,
      dynamicBoxes: this.dynamicBoxList,
      doors: this.doorList,
      actionButtons: this.actionButtonList.length > 0 ? this.actionButtonList : undefined,
      npcs: this.npcList,
      weaponPickups: this.pickupList,
      itemPickups: this.itemPickupList.length > 0 ? this.itemPickupList : undefined,
      chargers: this.chargerList.length > 0 ? this.chargerList : undefined,
      triggers: this.triggerList,
    };
  }

  /** Ids duplicados rompen metadata de fisica y debug: fallar al armar el mapa, no en runtime. */
  private validateUniqueIds(): void {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    const check = (id: string) => {
      if (seen.has(id)) dupes.add(id);
      seen.add(id);
    };
    this.staticBoxList.forEach((b) => check(b.id));
    this.buildingList.forEach((b) => b.boxes.forEach((box) => check(box.id)));
    this.dynamicBoxList.forEach((b) => check(b.id));
    this.doorList.forEach((d) => {
      check(d.id);
      check(d.button.id);
    });
    this.actionButtonList.forEach((b) => check(b.id));
    this.npcList.forEach((n) => check(n.id));
    this.pickupList.forEach((p) => check(p.id));
    this.itemPickupList.forEach((p) => check(p.id));
    this.chargerList.forEach((c) => { check(c.id); check(`${c.id}-body`); });
    this.triggerList.forEach((t) => check(t.id));
    if (dupes.size > 0) {
      throw new Error(
        `MapBuilder('${this.meta.id}'): ids duplicados: ${[...dupes].join(', ')}`,
      );
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
