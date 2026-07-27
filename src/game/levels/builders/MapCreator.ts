import type { MaterialKey } from '@engine/render/material/Materials';
import type { SkyboxId } from '@engine/render/environment/Skybox';
import type { SunOptions } from '@engine/render/environment/LightingSystem';
import type { VectorTuple } from '@shared/math/VectorTuple';
import type { BuildingArtifact } from '@game/levels/buildings/BuildingArtifact';
import type { LevelId } from '@game/levels/LevelRegistry';
import type {
  ActionButtonDefinition,
  AmmoPickupDefinition,
  ChargerDefinition,
  DoorDefinition,
  DynamicBoxDefinition,
  ItemPickupDefinition,
  LevelAudioDefinition,
  LevelDefinition,
  NPCDefinition,
  ObjectiveDefinition,
  StaticBoxDefinition,
  TerrainDefinition,
  TriggerDefinition,
  VehicleDefinition,
  VehicleNavAreaDefinition,
  VehicleNavLaneDefinition,
  VehicleNavMarkerDefinition,
  VehicleWaypointDefinition,
  WaterVolumeDefinition,
  WeaponPickupDefinition,
} from '@game/levels/LevelDefinition';
import type { HazardVolumeDefinition } from '@game/levels/HazardVolumeSystem';
import type { CheckpointDefinition } from '@game/levels/CheckpointSystem';
import type { ExplosiveBarrelDefinition } from '@game/gameplay/hazards/ExplosiveBarrel';
import type { PlayerModelId } from '@game/config/playermodel.config';
import type { LogicEntityDefinition } from '@game/script/EntityIOTypes';
import type { ScriptedSequenceDefinition } from '@game/script/ScriptedSequenceTypes';
import { buildBuilding, type BuildingSpec } from './BuildingBuilder';
import { buildHouse, type HouseSpec } from './HouseBuilder';
import { buildRamp, type RampSpec } from './RampBuilder';
import type { PropArtifact } from './PropBuilder';
import type { LandmarkReference } from '@game/levels/LevelTransition';

export interface MapMeta {
  id: string;
  title: string;
  description?: string;
  /** Nivel a encadenar vía trigger `endLevel`. Ver `LevelDefinition.nextLevel`. */
  nextLevel?: LevelId;
  /** Landmark de entrada para transiciones relativas. Ver `LevelDefinition.entryLandmark`. */
  entryLandmark?: LandmarkReference;
  /** Objetivo inicial que muestra el HUD al cargar. */
  objective?: ObjectiveDefinition;
  background: number;
  skybox?: SkyboxId;
  sun?: SunOptions;
  playerStart: VectorTuple;
  /** Playermodel del jugador. Ver `LevelDefinition.playerModel`. */
  playerModel?: PlayerModelId;
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
  private readonly ammoPickupList: AmmoPickupDefinition[] = [];
  private readonly chargerList: ChargerDefinition[] = [];
  private readonly triggerList: TriggerDefinition[] = [];
  private readonly logicList: LogicEntityDefinition[] = [];
  private readonly sequenceList: ScriptedSequenceDefinition[] = [];
  private readonly barrelList: ExplosiveBarrelDefinition[] = [];
  private readonly hazardList: HazardVolumeDefinition[] = [];
  private readonly checkpointList: CheckpointDefinition[] = [];
  private readonly vehicleList: VehicleDefinition[] = [];
  private readonly vehicleWaypointList: VehicleWaypointDefinition[] = [];
  private readonly waterVolumeList: WaterVolumeDefinition[] = [];
  private readonly vehicleNavAreaList: VehicleNavAreaDefinition[] = [];
  private readonly vehicleNavLaneList: VehicleNavLaneDefinition[] = [];
  private readonly vehicleNavMarkerList: VehicleNavMarkerDefinition[] = [];
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

  /** Pickup de munición separado de armas. */
  ammo(def: AmmoPickupDefinition): this {
    this.ammoPickupList.push(def);
    return this;
  }

