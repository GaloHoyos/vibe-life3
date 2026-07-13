import type { EditorDocument } from "@game/editor/EditorDocument";
import { isEditorDocument } from "@game/editor/persistence";
import { Soundscapes } from "@game/config/audio.config";
import {
  descriptorFor,
  type EntityClassId,
  type EntityInputDescriptor,
  type InputParamKind,
} from "@game/script/EntityCatalog";
import { BLOB_POSE_KINDS } from "@game/npc/blob/BlobControl";

export type SanitizeResult =
  | { ok: true; document: EditorDocument }
  | { ok: false; reason: string };

/** Tope de entidades antes de rechazar (evita colgar el browser al construir). */
const MAX_ENTITIES = 2000;
/** Tamano maximo del documento serializado, en caracteres (~bytes para ASCII). */
const MAX_SERIALIZED_LENGTH = 512 * 1024;
const MAX_STRING_LENGTH = 4000;
/** Presupuesto de nodos al recorrer el arbol; corta estructuras patologicas. */
const MAX_NODES = 200_000;

/**
 * Chequeo best-effort del lado del cliente: estructura minima + limites de
 * tamano/complejidad + numeros finitos. NO sustituye la validacion del
 * servidor (que es la autoridad); corre antes de publicar y tras descargar
 * como defensa en profundidad y para fallar rapido con un mensaje claro.
 */
export function sanitizeDocument(value: unknown): SanitizeResult {
  if (!isEditorDocument(value)) {
    return { ok: false, reason: "El documento no tiene la estructura esperada." };
  }
  if (value.entities.length > MAX_ENTITIES) {
    return {
      ok: false,
      reason: `Demasiadas entidades (${value.entities.length} > ${MAX_ENTITIES}).`,
    };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { ok: false, reason: "El documento no es serializable." };
  }
  if (serialized.length > MAX_SERIALIZED_LENGTH) {
    return { ok: false, reason: "El documento supera el tamano maximo permitido." };
  }

  const scan = scanValue(value);
  if (!scan.ok) return scan;

  const soundscapeScan = scanSoundscapeReferences(value);
  if (!soundscapeScan.ok) return soundscapeScan;

  const entityIoScan = scanEntityIO(value);
  if (!entityIoScan.ok) return entityIoScan;

  const blobContentScan = scanBlobContent(value);
  if (!blobContentScan.ok) return blobContentScan;

  return { ok: true, document: value };
}

type ValidationResult = { ok: true } | { ok: false; reason: string };

interface IOOwner {
  label: string;
  classId: EntityClassId;
  connections: unknown;
}

interface SequenceCandidate {
  label: string;
  def: Record<string, unknown>;
}

const LOGIC_KINDS = new Set([
  "relay",
  "auto",
  "timer",
  "counter",
  "marker",
  "message",
  "objective",
  "soundscape",
  "npcSpawner",
  "levelAction",
  "changelevel",
]);

const MOVE_MODES = new Set(["walk", "run", "teleport", "none"]);
const GESTURE_IDS = new Set(["point", "wave", "talk", "crouch"]);
const BLOB_POSES = new Set<string>(BLOB_POSE_KINDS);
const MAX_BLOB_POSES = 32;

/**
 * Valida el grafo I/O sin intentar sustituir el schema completo del backend.
 * Los documentos legacy siguen siendo válidos: sus `actions` se revisan por
 * separado y luego `migrateDocument` las convierte al modelo nuevo.
 */
