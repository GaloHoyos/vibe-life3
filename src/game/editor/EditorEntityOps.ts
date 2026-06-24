import { Euler, Quaternion } from 'three';
import type { VectorTuple } from '@shared/math/VectorTuple';
import { rotateArtifact } from '@game/levels/builders/transform';
import type { EditorEntity, PropEntitySpec } from './EditorDocument';

/**
 * Accesores de transform por tipo de entidad. Centralizan el mapeo entre el
 * "transform mundial" (que manipulan gizmo e inspector) y los campos reales de
 * cada def/spec — que difieren: una caja tiene `position`, un edificio tiene
 * `center`+`groundY`, un prop tiene `at`/`from`/`to`, etc.
 */

export function getPosition(entity: EditorEntity): VectorTuple {
  switch (entity.kind) {
    case 'staticBox':
    case 'dynamicBox':
    case 'door':
    case 'actionButton':
    case 'npc':
    case 'weaponPickup':
    case 'itemPickup':
    case 'charger':
    case 'trigger':
      return [...entity.def.position];
    case 'building':
      return [entity.spec.center[0], entity.spec.groundY, entity.spec.center[1]];
    case 'house':
      return [entity.spec.center[0], entity.spec.floorY, entity.spec.center[1]];
    case 'ramp':
      return [
        (entity.spec.start[0] + entity.spec.end[0]) / 2,
        entity.spec.startY,
        (entity.spec.start[1] + entity.spec.end[1]) / 2,
      ];
    case 'prop':
      return propPosition(entity.prop);
    case 'prebuiltBuilding': {
      const { min, max } = entity.artifact.envelope;
      return [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
    }
  }
}

/** Mueve la entidad a `position` (mundial), preservando su estructura interna. */
export function setPosition(entity: EditorEntity, position: VectorTuple): void {
  const cur = getPosition(entity);
  translateEntity(entity, position[0] - cur[0], position[1] - cur[1], position[2] - cur[2]);
}

export function translateEntity(entity: EditorEntity, dx: number, dy: number, dz: number): void {
  switch (entity.kind) {
    case 'door':
      entity.def.position = add3(entity.def.position, dx, dy, dz);
      entity.def.button.position = add3(entity.def.button.position, dx, dy, dz);
      return;
    case 'staticBox':
    case 'dynamicBox':
    case 'actionButton':
    case 'npc':
    case 'weaponPickup':
    case 'itemPickup':
    case 'charger':
    case 'trigger':
      entity.def.position = add3(entity.def.position, dx, dy, dz);
      return;
    case 'building':
      entity.spec.center = [entity.spec.center[0] + dx, entity.spec.center[1] + dz];
      entity.spec.groundY += dy;
      return;
    case 'house':
      entity.spec.center = [entity.spec.center[0] + dx, entity.spec.center[1] + dz];
      entity.spec.floorY += dy;
      return;
    case 'ramp':
      entity.spec.start = [entity.spec.start[0] + dx, entity.spec.start[1] + dz];
      entity.spec.end = [entity.spec.end[0] + dx, entity.spec.end[1] + dz];
      entity.spec.startY += dy;
      entity.spec.endY += dy;
      return;
    case 'prop':
      translateProp(entity.prop, dx, dy, dz);
      return;
    case 'prebuiltBuilding': {
      const a = entity.artifact;
      a.boxes = a.boxes.map((b) => ({ ...b, position: add3(b.position, dx, dy, dz) }));
      a.envelope = {
        min: add3(a.envelope.min, dx, dy, dz),
        max: add3(a.envelope.max, dx, dy, dz),
      };
      a.rooms = a.rooms.map((r) => ({
        ...r,
        min: add3(r.min, dx, dy, dz),
        max: add3(r.max, dx, dy, dz),
      }));
      a.doorways = a.doorways.map((d) => ({ ...d, position: add3(d.position, dx, dy, dz) }));
      return;
    }
  }
}

/** Tamano editable por gizmo/inspector (solo cajas/puertas/botones/triggers). */
export function getSize(entity: EditorEntity): VectorTuple | null {
  switch (entity.kind) {
    case 'staticBox':
    case 'dynamicBox':
    case 'door':
    case 'actionButton':
    case 'trigger':
      return [...entity.def.size];
    default:
      return null;
  }
}

export function setSize(entity: EditorEntity, size: VectorTuple): void {
  switch (entity.kind) {
    case 'staticBox':
    case 'dynamicBox':
    case 'door':
    case 'actionButton':
    case 'trigger':
      entity.def.size = [...size];
      return;
    default:
      return;
  }
}

export function getRotationY(entity: EditorEntity): number | null {
  return entity.kind === 'charger' ? entity.def.rotationY ?? 0 : null;
}

export function setRotationY(entity: EditorEntity, radians: number): void {
  if (entity.kind === 'charger') entity.def.rotationY = radians;
}

/** Rotacion Euler XYZ (radianes) de la entidad. `[0,0,0]` si no rota o no aplica. */
export function getRotation(entity: EditorEntity): VectorTuple {
  switch (entity.kind) {
    case 'staticBox':
    case 'dynamicBox':
    case 'door':
    case 'actionButton':
    case 'trigger':
    case 'npc':
    case 'weaponPickup':
    case 'itemPickup':
      return entity.def.rotation ? [...entity.def.rotation] : [0, 0, 0];
    case 'charger':
      return [0, entity.def.rotationY ?? 0, 0];
    case 'building':
    case 'house':
    case 'ramp':
      return entity.spec.rotation ? [...entity.spec.rotation] : [0, 0, 0];
    case 'prop':
      return entity.prop.spec.rotation ? [...entity.prop.spec.rotation] : [0, 0, 0];
    case 'prebuiltBuilding':
      // La rotacion se hornea en la geometria (no hay angulo almacenado).
      return [0, 0, 0];
  }
}

/** Setea la rotacion absoluta (para el inspector). El charger solo usa Y. */
export function setRotation(entity: EditorEntity, euler: VectorTuple): void {
  const value = isZeroRotation(euler) ? undefined : ([...euler] as VectorTuple);
  switch (entity.kind) {
    case 'staticBox':
    case 'dynamicBox':
    case 'door':
    case 'actionButton':
    case 'trigger':
    case 'npc':
    case 'weaponPickup':
    case 'itemPickup':
      entity.def.rotation = value;
      return;
    case 'charger':
      entity.def.rotationY = euler[1] || undefined;
      return;
    case 'building':
    case 'house':
    case 'ramp':
      entity.spec.rotation = value;
      return;
    case 'prop':
      entity.prop.spec.rotation = value;
      return;
    case 'prebuiltBuilding':
      return; // se rota destructivamente via `rotateEntity`
  }
}

/**
 * Aplica un delta de rotacion (cuaternion) alrededor del pivote de la entidad.
 * Para entidades con rotacion almacenada, compone y guarda el Euler resultante;
 * para el `prebuiltBuilding` (geometria horneada) rota el artifact en sitio.
 */
export function rotateEntity(entity: EditorEntity, delta: Quaternion): void {
  if (entity.kind === 'prebuiltBuilding') {
    const e = new Euler().setFromQuaternion(delta);
    Object.assign(entity.artifact, rotateArtifact(entity.artifact, getPosition(entity), [e.x, e.y, e.z]));
    return;
  }
  const current = getRotation(entity);
  const q = new Quaternion().setFromEuler(new Euler(current[0], current[1], current[2]));
  q.premultiply(delta);
  const e = new Euler().setFromQuaternion(q);
  setRotation(entity, [e.x, e.y, e.z]);
}

function isZeroRotation(euler: VectorTuple): boolean {
  return euler[0] === 0 && euler[1] === 0 && euler[2] === 0;
}

export function setLevelId(entity: EditorEntity, id: string): void {
  switch (entity.kind) {
    case 'prop':
      entity.prop.spec.id = id;
      return;
    case 'prebuiltBuilding':
      entity.artifact.id = id;
      return;
    case 'building':
    case 'house':
    case 'ramp':
      entity.spec.id = id;
      return;
    default:
      entity.def.id = id;
  }
}

/** Objeto editable de la entidad (def/spec/prop.spec/artifact) para el editor JSON crudo. */
export function editablePayload(entity: EditorEntity): object {
  switch (entity.kind) {
    case 'prop':
      return entity.prop.spec;
    case 'prebuiltBuilding':
      return entity.artifact;
    case 'building':
    case 'house':
    case 'ramp':
      return entity.spec;
    default:
      return entity.def;
  }
}

// ---------------------------------------------------------------------------

function propPosition(prop: PropEntitySpec): VectorTuple {
  switch (prop.prop) {
    case 'crate':
      return [...prop.spec.at];
    case 'crateStack':
      return [prop.spec.at[0], prop.spec.baseY ?? 0, prop.spec.at[1]];
    case 'sandbagLine':
      return [
        (prop.spec.from[0] + prop.spec.to[0]) / 2,
        prop.spec.y ?? 0,
        (prop.spec.from[1] + prop.spec.to[1]) / 2,
      ];
    case 'coverWall':
    case 'pillar':
    case 'cargoContainer':
      return [prop.spec.at[0], prop.spec.y ?? 0, prop.spec.at[1]];
    case 'watchtower':
      return [prop.spec.at[0], prop.spec.baseY ?? 0, prop.spec.at[1]];
  }
}

function translateProp(prop: PropEntitySpec, dx: number, dy: number, dz: number): void {
  switch (prop.prop) {
    case 'crate':
      prop.spec.at = add3(prop.spec.at, dx, dy, dz);
      return;
    case 'crateStack':
      prop.spec.at = [prop.spec.at[0] + dx, prop.spec.at[1] + dz];
      prop.spec.baseY = (prop.spec.baseY ?? 0) + dy;
      return;
    case 'sandbagLine':
      prop.spec.from = [prop.spec.from[0] + dx, prop.spec.from[1] + dz];
      prop.spec.to = [prop.spec.to[0] + dx, prop.spec.to[1] + dz];
      prop.spec.y = (prop.spec.y ?? 0) + dy;
      return;
    case 'coverWall':
    case 'pillar':
    case 'cargoContainer':
      prop.spec.at = [prop.spec.at[0] + dx, prop.spec.at[1] + dz];
      prop.spec.y = (prop.spec.y ?? 0) + dy;
      return;
    case 'watchtower':
      prop.spec.at = [prop.spec.at[0] + dx, prop.spec.at[1] + dz];
      prop.spec.baseY = (prop.spec.baseY ?? 0) + dy;
      return;
  }
}

function add3(v: VectorTuple, dx: number, dy: number, dz: number): VectorTuple {
  return [v[0] + dx, v[1] + dy, v[2] + dz];
}
