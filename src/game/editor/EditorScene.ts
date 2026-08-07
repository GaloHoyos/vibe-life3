import {
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type Scene,
  Vector3,
} from 'three';
import { applyMaterialUvsToCylinder, createBoxMesh } from '@engine/render/PrimitiveFactory';
import { getMaterial } from '@engine/render/material/Materials';
import { createTerrainMesh } from '@engine/render/TerrainMesh';
import { generateHeightField } from '@shared/math/HeightField';
import { buildBuilding } from '@game/levels/builders/BuildingBuilder';
import { buildHouse } from '@game/levels/builders/HouseBuilder';
import { buildRamp } from '@game/levels/builders/RampBuilder';
import { quatFromEuler } from '@game/levels/builders/transform';
import type {
  DynamicBoxDefinition,
  PropDefinition,
  StaticBoxDefinition,
} from '@game/levels/LevelDefinition';
import type { VectorTuple } from '@shared/math/VectorTuple';
import type { EditorDocument, EditorEntity } from './EditorDocument';
import { buildProp } from './propRuntime';
import { VehiclePresets } from '@game/config/vehicles.config';
import { PropArchetypes } from '@game/config/props.config';
import { propBoundsForScale } from '@game/gameplay/props/propDamage';
import { PropSurfaceMaterials } from '@game/gameplay/props/propMaterials';
import type {
  PropAssetRegistry,
  PropModelLease,
} from '@game/assets/props/PropAssetRegistry';

/** Id sentinela del marcador de spawn del jugador (vive en `meta`, no en `entities`). */
export const PLAYER_START_EID = '__playerStart__';

/**
 * Renderiza el `EditorDocument` como objetos de Three.js para el viewport del
 * editor. Es un preview liviano: sin fisica ni IA. Mantiene un mapa eid->objeto
 * y un `WeakMap` objeto->eid para resolver el picking.
 */
export class EditorScene {
  private readonly objects = new Map<string, Object3D>();
  private readonly eidByObject = new WeakMap<Object3D, string>();
  private terrainMesh: Object3D | null = null;
  private playerMarker: Object3D | null = null;
  private readonly propLeases = new Map<string, PropModelLease>();

  constructor(
    private readonly scene: Scene,
    private readonly propAssets: PropAssetRegistry | null = null,
  ) {}

  mount(doc: EditorDocument): void {
    this.clear();
    for (const entity of doc.entities) {
      this.addEntity(entity);
    }
    this.rebuildTerrain(doc);
    this.rebuildPlayerStart(doc);
  }