function scanEntityIO(document: EditorDocument): ValidationResult {
  const targets = new Map<string, Set<EntityClassId>>();
  const owners: IOOwner[] = [];
  const sequences: SequenceCandidate[] = [];

  const addTarget = (name: string, classId: EntityClassId): void => {
    const classes = targets.get(name);
    if (classes) classes.add(classId);
    else targets.set(name, new Set([classId]));
  };

  for (let index = 0; index < document.entities.length; index += 1) {
    const rawEntity: unknown = document.entities[index];
    if (!isRecord(rawEntity)) {
      return invalid(`La entidad ${index} no tiene una estructura válida.`);
    }
    const kind = rawEntity.kind;
    if (kind !== "trigger" && kind !== "door" && kind !== "npc" && kind !== "logic" && kind !== "sequence") {
      continue;
    }
    if (!isRecord(rawEntity.def)) {
      return invalid(`La entidad I/O ${index} no tiene una definición válida.`);
    }

    const def = rawEntity.def;
    const label = entityLabel(def, index);
    if (kind === "logic") {
      if (!isLogicKind(def.kind)) {
        return invalid(`${label}: tipo de entidad lógica desconocido.`);
      }
      const shape = validateLogicShape(def, label);
      if (!shape.ok) return shape;
      const identity = ioIdentity(def, label, def.kind !== "auto");
      if (!identity.ok) return identity;
      addTarget(identity.name, def.kind);
      owners.push({ label, classId: def.kind, connections: def.connections });

      if (def.kind === "npcSpawner") {
        const npcs = def.npcs as unknown[];
        for (let npcIndex = 0; npcIndex < npcs.length; npcIndex += 1) {
          const npc = npcs[npcIndex];
          const npcLabel = `${label}, NPC ${npcIndex}`;
          if (!isRecord(npc)) return invalid(`${npcLabel}: definición inválida.`);
          const npcShape = validateNpcShape(npc, npcLabel);
          if (!npcShape.ok) return npcShape;
          const npcIdentity = ioIdentity(npc, npcLabel, false);
          if (!npcIdentity.ok) return npcIdentity;
          addTarget(npcIdentity.name, "npc");
          owners.push({ label: npcLabel, classId: "npc", connections: npc.connections });
        }
      }
      continue;
    }

    const identity = ioIdentity(def, label, kind === "sequence");
    if (!identity.ok) return identity;
    const classId: EntityClassId = kind;
    addTarget(identity.name, classId);
    owners.push({ label, classId, connections: def.connections });

    if (kind === "trigger") {
      if (typeof def.once !== "boolean") return invalid(`${label}: once debe ser booleano.`);
      if (def.wait !== undefined && (typeof def.wait !== "number" || def.wait < 0)) {
        return invalid(`${label}: wait debe ser mayor o igual a cero.`);
      }
      const disabled = optionalBoolean(def.startDisabled, `${label}: startDisabled`);
      if (!disabled.ok) return disabled;
    } else if (kind === "npc") {
      const npcShape = validateNpcShape(def, label);
      if (!npcShape.ok) return npcShape;
    } else if (kind === "sequence") {
      const sequenceShape = validateSequenceShape(def, label);
      if (!sequenceShape.ok) return sequenceShape;
      sequences.push({ label, def });
    }
  }

  for (const sequence of sequences) {
    const references = validateSequenceReferences(sequence, targets);
    if (!references.ok) return references;
  }

  for (const owner of owners) {
    const connections = validateConnections(owner, targets);
    if (!connections.ok) return connections;
  }

  return { ok: true };
}

function validateConnections(
  owner: IOOwner,
  targets: ReadonlyMap<string, ReadonlySet<EntityClassId>>,
): ValidationResult {
  if (owner.connections === undefined) return { ok: true };
  if (!Array.isArray(owner.connections)) {
    return invalid(`${owner.label}: connections debe ser una lista.`);
  }

  const sourceDescriptor = descriptorFor(owner.classId);
  if (!sourceDescriptor) return invalid(`${owner.label}: clase I/O desconocida.`);

  for (let index = 0; index < owner.connections.length; index += 1) {
    const rawConnection: unknown = owner.connections[index];
    const prefix = `${owner.label}, conexión ${index}`;
    if (!isRecord(rawConnection)) return invalid(`${prefix}: definición inválida.`);

    const { output, target, input, param, delay, maxFires } = rawConnection;
    if (typeof output !== "string" || !sourceDescriptor.outputs.some((candidate) => candidate.id === output)) {
      return invalid(`${prefix}: output "${String(output)}" no existe en ${owner.classId}.`);
    }
    if (typeof target !== "string" || target.length === 0) {
      return invalid(`${prefix}: targetname vacío o inválido.`);
    }
    if (typeof input !== "string" || input.length === 0) {
      return invalid(`${prefix}: input vacío o inválido.`);
    }
    if (delay !== undefined && (typeof delay !== "number" || delay < 0)) {
      return invalid(`${prefix}: delay debe ser un número mayor o igual a cero.`);
    }
    if (
      maxFires !== undefined &&
      (typeof maxFires !== "number" || !Number.isInteger(maxFires) || maxFires <= 0)
    ) {
      return invalid(`${prefix}: maxFires debe ser un entero positivo.`);
    }

    const targetClasses = resolveTargetClasses(target, owner.classId, targets);
    if (targetClasses === "missing") {
      return invalid(`${prefix}: target "${target}" no existe.`);
    }
    if (targetClasses === "unknownKeyword") {
      return invalid(`${prefix}: keyword de target "${target}" desconocida.`);
    }
    if (targetClasses === "dynamic") {
      if (param !== undefined && !isConnectionParam(param)) {
        return invalid(`${prefix}: parámetro inválido.`);
      }
      continue;
    }

    const inputDescriptors: EntityInputDescriptor[] = [];
    for (const classId of targetClasses) {
      const descriptor = descriptorFor(classId)?.inputs.find((candidate) => candidate.id === input);
      if (!descriptor) {
        return invalid(`${prefix}: input "${input}" no existe en el target de clase ${classId}.`);
      }
      inputDescriptors.push(descriptor);
    }

    const paramKinds = new Set<InputParamKind>(
      inputDescriptors.map((descriptor) => descriptor.param ?? "none"),
    );
    if (paramKinds.size !== 1) {
      return invalid(`${prefix}: el fan-out mezcla inputs con parámetros incompatibles.`);
    }
    const paramKind = paramKinds.values().next().value;
    if (paramKind === undefined) return invalid(`${prefix}: input sin descriptor de parámetro.`);
    const paramCheck = validateConnectionParam(param, paramKind, targets, prefix);
    if (!paramCheck.ok) return paramCheck;
  }

  return { ok: true };
}