  /** Coloca un pickup de munición dentro de un room. */
  ammoInRoom(
    buildingId: string,
    story: number,
    local: [number, number],
    def: Omit<AmmoPickupDefinition, 'position'>,
  ): this {
    this.ammoPickupList.push({ ...def, position: this.roomPoint(buildingId, story, local, 0.5) });
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

  /** Entidad lógica del entity I/O (relay, counter, timer, message, spawner, etc.). */
  logic(def: LogicEntityDefinition): this {
    this.logicList.push(def);
    return this;
  }

  /** Secuencia guionada de un NPC (scripted_sequence). */
  sequence(def: ScriptedSequenceDefinition): this {
    this.sequenceList.push(def);
    return this;
  }

  /** Barril explosivo (prop dañable que explota al morir). */
  explosiveBarrel(def: ExplosiveBarrelDefinition): this {
    this.barrelList.push(def);
    return this;
  }

  /** Volumen de peligro (kill-volume) que daña al jugador mientras está adentro. */
  hazardVolume(def: HazardVolumeDefinition): this {
    this.hazardList.push(def);
    return this;
  }

  /** Punto de control para respawn (captura vida/armadura/inventario al cruzarlo). */
  checkpoint(def: CheckpointDefinition): this {
    this.checkpointList.push(def);
    return this;
  }

  vehicle(def: VehicleDefinition): this {
    this.vehicleList.push(def);
    return this;
  }

  vehicleWaypoint(def: VehicleWaypointDefinition): this {
    this.vehicleWaypointList.push(def);
    return this;
  }

  waterVolume(def: WaterVolumeDefinition): this {
    this.waterVolumeList.push(def);
    return this;
  }

  vehicleNavArea(def: VehicleNavAreaDefinition): this {
    this.vehicleNavAreaList.push(def);
    return this;
  }

  vehicleNavLane(def: VehicleNavLaneDefinition): this {
    this.vehicleNavLaneList.push(def);
    return this;
  }

  vehicleNavMarker(def: VehicleNavMarkerDefinition): this {
    this.vehicleNavMarkerList.push(def);
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
    this.validateVehicleAuthoring();
    return {
      id: this.meta.id,
      title: this.meta.title,
      description: this.meta.description,
      nextLevel: this.meta.nextLevel,
      entryLandmark: this.meta.entryLandmark,
      objective: this.meta.objective,
      background: this.meta.background,
      skybox: this.meta.skybox,
      sun: this.meta.sun,
      playerStart: this.meta.playerStart,
      playerModel: this.meta.playerModel,
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
      ammoPickups: this.ammoPickupList.length > 0 ? this.ammoPickupList : undefined,
      chargers: this.chargerList.length > 0 ? this.chargerList : undefined,
      triggers: this.triggerList,
      logicEntities: this.logicList.length > 0 ? this.logicList : undefined,
      sequences: this.sequenceList.length > 0 ? this.sequenceList : undefined,
      explosiveBarrels: this.barrelList.length > 0 ? this.barrelList : undefined,
      hazardVolumes: this.hazardList.length > 0 ? this.hazardList : undefined,
      checkpoints: this.checkpointList.length > 0 ? this.checkpointList : undefined,
      vehicles: this.vehicleList.length > 0 ? this.vehicleList : undefined,
      vehicleWaypoints: this.vehicleWaypointList.length > 0 ? this.vehicleWaypointList : undefined,
      waterVolumes: this.waterVolumeList.length > 0 ? this.waterVolumeList : undefined,
      vehicleNavAreas: this.vehicleNavAreaList.length > 0 ? this.vehicleNavAreaList : undefined,
      vehicleNavLanes: this.vehicleNavLaneList.length > 0 ? this.vehicleNavLaneList : undefined,
      vehicleNavMarkers: this.vehicleNavMarkerList.length > 0 ? this.vehicleNavMarkerList : undefined,
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
    this.ammoPickupList.forEach((p) => check(p.id));
    this.chargerList.forEach((c) => { check(c.id); check(`${c.id}-body`); });
    this.triggerList.forEach((t) => check(t.id));
    this.logicList.forEach((l) => check(l.id));
    this.sequenceList.forEach((s) => check(s.id));
    this.barrelList.forEach((b) => check(b.id));
    this.hazardList.forEach((h) => check(h.id));
    this.checkpointList.forEach((c) => check(c.id));
    this.vehicleList.forEach((v) => check(v.id));
    this.vehicleWaypointList.forEach((w) => check(w.id));
    this.waterVolumeList.forEach((w) => check(w.id));
    this.vehicleNavAreaList.forEach((a) => check(a.id));
    this.vehicleNavLaneList.forEach((l) => check(l.id));
    this.vehicleNavMarkerList.forEach((m) => check(m.id));
    if (dupes.size > 0) {
      throw new Error(
        `MapBuilder('${this.meta.id}'): ids duplicados: ${[...dupes].join(', ')}`,
      );
    }
  }

  private validateVehicleAuthoring(): void {
    const waypoints = new Map(
      this.vehicleWaypointList.map((waypoint) => [waypoint.id, waypoint] as const),
    );
    for (const waypoint of waypoints.values()) {
      if (waypoint.next && !waypoints.has(waypoint.next)) {
        throw new Error(
          `MapBuilder('${this.meta.id}'): waypoint '${waypoint.id}' referencia next '${waypoint.next}' inexistente.`,
        );
      }
    }

    const validateRoute = (vehicleId: string, start: string, allowLoop: boolean): void => {
      const visited = new Set<string>();
      let current: string | undefined = start;
      while (current) {
        const waypoint = waypoints.get(current);
        if (!waypoint) {
          throw new Error(
            `MapBuilder('${this.meta.id}'): vehiculo '${vehicleId}' referencia waypoint '${current}' inexistente.`,
          );
        }
        if (visited.has(current)) {
          if (allowLoop) return;
          throw new Error(
            `MapBuilder('${this.meta.id}'): ruta de '${vehicleId}' contiene un ciclo sin pathLoop.`,
          );
        }
        visited.add(current);
        current = waypoint.next;
      }
    };

    for (const vehicle of this.vehicleList) {
      if (vehicle.presetId === 'helicopter' && !vehicle.pathStart) {
        throw new Error(
          `MapBuilder('${this.meta.id}'): helicoptero '${vehicle.id}' requiere pathStart.`,
        );
      }
      if (vehicle.pathStart) validateRoute(vehicle.id, vehicle.pathStart, vehicle.pathLoop === true);
      if (vehicle.crashPathStart) {
        validateRoute(vehicle.id, vehicle.crashPathStart, vehicle.pathLoop === true);
      }
    }

    for (const water of this.waterVolumeList) {
      if (water.size.some((component) => component <= 0)) {
        throw new Error(
          `MapBuilder('${this.meta.id}'): volumen de agua '${water.id}' requiere size positivo.`,
        );
      }
    }
    for (const area of this.vehicleNavAreaList) {
      if (area.polygon.length < 3) {
        throw new Error(
          `MapBuilder('${this.meta.id}'): area vehicular '${area.id}' requiere al menos 3 puntos.`,
        );
      }
    }
    for (const lane of this.vehicleNavLaneList) {
      if (lane.points.length < 2 || lane.width <= 0) {
        throw new Error(
          `MapBuilder('${this.meta.id}'): carril vehicular '${lane.id}' invalido.`,
        );
      }
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