  clear(): void {
    // Los leases primero: devuelven el refcount del pack y sacan el GLB del
    // grupo, así `disposeObject` no le toca la geometría compartida.
    for (const lease of this.propLeases.values()) lease.dispose();
    this.propLeases.clear();
    for (const obj of this.objects.values()) {
      this.scene.remove(obj);
      disposeObject(obj);
    }
    this.objects.clear();
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      disposeObject(this.terrainMesh);
      this.terrainMesh = null;
    }
    if (this.playerMarker) {
      this.scene.remove(this.playerMarker);
      disposeObject(this.playerMarker);
      this.playerMarker = null;
    }
  }

  addEntity(entity: EditorEntity): Object3D {
    const obj = this.build(entity);
    obj.visible = !entity.hidden;
    this.eidByObject.set(obj, entity.eid);
    this.objects.set(entity.eid, obj);
    this.scene.add(obj);
    return obj;
  }

  rebuildEntity(entity: EditorEntity): Object3D {
    this.removeEntity(entity.eid);
    return this.addEntity(entity);
  }

  removeEntity(eid: string): void {
    const obj = this.objects.get(eid);
    if (!obj) return;
    this.scene.remove(obj);
    disposeObject(obj);
    this.objects.delete(eid);
  }

  getObject(eid: string): Object3D | undefined {
    if (eid === PLAYER_START_EID) return this.playerMarker ?? undefined;
    return this.objects.get(eid);
  }

  setVisible(eid: string, visible: boolean): void {
    const obj = this.objects.get(eid);
    if (obj) obj.visible = visible;
  }

  /** Resuelve el eid a partir de un objeto pickeado (sube por el arbol). */
  resolveEid(object: Object3D): string | undefined {
    let cur: Object3D | null = object;
    while (cur) {
      const eid = this.eidByObject.get(cur);
      if (eid) return eid;
      cur = cur.parent;
    }
    return undefined;
  }

  rebuildTerrain(doc: EditorDocument): void {
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      disposeObject(this.terrainMesh);
      this.terrainMesh = null;
    }
    if (!doc.terrain) return;
    const t = doc.terrain;
    const field = generateHeightField({
      widthSamples: t.widthSamples,
      depthSamples: t.depthSamples,
      size: t.size,
      source: t.source,
    });
    const mesh = createTerrainMesh(field, {
      id: t.id,
      position: t.position,
      size: t.size,
      material: t.material,
    });
    this.terrainMesh = mesh;
    this.scene.add(mesh);
  }

  rebuildPlayerStart(doc: EditorDocument): void {
    if (this.playerMarker) {
      this.scene.remove(this.playerMarker);
      disposeObject(this.playerMarker);
    }
    const group = new Group();
    const [x, y, z] = doc.meta.playerStart;
    group.position.set(x, y, z);
    const body = new Mesh(
      new CapsuleGeometry(0.3, 1.0, 4, 8),
      new MeshStandardMaterial({
        color: 0x37d67a,
        transparent: true,
        opacity: 0.55,
        emissive: 0x0b5a2e,
        emissiveIntensity: 0.4,
      }),
    );
    group.add(body);
    const cone = new Mesh(
      new ConeGeometry(0.18, 0.5, 12),
      new MeshStandardMaterial({ color: 0x37d67a }),
    );
    cone.rotation.x = Math.PI / 2;
    cone.position.set(0, 0, -0.7);
    group.add(cone);
    this.eidByObject.set(group, PLAYER_START_EID);
    this.playerMarker = group;
    this.scene.add(group);
  }

  updatePlayerStart(position: Vector3): void {
    this.playerMarker?.position.copy(position);
  }

  dispose(): void {
    this.clear();
  }

  // ---------------------------------------------------------------------------

  private build(entity: EditorEntity): Object3D {
    switch (entity.kind) {
      case 'staticBox':
      case 'dynamicBox':
        return boxMesh(entity.def);
      case 'door': {
        const group = new Group();
        // Panel + boton se rotan como conjunto alrededor del pivote de la puerta
        // (no por caja, para no duplicar la rotacion del panel).
        group.add(
          createBoxMesh({
            id: entity.def.id,
            position: entity.def.position,
            size: entity.def.size,
            material: entity.def.material,
            castShadow: true,
            receiveShadow: true,
          }),
        );
        group.add(
          createBoxMesh({
            id: entity.def.button.id,
            position: entity.def.button.position,
            size: entity.def.button.size,
            material: 'button',
            castShadow: true,
          }),
        );
        rotateGroupAbout(group, entity.def.position, entity.def.rotation);
        return group;
      }
      case 'actionButton':
        return createBoxMesh({
          id: entity.def.id,
          position: entity.def.position,
          size: entity.def.size,
          material: 'button',
          rotation: entity.def.rotation,
          castShadow: true,
        });
      case 'trigger':
        return triggerMesh(entity.def.id, entity.def.position, entity.def.size, entity.def.rotation);
      case 'explosiveBarrel':
        return barrelMesh(entity.def.id, entity.def.position, entity.def.rotation);
      case 'hazardVolume':
        return triggerMesh(entity.def.id, entity.def.position, entity.def.size);
      case 'vehicle': {
        const preset = VehiclePresets[entity.def.presetId];
        return placeholder(entity.def.position, preset.body.size, 'metalRusted', entity.def.rotation);
      }
      case 'vehicleWaypoint':
        return placeholder(entity.def.position, [0.45, 0.45, 0.45], 'button');
      case 'waterVolume':
        return triggerMesh(entity.def.id, entity.def.position, entity.def.size);
      case 'vehicleNavArea':
        return groupFromPoints(entity.def.polygon, 'trim');
      case 'vehicleNavLane':
        return groupFromPoints(entity.def.points, 'button');
      case 'vehicleNavMarker':
        return placeholder(entity.def.position, [0.55, 0.75, 0.55], 'button', [0, entity.def.heading ?? 0, 0]);
      case 'checkpoint':
        return triggerMesh(entity.def.id, entity.def.position, entity.def.size);
      case 'npc':
        return placeholder(entity.def.position, [0.6, 1.7, 0.6], 'npc', entity.def.rotation);
      case 'weaponPickup':
        return placeholder(entity.def.position, [0.5, 0.3, 0.5], 'hazard', entity.def.rotation);
      case 'itemPickup':
        return placeholder(entity.def.position, [0.45, 0.45, 0.45], 'button', entity.def.rotation);
      case 'ammoPickup':
        return placeholder(entity.def.position, [0.42, 0.26, 0.34], 'trim', entity.def.rotation);
      case 'charger':
        return placeholder(entity.def.position, [0.8, 1.6, 0.4], 'trim', [0, entity.def.rotationY ?? 0, 0]);
      case 'building':
        return groupFromBoxes(buildBuilding(entity.spec).boxes);
      case 'house':
        return groupFromBoxes(buildHouse(entity.spec).boxes);
      case 'ramp':
        return groupFromBoxes(buildRamp(entity.spec));
      case 'prop': {
        const art = buildProp(entity.prop);
        return groupFromBoxes([...art.staticBoxes, ...art.dynamicBoxes]);
      }
      case 'propEntity':
        return this.propEntityPreview(entity.eid, entity.def);
      case 'prebuiltBuilding':
        return groupFromBoxes(entity.artifact.boxes);
      case 'sequence':
        return placeholder(entity.def.position, [0.5, 0.5, 0.5], 'button', entity.def.rotation);
      case 'logic':
        // Entidades lógicas sin cuerpo físico: cubo pequeño para verlas/moverlas.
        return placeholder(entity.position, [0.4, 0.4, 0.4], 'trim');
    }
  }

  /**
   * Caja del tamaño del prop, reemplazada por su GLB cuando el pack resuelve.
   * `build()` es síncrono y tiene que seguir siéndolo (el editor reconstruye la
   * escena en cada edición), así que el modelo llega después, como en
   * `GrenadeSystem`.
   */
  private propEntityPreview(eid: string, def: PropDefinition): Object3D {
    const archetype = PropArchetypes[def.archetypeId];
    const bounds = propBoundsForScale(archetype, def.scale);
    const group = placeholder(
      [def.position[0], def.position[1] + bounds[1] / 2, def.position[2]],
      bounds,
      PropSurfaceMaterials[archetype.surface],
      def.rotation,
    );
    if (!this.propAssets) return group;

    void this.propAssets.acquire(def.archetypeId, def.variant ?? 0).then((lease) => {
      // Entre el pedido y la respuesta el usuario pudo borrar o mover el prop.
      if (!lease.root || this.objects.get(eid) !== group) {
        lease.dispose();
        return;
      }
      this.releasePropLease(eid);
      group.clear();
      if (def.scale !== undefined && def.scale !== 1) lease.root.scale.setScalar(def.scale);
      group.add(lease.root);
      this.propLeases.set(eid, lease);
    });
    return group;
  }

  private releasePropLease(eid: string): void {
    const previous = this.propLeases.get(eid);
    if (!previous) return;
    previous.dispose();
    this.propLeases.delete(eid);
  }
}