function resolveTargetClasses(
  target: string,
  sourceClass: EntityClassId,
  targets: ReadonlyMap<string, ReadonlySet<EntityClassId>>,
): readonly EntityClassId[] | "dynamic" | "missing" | "unknownKeyword" {
  if (target === "!self" || target === "!caller") return [sourceClass];
  if (target === "!player") return ["player"];
  if (target === "!activator") return "dynamic";
  if (target.startsWith("!")) return "unknownKeyword";
  if (!target.includes("*") && !target.includes("?")) {
    const classes = targets.get(target);
    return classes ? [...classes] : "missing";
  }

  const classes = new Set<EntityClassId>();
  for (const [name, targetClasses] of targets) {
    if (!targetNameMatches(target, name)) continue;
    for (const classId of targetClasses) classes.add(classId);
  }
  return classes.size > 0 ? [...classes] : "missing";
}

function validateConnectionParam(
  param: unknown,
  kind: InputParamKind,
  targets: ReadonlyMap<string, ReadonlySet<EntityClassId>>,
  prefix: string,
): ValidationResult {
  if (param === undefined) return { ok: true };
  switch (kind) {
    case "none":
      return invalid(`${prefix}: el input no acepta parámetro.`);
    case "number":
      return typeof param === "number"
        ? { ok: true }
        : invalid(`${prefix}: el parámetro debe ser numérico.`);
    case "string":
      return typeof param === "string"
        ? { ok: true }
        : invalid(`${prefix}: el parámetro debe ser texto.`);
    case "targetName":
      if (typeof param !== "string" || param.length === 0) {
        return invalid(`${prefix}: el parámetro debe ser un targetname.`);
      }
      if (!targets.get(param)?.has("marker")) {
        return invalid(`${prefix}: el marker de parámetro "${param}" no existe.`);
      }
      return { ok: true };
  }
}

function validateLogicShape(def: Record<string, unknown>, label: string): ValidationResult {
  switch (def.kind) {
    case "relay":
      for (const [field, value] of [
        ["startDisabled", def.startDisabled],
        ["allowFastRetrigger", def.allowFastRetrigger],
        ["triggerOnce", def.triggerOnce],
      ] as const) {
        const check = optionalBoolean(value, `${label}: ${field}`);
        if (!check.ok) return check;
      }
      return { ok: true };
    case "auto":
      return { ok: true };
    case "timer": {
      if (typeof def.interval !== "number" || def.interval <= 0) {
        return invalid(`${label}: interval debe ser mayor a cero.`);
      }
      return optionalBoolean(def.startDisabled, `${label}: startDisabled`);
    }
    case "counter":
      if (typeof def.max !== "number" || def.max <= 0) {
        return invalid(`${label}: max debe ser mayor a cero.`);
      }
      if (def.startValue !== undefined && typeof def.startValue !== "number") {
        return invalid(`${label}: startValue debe ser numérico.`);
      }
      return { ok: true };
    case "marker":
      return validateVector(def.position, `${label}: position`);
    case "message":
      if (typeof def.text !== "string") return invalid(`${label}: text debe ser texto.`);
      if (typeof def.duration !== "number" || def.duration < 0) {
        return invalid(`${label}: duration debe ser mayor o igual a cero.`);
      }
      return optionalString(def.speaker, `${label}: speaker`);
    case "objective": {
      if (typeof def.text !== "string") return invalid(`${label}: text debe ser texto.`);
      const completed = optionalBoolean(def.completed, `${label}: completed`);
      if (!completed.ok) return completed;
      return def.marker === undefined
        ? { ok: true }
        : validateVector(def.marker, `${label}: marker`);
    }
    case "soundscape":
      return typeof def.soundscape === "string"
        ? { ok: true }
        : invalid(`${label}: soundscape inválido.`);
    case "npcSpawner":
      return Array.isArray(def.npcs)
        ? { ok: true }
        : invalid(`${label}: npcs debe ser una lista.`);
    case "levelAction":
      return typeof def.action === "string" && def.action.length > 0
        ? { ok: true }
        : invalid(`${label}: action inválida.`);
    case "changelevel":
      return def.landmark === undefined
        ? { ok: true }
        : validateVector(def.landmark, `${label}: landmark`);
    default:
      return invalid(`${label}: tipo de entidad lógica desconocido.`);
  }
}

function validateNpcShape(def: Record<string, unknown>, label: string): ValidationResult {
  if (typeof def.characterId !== "string" || def.characterId.length === 0) {
    return invalid(`${label}: characterId inválido.`);
  }
  return validateVector(def.position, `${label}: position`);
}

function scanBlobContent(document: EditorDocument): ValidationResult {
  const markerNames = new Set<string>();
  const npcsByName = new Map<string, Record<string, unknown>[]>();

  const addNpc = (npc: Record<string, unknown>, label: string): ValidationResult => {
    const poses = validateBlobPoses(npc, label);
    if (!poses.ok) return poses;
    const name = typeof npc.name === "string" && npc.name.length > 0 ? npc.name : npc.id;
    if (typeof name === "string" && name.length > 0) {
      const matches = npcsByName.get(name);
      if (matches) matches.push(npc);
      else npcsByName.set(name, [npc]);
    }
    return { ok: true };
  };

  for (let index = 0; index < document.entities.length; index += 1) {
    const entity = document.entities[index] as unknown;
    if (!isRecord(entity) || !isRecord(entity.def)) continue;
    const def = entity.def;
    const label = entityLabel(def, index);

    if (entity.kind === "logic" && def.kind === "marker") {
      if (typeof def.name === "string" && def.name.length > 0) markerNames.add(def.name);
      continue;
    }
    if (entity.kind === "staticBox") {
      const permeable = optionalBoolean(def.blobPermeable, `${label}: blobPermeable`);
      if (!permeable.ok) return permeable;
      continue;
    }
    if (entity.kind === "dynamicBox") {
      const consumable = validateBlobConsumable(def.blobConsumable, label);
      if (!consumable.ok) return consumable;
      continue;
    }
    if (entity.kind === "npc") {
      const result = addNpc(def, label);
      if (!result.ok) return result;
      continue;
    }
    if (entity.kind === "logic" && def.kind === "npcSpawner" && Array.isArray(def.npcs)) {
      for (let npcIndex = 0; npcIndex < def.npcs.length; npcIndex += 1) {
        const npc = def.npcs[npcIndex];
        if (!isRecord(npc)) continue; // scanEntityIO ya informa la forma inválida.
        const result = addNpc(npc, `${label}, NPC ${npcIndex}`);
        if (!result.ok) return result;
      }
    }
  }

  for (const [name, npcs] of npcsByName) {
    for (const npc of npcs) {
      const poses = Array.isArray(npc.blobPoses) ? npc.blobPoses : [];
      for (let poseIndex = 0; poseIndex < poses.length; poseIndex += 1) {
        const pose = poses[poseIndex];
        if (!isRecord(pose)) continue;
        for (const marker of [pose.marker, pose.targetMarker]) {
          if (marker === undefined) continue;
          if (typeof marker !== "string" || !markerNames.has(marker)) {
            return invalid(`NPC "${name}", pose ${poseIndex}: marker "${String(marker)}" no existe.`);
          }
        }
      }
    }
  }

  return validateBlobPoseConnections(document, npcsByName);
}