function boxMesh(def: StaticBoxDefinition | DynamicBoxDefinition): Mesh {
  return createBoxMesh({
    id: def.id,
    position: def.position,
    size: def.size,
    material: def.material,
    rotation: def.rotation,
    castShadow: true,
    receiveShadow: true,
  });
}

function triggerMesh(id: string, position: VectorTuple, size: VectorTuple, rotation?: VectorTuple): Mesh {
  const mesh = createBoxMesh({ id, position, size, material: 'hazard', rotation });
  const mat = mesh.material;
  if (mat instanceof MeshStandardMaterial) {
    mat.transparent = true;
    mat.opacity = 0.22;
    mat.depthWrite = false;
  }
  return mesh;
}

function barrelMesh(id: string, position: VectorTuple, rotation?: VectorTuple): Mesh {
  const radius = 0.28;
  const height = 0.95;
  const geometry = applyMaterialUvsToCylinder(
    new CylinderGeometry(radius, radius, height, 16),
    'hazard',
  );
  const mesh = new Mesh(geometry, getMaterial('hazard'));
  mesh.name = id;
  mesh.position.set(position[0], position[1] + height / 2, position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = true;
  return mesh;
}

function placeholder(
  position: VectorTuple,
  size: VectorTuple,
  material: Parameters<typeof createBoxMesh>[0]['material'],
  rotation?: VectorTuple,
): Object3D {
  const group = new Group();
  group.position.set(position[0], position[1], position[2]);
  if (rotation) group.rotation.set(rotation[0], rotation[1], rotation[2]);
  group.add(
    createBoxMesh({
      id: 'placeholder',
      position: [0, size[1] / 2, 0],
      size,
      material,
      castShadow: true,
    }),
  );
  return group;
}

function groupFromBoxes(boxes: StaticBoxDefinition[]): Group {
  const group = new Group();
  for (const box of boxes) group.add(boxMesh(box));
  return group;
}

function groupFromPoints(
  points: readonly VectorTuple[],
  material: Parameters<typeof createBoxMesh>[0]['material'],
): Group {
  const group = new Group();
  points.forEach((point, index) => {
    group.add(createBoxMesh({
      id: `point-${index}`,
      position: point,
      size: [0.24, 0.24, 0.24],
      material,
      castShadow: false,
    }));
  });
  return group;
}

/** Rota un objeto (mesh o grupo con hijos absolutos) alrededor de un pivote mundial. */
function rotateGroupAbout(obj: Object3D, pivot: VectorTuple, rotation: VectorTuple | undefined): void {
  if (!rotation || (rotation[0] === 0 && rotation[1] === 0 && rotation[2] === 0)) return;
  const quat = quatFromEuler(rotation);
  const p = new Vector3(pivot[0], pivot[1], pivot[2]);
  obj.position.sub(p).applyQuaternion(quat).add(p);
  obj.quaternion.premultiply(quat);
}

function disposeObject(obj: Object3D): void {
  obj.traverse((child) => {
    if (child instanceof Mesh) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) {
        material.forEach((m) => m.dispose());
      } else {
        material.dispose();
      }
    }
  });
}