function validateBlobConsumable(value: unknown, label: string): ValidationResult {
  if (value === undefined) return { ok: true };
  if (!isRecord(value)) return invalid(`${label}: blobConsumable debe ser un objeto.`);
  if (
    value.consumeSeconds !== undefined &&
    (typeof value.consumeSeconds !== "number" || value.consumeSeconds < 0.1 || value.consumeSeconds > 30)
  ) {
    return invalid(`${label}: consumeSeconds debe estar entre 0.1 y 30.`);
  }
  if (
    value.biomass !== undefined &&
    (typeof value.biomass !== "number" || !Number.isInteger(value.biomass) || value.biomass < 1 || value.biomass > 58)
  ) {
    return invalid(`${label}: biomass debe ser un entero entre 1 y 58.`);
  }
  return { ok: true };
}

function validateBlobPoses(npc: Record<string, unknown>, label: string): ValidationResult {
  if (npc.blobPoses === undefined) return { ok: true };
  if (npc.characterId !== "blob") return invalid(`${label}: blobPoses sólo es válido para characterId "blob".`);
  if (!Array.isArray(npc.blobPoses)) return invalid(`${label}: blobPoses debe ser una lista.`);
  if (npc.blobPoses.length > MAX_BLOB_POSES) {
    return invalid(`${label}: demasiadas poses Blob (${npc.blobPoses.length} > ${MAX_BLOB_POSES}).`);
  }
  const ids = new Set<string>();
  for (let index = 0; index < npc.blobPoses.length; index += 1) {
    const pose = npc.blobPoses[index];
    const prefix = `${label}, pose Blob ${index}`;
    if (!isRecord(pose)) return invalid(`${prefix}: definición inválida.`);
    if (typeof pose.id !== "string" || pose.id.length === 0) return invalid(`${prefix}: id vacío o inválido.`);
    if (ids.has(pose.id)) return invalid(`${prefix}: id "${pose.id}" duplicado.`);
    ids.add(pose.id);
    if (typeof pose.kind !== "string" || !BLOB_POSES.has(pose.kind)) {
      return invalid(`${prefix}: forma "${String(pose.kind)}" desconocida.`);
    }
    if (typeof pose.marker !== "string" || pose.marker.length === 0) {
      return invalid(`${prefix}: marker debe ser un targetname.`);
    }
    if (
      blobPoseNeedsTarget(pose.kind) &&
      (typeof pose.targetMarker !== "string" || pose.targetMarker.length === 0)
    ) {
      return invalid(`${prefix}: ${pose.kind} requiere targetMarker.`);
    }
    if (
      pose.duration !== undefined &&
      (typeof pose.duration !== "number" || pose.duration < 0.05 || pose.duration > 30)
    ) {
      return invalid(`${prefix}: duration debe estar entre 0.05 y 30.`);
    }
    for (const field of ["radius", "height", "width", "depth", "length"] as const) {
      const value = pose[field];
      const max = field === "depth" ? 20 : 50;
      if (value !== undefined && (typeof value !== "number" || value <= 0 || value > max)) {
        return invalid(`${prefix}: ${field} debe ser mayor a cero y no superar ${max}.`);
      }
    }
    if (pose.direction !== undefined) {
      const direction = validateVector(pose.direction, `${prefix}: direction`);
      if (!direction.ok) return direction;
    }
  }
  return { ok: true };
}

function blobPoseNeedsTarget(kind: string): boolean {
  return kind === "tendril" || kind === "bridge" || kind === "wall";
}

function validateBlobPoseConnections(
  document: EditorDocument,
  npcsByName: ReadonlyMap<string, readonly Record<string, unknown>[]>,
): ValidationResult {
  for (let entityIndex = 0; entityIndex < document.entities.length; entityIndex += 1) {
    const entity = document.entities[entityIndex] as unknown;
    if (!isRecord(entity) || !isRecord(entity.def)) continue;
    const connections = entity.def.connections;
    if (!Array.isArray(connections)) continue;
    for (let connectionIndex = 0; connectionIndex < connections.length; connectionIndex += 1) {
      const connection = connections[connectionIndex];
      if (!isRecord(connection) || connection.input !== "SetBlobPose") continue;
      const prefix = `${entityLabel(entity.def, entityIndex)}, conexión ${connectionIndex}`;
      if (typeof connection.param !== "string" || connection.param.length === 0) {
        return invalid(`${prefix}: SetBlobPose requiere un id de pose.`);
      }
      if (typeof connection.target !== "string" || connection.target.startsWith("!")) continue;
      const targets: Record<string, unknown>[] = [];
      for (const [name, npcs] of npcsByName) {
        if (targetNameMatches(connection.target, name)) targets.push(...npcs);
      }
      for (const target of targets) {
        const poses = Array.isArray(target.blobPoses) ? target.blobPoses : [];
        if (!poses.some((pose) => isRecord(pose) && pose.id === connection.param)) {
          return invalid(`${prefix}: la pose Blob "${connection.param}" no existe en el target.`);
        }
      }
    }
  }
  return { ok: true };
}

function validateSequenceShape(def: Record<string, unknown>, label: string): ValidationResult {
  if (typeof def.targetNpc !== "string" || def.targetNpc.length === 0) {
    return invalid(`${label}: targetNpc vacío o inválido.`);
  }
  const position = validateVector(def.position, `${label}: position`);
  if (!position.ok) return position;
  if (def.rotation !== undefined) {
    const rotation = validateVector(def.rotation, `${label}: rotation`);
    if (!rotation.ok) return rotation;
  }
  if (typeof def.moveMode !== "string" || !MOVE_MODES.has(def.moveMode)) {
    return invalid(`${label}: moveMode desconocido.`);
  }
  const overrideAi = optionalBoolean(def.overrideAi, `${label}: overrideAi`);
  if (!overrideAi.ok) return overrideAi;
  const repeatable = optionalBoolean(def.repeatable, `${label}: repeatable`);
  if (!repeatable.ok) return repeatable;
  if (def.steps === undefined) return { ok: true };
  if (!Array.isArray(def.steps)) return invalid(`${label}: steps debe ser una lista.`);

  for (let index = 0; index < def.steps.length; index += 1) {
    const step: unknown = def.steps[index];
    const prefix = `${label}, paso ${index}`;
    if (!isRecord(step)) return invalid(`${prefix}: definición inválida.`);
    switch (step.kind) {
      case "gesture":
        if (typeof step.gesture !== "string" || !GESTURE_IDS.has(step.gesture)) {
          return invalid(`${prefix}: gesto desconocido.`);
        }
        if (step.duration !== undefined && (typeof step.duration !== "number" || step.duration < 0)) {
          return invalid(`${prefix}: duration debe ser mayor o igual a cero.`);
        }
        break;
      case "wait":
        if (typeof step.seconds !== "number" || step.seconds < 0) {
          return invalid(`${prefix}: seconds debe ser mayor o igual a cero.`);
        }
        break;
      case "waitForCue":
        break;
      case "say":
        if (typeof step.text !== "string") return invalid(`${prefix}: text debe ser texto.`);
        if (typeof step.duration !== "number" || step.duration < 0) {
          return invalid(`${prefix}: duration debe ser mayor o igual a cero.`);
        }
        {
          const speaker = optionalString(step.speaker, `${prefix}: speaker`);
          if (!speaker.ok) return speaker;
        }
        break;
      case "face":
        if (typeof step.target !== "string" || step.target.length === 0) {
          return invalid(`${prefix}: target vacío o inválido.`);
        }
        break;
      default:
        return invalid(`${prefix}: tipo de paso desconocido.`);
    }
  }
  return { ok: true };
}

function validateSequenceReferences(
  sequence: SequenceCandidate,
  targets: ReadonlyMap<string, ReadonlySet<EntityClassId>>,
): ValidationResult {
  const targetNpc = sequence.def.targetNpc as string;
  if (!targets.get(targetNpc)?.has("npc")) {
    return invalid(`${sequence.label}: targetNpc "${targetNpc}" no existe o no es un NPC.`);
  }

  if (!Array.isArray(sequence.def.steps)) return { ok: true };
  for (let index = 0; index < sequence.def.steps.length; index += 1) {
    const step = sequence.def.steps[index];
    if (!isRecord(step) || step.kind !== "face" || step.target === "!player") continue;
    if (typeof step.target !== "string" || !targets.get(step.target)?.has("marker")) {
      return invalid(`${sequence.label}, paso ${index}: marker "${String(step.target)}" no existe.`);
    }
  }
  return { ok: true };
}

function ioIdentity(
  def: Record<string, unknown>,
  label: string,
  requireName: boolean,
): { ok: true; name: string } | { ok: false; reason: string } {
  if (typeof def.id !== "string" || def.id.length === 0) {
    return invalid(`${label}: id vacío o inválido.`);
  }
  if (def.name !== undefined && typeof def.name !== "string") {
    return invalid(`${label}: name debe ser texto.`);
  }
  if (requireName && (typeof def.name !== "string" || def.name.length === 0)) {
    return invalid(`${label}: name/targetname es obligatorio.`);
  }
  const name = typeof def.name === "string" && def.name.length > 0 ? def.name : def.id;
  return { ok: true, name };
}

function entityLabel(def: Record<string, unknown>, index: number): string {
  return typeof def.id === "string" && def.id.length > 0
    ? `Entidad "${def.id}"`
    : `Entidad ${index}`;
}

function validateVector(value: unknown, label: string): ValidationResult {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((component) => typeof component === "number" && Number.isFinite(component))
  ) {
    return invalid(`${label} debe ser un vector de tres números finitos.`);
  }
  return { ok: true };
}

function optionalBoolean(value: unknown, label: string): ValidationResult {
  return value === undefined || typeof value === "boolean"
    ? { ok: true }
    : invalid(`${label} debe ser booleano.`);
}

function optionalString(value: unknown, label: string): ValidationResult {
  return value === undefined || typeof value === "string"
    ? { ok: true }
    : invalid(`${label} debe ser texto.`);
}

function isLogicKind(value: unknown): value is Exclude<EntityClassId, "player" | "trigger" | "door" | "npc" | "sequence"> {
  return typeof value === "string" && LOGIC_KINDS.has(value);
}

function isConnectionParam(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function targetNameMatches(pattern: string, name: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

function scanSoundscapeReferences(
  document: EditorDocument,
): { ok: true } | { ok: false; reason: string } {
  const audio = document.meta.audio as { soundscape?: unknown } | undefined;
  const levelSoundscape = audio?.soundscape;
  if (levelSoundscape !== undefined && !isKnownSoundscape(levelSoundscape)) {
    return { ok: false, reason: "El documento referencia un soundscape desconocido." };
  }

  for (const entity of document.entities) {
    if (!isRecord(entity) || !isRecord(entity.def)) continue;
    const def = entity.def;
    // Modelo nuevo: soundscape es una entidad lógica del entity I/O.
    if (entity.kind === "logic" && def.kind === "soundscape") {
      if (!isKnownSoundscape(def.soundscape)) {
        return { ok: false, reason: "El documento referencia un soundscape desconocido." };
      }
      continue;
    }
    // Compat: documentos sin migrar con la forma vieja de acciones de trigger.
    if (entity.kind !== "trigger" || !Array.isArray(def.actions)) {
      continue;
    }
    for (const rawAction of def.actions) {
      const action =
        rawAction !== null && typeof rawAction === "object"
          ? (rawAction as { kind?: unknown; soundscape?: unknown })
          : null;
      if (action?.kind === "soundscape" && !isKnownSoundscape(action.soundscape)) {
        return { ok: false, reason: "El documento referencia un soundscape desconocido." };
      }
    }
  }

  return { ok: true };
}

function isKnownSoundscape(value: unknown): boolean {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(Soundscapes, value);
}

function scanValue(root: unknown): { ok: true } | { ok: false; reason: string } {
  let nodes = 0;
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > MAX_NODES) {
      return { ok: false, reason: "El documento es demasiado complejo." };
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        return { ok: false, reason: "El documento contiene numeros invalidos." };
      }
    } else if (typeof current === "string") {
      if (current.length > MAX_STRING_LENGTH) {
        return { ok: false, reason: "El documento contiene texto demasiado largo." };
      }
    } else if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else if (current !== null && typeof current === "object") {
      for (const item of Object.values(current)) stack.push(item);
    }
  }
  return { ok: true };
}
