import type { Disposable } from '@shared/types/lifecycle';
import type { VectorTuple } from '@shared/math/VectorTuple';
import type { MaterialKey } from '@engine/render/material/Materials';
import type {
  BuildingDoor,
  BuildingRoof,
  BuildingSpec,
  BuildingStair,
  BuildingStorySpec,
  HouseSide,
} from '@game/levels/builders/BuildingBuilder';
import type { HouseSpec } from '@game/levels/builders/HouseBuilder';
import type { RampSpec } from '@game/levels/builders/RampBuilder';
import type { NPCDefinition, TriggerDefinition } from '@game/levels/LevelDefinition';
import {
  BLOB_POSE_KINDS,
  type BlobPoseDefinition,
  type BlobPoseKind,
} from '@game/npc/blob/BlobControl';
import type { EntityConnection, IOEntityFields, LogicEntityDefinition } from '@game/script/EntityIOTypes';
import type { ScriptedSequenceDefinition, SequenceStep } from '@game/script/ScriptedSequenceTypes';
import {
  descriptorFor,
  type EntityClassId,
  type EntityInputDescriptor,
  type InputParamKind,
} from '@game/script/EntityCatalog';
import type { GestureId } from '@engine/animation/AnimationInput';
import type { EditorDocument, EditorEntity, PropEntitySpec } from '../EditorDocument';
import { entityIoName, entityKindLabel, entityLevelId } from '../EditorDocument';
import {
  editablePayload,
  getPosition,
  getRotation,
  getRotationY,
  getSize,
  setLevelId,
  setPosition,
  setRotation,
  setRotationY,
  setSize,
} from '../EditorEntityOps';
import {
  AMMO_IDS,
  CHARACTER_IDS,
  CHARGER_KINDS,
  HAZARD_KINDS,
  ITEM_IDS,
  LEVEL_ACTIONS,
  MATERIAL_KEYS,
  SOUNDSCAPE_IDS,
  WEAPON_IDS,
} from '../editorOptions';
import {
  checkboxField,
  jsonField,
  numberField,
  selectField,
  textField,
  vec2Field,
  vec3Field,
  type Field,
} from './editorFields';
import { entityIcon, iconSpan } from './editorIcons';

const SIDES: readonly string[] = ['north', 'south', 'east', 'west'];
const ROOFS: readonly string[] = ['flat', 'walkable', 'gable', 'none'];
const AXES: readonly string[] = ['x', 'z'];
const NO_DOOR = '(sin puerta)';
const NO_WALL = '(ninguno)';

export interface InspectorCallbacks {
  getDocument(): EditorDocument;
  onEntityChanged(eid: string): void;
  onPlayerStartChanged(): void;
}

/**
 * Inspector de propiedades de la seleccion. Renderiza campos tipados por tipo
 * de entidad (mutan la def/spec en sitio y disparan el rebuild) mas un editor
 * JSON crudo como escape hatch para cualquier campo no cubierto por un form.
 */
export class InspectorView implements Disposable {
  readonly element = document.createElement('div');
  private readonly body = document.createElement('div');

  private mode: 'entity' | 'player' | null = null;
  private entity: EditorEntity | null = null;
  private posField: Field<[number, number, number]> | null = null;
  private sizeField: Field<[number, number, number]> | null = null;
  private rotField: Field<[number, number, number]> | null = null;

  /** Pisos con su `<details>` desplegado, para preservar el estado al re-render. */
  private readonly openStories = new Set<number>([0]);

  constructor(private readonly callbacks: InspectorCallbacks) {
    this.element.className = 'editor-panel editor-inspector';
    const title = document.createElement('h2');
    title.className = 'editor-panel__title';
    const titleText = document.createElement('span');
    titleText.textContent = 'Inspector';
    title.append(titleText);
    this.body.className = 'editor-panel__body';
    this.element.append(title, this.body);
    this.clear();
  }

  clear(): void {
    this.mode = null;
    this.entity = null;
    this.posField = null;
    this.sizeField = null;
    this.rotField = null;
    this.body.replaceChildren(empty('Nada seleccionado.'));
  }

  showPlayerStart(): void {
    this.mode = 'player';
    this.entity = null;
    this.sizeField = null;
    this.rotField = null;
    this.body.replaceChildren();
    this.body.append(header(iconSpan('person'), 'Spawn del jugador', 'playerStart'));
    const doc = this.callbacks.getDocument();
    this.posField = vec3Field('Posicion', doc.meta.playerStart, (v) => {
      doc.meta.playerStart = v;
      this.callbacks.onPlayerStartChanged();
    });
    this.body.append(this.posField.element);
  }

  showEntity(entity: EditorEntity): void {
    this.mode = 'entity';
    this.entity = entity;
    this.body.replaceChildren();
    this.body.append(header(entityIcon(entity.kind), entityKindLabel(entity.kind), entityLevelId(entity)));

    this.body.append(
      textField('Id', entityLevelId(entity), (v) => {
        if (v) setLevelId(entity, v);
        this.commit();
      }).element,
    );

    this.posField = vec3Field('Posicion', getPosition(entity), (v) => {
      setPosition(entity, v);
      this.commit();
    });
    this.body.append(this.posField.element);

    const size = getSize(entity);
    if (size) {
      this.sizeField = vec3Field('Tamano', size, (v) => {
        setSize(entity, v);
        this.commit();
      });
      this.body.append(this.sizeField.element);
    } else {
      this.sizeField = null;
    }

    // El charger usa su propio campo Y; el prebuilt rotea destructivamente (gizmo);
    // el kill-volume es un AABB sin rotación.
    if (
      entity.kind !== 'charger' &&
      entity.kind !== 'prebuiltBuilding' &&
      entity.kind !== 'hazardVolume'
    ) {
      this.rotField = vec3Field('Rotacion (°)', degTuple(getRotation(entity)), (v) => {
        setRotation(entity, [degToRad(v[0]), degToRad(v[1]), degToRad(v[2])]);
        this.commit();
      }, 5);
      this.body.append(this.rotField.element);
    } else {
      this.rotField = null;
    }

    this.appendKindFields(entity);

    const advanced = document.createElement('details');
    advanced.className = 'editor-advanced';
    const summary = document.createElement('summary');
    summary.textContent = 'Avanzado (JSON)';
    advanced.append(summary);
    advanced.append(
      jsonField('', editablePayload(entity), (parsed) => {
        if (parsed && typeof parsed === 'object') {
          Object.assign(editablePayload(entity), parsed);
          this.commit();
        }
      }).element,
    );
    this.body.append(advanced);
  }

  /** Refresca posicion/tamano mostrados (durante un arrastre del gizmo). */
  syncTransform(): void {
    if (this.mode === 'player') {
      this.posField?.set(this.callbacks.getDocument().meta.playerStart);
      return;
    }
    if (this.mode === 'entity' && this.entity) {
      this.posField?.set(getPosition(this.entity));
      const size = getSize(this.entity);
      if (size) this.sizeField?.set(size);
      if (this.rotField) this.rotField.set(degTuple(getRotation(this.entity)));
    }
  }

  dispose(): void {
    this.body.replaceChildren();
  }

  // ---------------------------------------------------------------------------

  private commit(): void {
    if (this.entity) this.callbacks.onEntityChanged(this.entity.eid);
  }

  /** Aplica el cambio y vuelve a dibujar el inspector (para cambios de estructura). */
  private commitAndRerender(): void {
    this.commit();
    if (this.entity) this.showEntity(this.entity);
  }

  private appendKindFields(entity: EditorEntity): void {
    switch (entity.kind) {
      case 'staticBox':
        this.append(selectField('Material', entity.def.material, MATERIAL_KEYS, (v) => {
          entity.def.material = v as typeof entity.def.material;
          this.commit();
        }));
        this.append(checkboxField('Permeable para Blob', entity.def.blobPermeable ?? false, (v) => {
          entity.def.blobPermeable = v || undefined;
          this.commit();
        }));
        return;
      case 'dynamicBox':
        this.append(selectField('Material', entity.def.material, MATERIAL_KEYS, (v) => {
          entity.def.material = v as typeof entity.def.material;
          this.commit();
        }));
        this.append(numberField('Masa (kg)', entity.def.mass, (v) => {
          entity.def.mass = v;
          this.commit();
        }, 1));
        this.append(checkboxField('Consumible por Blob', entity.def.blobConsumable !== undefined, (v) => {
          entity.def.blobConsumable = v ? (entity.def.blobConsumable ?? {}) : undefined;
          this.commitAndRerender();
        }));
        if (entity.def.blobConsumable) {
          this.append(numberField('Absorción (s)', entity.def.blobConsumable.consumeSeconds ?? 2, (v) => {
            entity.def.blobConsumable = { ...entity.def.blobConsumable, consumeSeconds: clamp(v, 0.1, 30) };
            this.commit();
          }, 0.1));
          this.append(numberField('Biomasa', entity.def.blobConsumable.biomass ?? 4, (v) => {
            entity.def.blobConsumable = { ...entity.def.blobConsumable, biomass: Math.round(clamp(v, 1, 58)) };
            this.commit();
          }, 1));
        }
        return;
      case 'door':
        this.append(selectField('Material', entity.def.material, MATERIAL_KEYS, (v) => {
          entity.def.material = v as typeof entity.def.material;
          this.commit();
        }));
        this.append(numberField('Velocidad', entity.def.speed, (v) => {
          entity.def.speed = v;
          this.commit();
        }, 0.1));
        this.append(vec3Field('Offset al abrir', entity.def.openOffset, (v) => {
          entity.def.openOffset = v;
          this.commit();
        }));
        this.append(textField('Boton: etiqueta', entity.def.button.label, (v) => {
          entity.def.button.label = v;
          this.commit();
        }));
        this.append(vec3Field('Boton: posicion', entity.def.button.position, (v) => {
          entity.def.button.position = v;
          this.commit();
        }));
        this.connectionsEditor(entity.def, 'door');
        return;
      case 'actionButton':
        this.append(textField('Etiqueta', entity.def.label, (v) => {
          entity.def.label = v;
          this.commit();
        }));
        this.append(selectField('Accion', entity.def.action, LEVEL_ACTIONS, (v) => {
          entity.def.action = v as typeof entity.def.action;
          this.commit();
        }));
        return;
      case 'npc':
        this.append(selectField('Personaje', entity.def.characterId, CHARACTER_IDS, (v) => {
          entity.def.characterId = v;
          if (v !== 'blob') entity.def.blobPoses = undefined;
          this.commitAndRerender();
        }));
        if (entity.def.characterId === 'blob') this.blobPoseList(entity.def);
        this.connectionsEditor(entity.def, 'npc');
        return;
      case 'weaponPickup':
        this.append(selectField('Arma', entity.def.weaponId, WEAPON_IDS, (v) => {
          entity.def.weaponId = v as typeof entity.def.weaponId;
          this.commit();
        }));
        return;
      case 'itemPickup':
        this.append(selectField('Item', entity.def.itemId, ITEM_IDS, (v) => {
          entity.def.itemId = v as typeof entity.def.itemId;
          this.commit();
        }));
        return;
      case 'ammoPickup':
        this.append(selectField('Municion', entity.def.ammoId, AMMO_IDS, (v) => {
          entity.def.ammoId = v as typeof entity.def.ammoId;
          this.commit();
        }));
        return;
      case 'charger': {
        this.append(selectField('Tipo', entity.def.kind, CHARGER_KINDS, (v) => {
          entity.def.kind = v as typeof entity.def.kind;
          this.commit();
        }));
        const rot = getRotationY(entity) ?? 0;
        this.append(numberField('Rotacion Y (rad)', rot, (v) => {
          setRotationY(entity, v);
          this.commit();
        }, 0.1));
        return;
      }
      case 'trigger':
        this.triggerFields(entity.def);
        return;
      case 'explosiveBarrel':
        this.append(numberField('Vida', entity.def.health ?? 25, (v) => {
          entity.def.health = v;
          this.commit();
        }, 1));
        this.append(numberField('Daño', entity.def.damage ?? 90, (v) => {
          entity.def.damage = v;
          this.commit();
        }, 1));
        this.append(numberField('Radio (m)', entity.def.radius ?? 4.5, (v) => {
          entity.def.radius = v;
          this.commit();
        }, 0.25));
        this.append(numberField('Impulso', entity.def.impulse ?? 14, (v) => {
          entity.def.impulse = v;
          this.commit();
        }, 1));
        return;
      case 'hazardVolume':
        this.append(selectField('Tipo', entity.def.kind, HAZARD_KINDS, (v) => {
          entity.def.kind = v as typeof entity.def.kind;
          this.commit();
        }));
        this.append(numberField('Daño/seg', entity.def.damagePerSecond, (v) => {
          entity.def.damagePerSecond = v;
          this.commit();
        }, 1));
        this.append(checkboxField('Muerte instantánea', entity.def.instantKill ?? false, (v) => {
          entity.def.instantKill = v || undefined;
          this.commit();
        }));
        this.append(checkboxField('Efecto visual', entity.def.showEffect ?? true, (v) => {
          // Default true: se guarda solo el opt-out explícito (JSON limpio).
          entity.def.showEffect = v ? undefined : false;
          this.commit();
        }));
        return;
      case 'building':
        this.buildingFields(entity.spec);
        return;
      case 'house':
        this.houseFields(entity.spec);
        return;
      case 'ramp':
        this.rampFields(entity.spec);
        return;
      case 'prop':
        this.propFields(entity.prop);
        return;
      case 'prebuiltBuilding':
        // Edificio importado: solo transform + JSON (no re-parametrizable).
        return;
      case 'logic':
        this.logicFields(entity.def);
        return;
      case 'sequence':
        this.sequenceFields(entity.def);
        return;
    }
  }

  private buildingFields(spec: BuildingSpec): void {
    this.append(numberField('Ancho', spec.width, (v) => { spec.width = v; this.commit(); }, 0.5));
    this.append(numberField('Profundidad', spec.depth, (v) => { spec.depth = v; this.commit(); }, 0.5));
    this.append(numberField('Alto de piso', spec.storyHeight, (v) => { spec.storyHeight = v; this.commit(); }, 0.25));
    this.append(numberField('Pisos', spec.stories.length, (v) => {
      const n = Math.max(1, Math.round(v));
      while (spec.stories.length < n) spec.stories.push({ windows: 'auto' });
      spec.stories.length = n;
      this.commitAndRerender();
    }, 1));
    this.append(selectField('Techo', spec.roof ?? 'flat', ROOFS, (v) => { spec.roof = v as BuildingRoof; this.commit(); }));
    this.append(checkboxField('Pilastras', spec.pilasters ?? spec.stories.length >= 2, (v) => { spec.pilasters = v; this.commit(); }));
    this.append(checkboxField('Losa de planta baja', spec.groundSlab ?? false, (v) => { spec.groundSlab = v; this.commit(); }));
    this.append(selectField('Mat. base', spec.palette?.base ?? 'concrete', MATERIAL_KEYS, (v) => { spec.palette = { ...spec.palette, base: v as MaterialKey }; this.commit(); }));
    this.append(selectField('Mat. trim', spec.palette?.trim ?? 'trim', MATERIAL_KEYS, (v) => { spec.palette = { ...spec.palette, trim: v as MaterialKey }; this.commit(); }));
    this.append(selectField('Mat. techo', spec.palette?.roof ?? 'roof', MATERIAL_KEYS, (v) => { spec.palette = { ...spec.palette, roof: v as MaterialKey }; this.commit(); }));
    this.append(selectField('Mat. piso', spec.palette?.floor ?? 'floor', MATERIAL_KEYS, (v) => { spec.palette = { ...spec.palette, floor: v as MaterialKey }; this.commit(); }));

    const stack = document.createElement('div');
    stack.className = 'editor-substack';
    stack.append(subheading('Pisos: puertas y escaleras'));
    spec.stories.forEach((story, i) => stack.append(this.storyEditor(spec, story, i)));
    this.body.append(stack);
  }

  private triggerFields(def: TriggerDefinition): void {
    this.append(checkboxField('Una sola vez', def.once, (v) => {
      def.once = v;
      if (v) def.wait = undefined;
      this.commitAndRerender();
    }));
    if (!def.once) {
      this.append(numberField('Espera entre activaciones (s)', def.wait ?? 0, (v) => {
        def.wait = v > 0 ? v : undefined;
        this.commit();
      }, 0.25));
    }
    this.append(checkboxField('Arranca deshabilitado', def.startDisabled ?? false, (v) => {
      def.startDisabled = v || undefined;
      this.commit();
    }));
    this.connectionsEditor(def, 'trigger');
  }

  private logicFields(def: LogicEntityDefinition): void {
    switch (def.kind) {
      case 'relay':
      case 'timer':
        if (def.kind === 'timer') {
          this.append(numberField('Intervalo (s)', def.interval, (v) => { def.interval = Math.max(0.1, v); this.commit(); }, 0.5));
        } else {
          this.append(checkboxField('Permitir retrigger rápido', def.allowFastRetrigger ?? false, (v) => {
            def.allowFastRetrigger = v || undefined;
            this.commit();
          }));
          this.append(checkboxField('Disparar una sola vez', def.triggerOnce ?? false, (v) => {
            def.triggerOnce = v || undefined;
            this.commit();
          }));
        }
        this.append(checkboxField('Arranca deshabilitado', def.startDisabled ?? false, (v) => { def.startDisabled = v || undefined; this.commit(); }));
        break;
      case 'counter':
        this.append(numberField('Máximo', def.max, (v) => { def.max = Math.max(1, Math.floor(v)); this.commit(); }, 1));
        break;
      case 'message':
        this.append(textField('Hablante', def.speaker ?? '', (v) => { def.speaker = v || undefined; this.commit(); }));
        this.append(textField('Texto', def.text, (v) => { def.text = v; this.commit(); }));
        this.append(numberField('Duración (s)', def.duration, (v) => { def.duration = v; this.commit(); }, 0.5));
        break;
      case 'objective':
        this.append(textField('Texto', def.text, (v) => { def.text = v; this.commit(); }));
        this.append(checkboxField('Cumplido', def.completed ?? false, (v) => { def.completed = v || undefined; this.commit(); }));
        this.append(checkboxField('Con marcador', def.marker !== undefined, (v) => { def.marker = v ? (def.marker ?? [0, 1.6, 0]) : undefined; this.commitAndRerender(); }));
        if (def.marker) this.append(vec3Field('Marcador', def.marker, (v) => { def.marker = v; this.commit(); }));
        break;
      case 'soundscape':
        this.append(selectField('Ambiente', def.soundscape, SOUNDSCAPE_IDS, (v) => { def.soundscape = v as typeof def.soundscape; this.commit(); }));
        break;
      case 'levelAction':
        this.append(selectField('Acción', def.action, LEVEL_ACTIONS, (v) => { def.action = v as typeof def.action; this.commit(); }));
        break;
      case 'changelevel':
        this.append(checkboxField('Con landmark', def.landmark !== undefined, (v) => { def.landmark = v ? (def.landmark ?? [0, 1, 0]) : undefined; this.commitAndRerender(); }));
        if (def.landmark) this.append(vec3Field('Landmark', def.landmark, (v) => { def.landmark = v; this.commit(); }));
        break;
      case 'npcSpawner':
        this.spawnerNpcList(def);
        break;
      case 'marker':
      case 'auto':
        break;
    }
    if (def.kind === 'marker') {
      this.ioNameField(def);
    } else {
      this.connectionsEditor(def, def.kind);
    }
  }

  private spawnerNpcList(def: Extract<LogicEntityDefinition, { kind: 'npcSpawner' }>): void {
    this.body.append(subheading('NPCs a spawnear'));
    def.npcs.forEach((npc, ni) => {
      const item = document.createElement('div');
      item.className = 'editor-subitem';
      item.append(
        subitemHeader(`NPC ${ni}`, () => { def.npcs.splice(ni, 1); this.commitAndRerender(); }),
        textField('Nombre I/O', npc.name ?? '', (v) => { npc.name = v || undefined; this.commitAndRerender(); }).element,
        selectField('Personaje', npc.characterId, CHARACTER_IDS, (v) => { npc.characterId = v; this.commit(); }).element,
        vec3Field('Posición', npc.position, (v) => { npc.position = v; this.commit(); }).element,
      );
      const matches = this.docIoTargets().filter((target) => target.name === (npc.name || npc.id));
      if (matches.length > 1) {
        item.append(connectionWarning(
          `Targetname compartido por ${matches.length} entidades: los inputs se envían a todas (fan-out).`,
        ));
      }
      this.body.append(item);
    });
    this.body.append(miniButton('+ NPC', () => {
      def.npcs.push({ id: `npc-${Date.now().toString(36)}`, characterId: CHARACTER_IDS[0], position: [0, 1, 0] });
      this.commitAndRerender();
    }));
  }

  private sequenceFields(def: ScriptedSequenceDefinition): void {
    this.append(selectField('NPC objetivo', def.targetNpc, this.docNpcNames(def.targetNpc), (v) => { def.targetNpc = v; this.commit(); }));
    this.append(selectField('Movimiento', def.moveMode, ['walk', 'run', 'teleport', 'none'], (v) => { def.moveMode = v as typeof def.moveMode; this.commit(); }));
    this.append(checkboxField('Ininterrumpible (override AI)', def.overrideAi ?? false, (v) => { def.overrideAi = v || undefined; this.commit(); }));
    this.append(checkboxField('Repetible', def.repeatable ?? false, (v) => { def.repeatable = v || undefined; this.commit(); }));
    this.sequenceStepsList(def);
    this.connectionsEditor(def, 'sequence');
  }

  private sequenceStepsList(def: ScriptedSequenceDefinition): void {
    this.body.append(subheading('Pasos de la secuencia'));
    const steps = (def.steps ??= []);
    steps.forEach((step, si) => {
      const item = document.createElement('div');
      item.className = 'editor-subitem';
      item.append(subitemHeader(`Paso ${si}`, () => { steps.splice(si, 1); this.commitAndRerender(); }));
      item.append(selectField('Tipo', step.kind, SEQUENCE_STEP_KINDS, (v) => {
        steps[si] = defaultSequenceStep(v as SequenceStep['kind']);
        this.commitAndRerender();
      }).element);
      appendSequenceStepFields(item, step, () => this.commit());
      this.body.append(item);
    });
    this.body.append(miniButton('+ Paso', () => {
      (def.steps ??= []).push({ kind: 'wait', seconds: 1 });
      this.commitAndRerender();
    }));
  }

  /**
   * Editor de conexiones de entity I/O (output→input). `sourceClass` alimenta el
   * dropdown de outputs; el target ofrece los nombres del documento + keywords.
   */
  private connectionsEditor(entity: IOEntityFields & { id: string }, sourceClass: EntityClassId): void {
    this.ioNameField(entity);
    this.body.append(subheading('Conexiones (output → input)'));
    const connections = (entity.connections ??= []);
    connections.forEach((conn, i) =>
      this.body.append(this.connectionEditor(connections, conn, i, sourceClass)),
    );
    this.body.append(
      miniButton('+ Conexion', () => {
        const output = descriptorFor(sourceClass)?.outputs[0]?.id ?? '';
        (entity.connections ??= []).push({ output, target: '', input: '' });
        this.commitAndRerender();
      }),
    );
  }

  private blobPoseList(def: NPCDefinition): void {
    this.body.append(subheading('Poses del Blob'));
    const poses = (def.blobPoses ??= []);
    poses.forEach((pose, poseIndex) => {
      const item = document.createElement('div');
      item.className = 'editor-subitem';
      item.append(
        subitemHeader(`Pose ${poseIndex}`, () => {
          poses.splice(poseIndex, 1);
          this.commitAndRerender();
        }),
        textField('ID', pose.id ?? '', (v) => {
          pose.id = v;
          this.commitAndRerender();
        }).element,
        selectField('Forma', pose.kind, BLOB_POSE_KINDS, (v) => {
          pose.kind = v as BlobPoseKind;
          this.commitAndRerender();
        }).element,
        numberField('Transición (s)', pose.duration ?? 0.8, (v) => {
          pose.duration = clamp(v, 0.05, 30);
          this.commit();
        }, 0.05).element,
        numberField('Radio', pose.radius ?? defaultBlobPoseDimension(pose.kind, 'radius'), (v) => {
          pose.radius = clamp(v, 0.1, 50);
          this.commit();
        }, 0.1).element,
        numberField('Alto', pose.height ?? defaultBlobPoseDimension(pose.kind, 'height'), (v) => {
          pose.height = clamp(v, 0.1, 50);
          this.commit();
        }, 0.1).element,
        numberField('Ancho', pose.width ?? defaultBlobPoseDimension(pose.kind, 'width'), (v) => {
          pose.width = clamp(v, 0.1, 50);
          this.commit();
        }, 0.1).element,
        numberField('Espesor', pose.depth ?? defaultBlobPoseDimension(pose.kind, 'depth'), (v) => {
          pose.depth = clamp(v, 0.05, 20);
          this.commit();
        }, 0.05).element,
      );
      item.append(selectField(
        'Marker origen',
        pose.marker ?? '',
        this.docParamTargetNames(pose.marker ?? ''),
        (v) => {
          pose.marker = v || undefined;
          this.commitAndRerender();
        },
      ).element);
      if (blobPoseNeedsTarget(pose.kind)) {
        item.append(selectField(
          'Marker destino',
          pose.targetMarker ?? '',
          this.docParamTargetNames(pose.targetMarker ?? ''),
          (v) => {
            pose.targetMarker = v || undefined;
            this.commitAndRerender();
          },
        ).element);
      }

      if (!pose.id) {
        item.append(connectionWarning('La pose necesita un ID.'));
      } else if (poses.some((candidate, index) => index !== poseIndex && candidate.id === pose.id)) {
        item.append(connectionWarning(`El ID de pose "${pose.id}" está duplicado.`));
      }
      if (!pose.marker) item.append(connectionWarning(`${pose.kind} requiere un marker de origen.`));
      else if (!this.docIoTargets().some((target) => target.classId === 'marker' && target.name === pose.marker)) {
        item.append(connectionWarning(`El marker "${pose.marker}" no existe.`));
      }
      if (blobPoseNeedsTarget(pose.kind) && !pose.targetMarker) {
        item.append(connectionWarning(`${pose.kind} requiere un marker de destino.`));
      } else if (
        pose.targetMarker &&
        !this.docIoTargets().some((target) => target.classId === 'marker' && target.name === pose.targetMarker)
      ) {
        item.append(connectionWarning(`El marker "${pose.targetMarker}" no existe.`));
      }
      this.body.append(item);
    });
    this.body.append(miniButton('+ Pose Blob', () => {
      poses.push({
        id: uniqueBlobPoseId(poses),
        kind: 'mound',
        duration: 0.8,
        marker: this.docParamTargetNames('')[0] || undefined,
      });
      this.commitAndRerender();
    }));
  }

  private ioNameField(entity: IOEntityFields & { id: string }): void {
    this.body.append(subheading('Nombre I/O (targetname)'));
    this.append(textField('Nombre', entity.name ?? '', (v) => {
      entity.name = v || undefined;
      this.commitAndRerender();
    }));

    const effectiveName = entity.name || entity.id;
    const matches = this.docIoTargets().filter((target) => target.name === effectiveName);
    if (matches.length > 1) {
      const warning = document.createElement('p');
      warning.className = 'editor-note editor-note--warning';
      warning.setAttribute('role', 'note');
      warning.textContent =
        `Targetname compartido por ${matches.length} entidades: los inputs se envían a todas (fan-out).`;
      this.body.append(warning);
    }
  }

  private connectionEditor(
    connections: EntityConnection[],
    conn: EntityConnection,
    i: number,
    sourceClass: EntityClassId,
  ): HTMLElement {
    const item = document.createElement('div');
    item.className = 'editor-subitem';
    const outputs = descriptorFor(sourceClass)?.outputs.map((o) => o.id) ?? [];
    const inputInfo = this.connectionInputInfo(conn.target, sourceClass, conn.input);
    item.append(
      subitemHeader(`Conexion ${i}`, () => {
        connections.splice(i, 1);
        this.commitAndRerender();
      }),
      selectField('Output', conn.output, withCurrent(outputs, conn.output), (v) => { conn.output = v; this.commit(); }).element,
      selectField('Target', conn.target, this.docTargetNames(conn.target), (v) => {
        conn.target = v;
        this.normalizeConnectionInput(conn, sourceClass);
        this.commitAndRerender();
      }).element,
      (inputInfo.knownTarget
        ? selectField('Input', conn.input, withCurrent(inputInfo.inputs.map((input) => input.id), conn.input), (v) => {
            conn.input = v;
            this.normalizeConnectionParam(conn, sourceClass);
            this.commitAndRerender();
          })
        : textField('Input', conn.input, (v) => { conn.input = v; this.commit(); })).element,
    );

    const paramField = this.connectionParamField(conn, sourceClass);
    if (paramField) item.append(paramField);

    item.append(
      numberField('Retardo (s)', conn.delay ?? 0, (v) => {
        conn.delay = v > 0 ? v : undefined;
        this.commit();
      }, 0.25).element,
      numberField('Max disparos (0 = ∞)', conn.maxFires ?? 0, (v) => {
        conn.maxFires = v > 0 ? Math.floor(v) : undefined;
        this.commit();
      }, 1).element,
    );

    if (inputInfo.knownTarget && !inputInfo.descriptor) {
      item.append(connectionWarning(`El input "${conn.input || '(vacio)'}" no existe en el target seleccionado.`));
    } else if (conn.target !== '' && !inputInfo.knownTarget && !isContextTarget(conn.target)) {
      item.append(connectionWarning(`El target "${conn.target}" no existe en este documento.`));
    } else if (
      inputInfo.descriptor?.param === 'targetName' &&
      conn.param !== undefined &&
      (typeof conn.param !== 'string' || !this.docIoTargets().some((target) =>
        target.name === conn.param && target.classId === 'marker'))
    ) {
      item.append(connectionWarning(`El marker "${String(conn.param)}" no existe en este documento.`));
    }
    return item;
  }

  /** Todos los targetnames del documento + keywords, con `current` garantizado presente. */
  private docTargetNames(current: string): string[] {
    const names = new Set(this.docIoTargets().map((target) => target.name));
    return withCurrent(['!player', '!activator', '!caller', '!self', ...[...names].sort()], current);
  }

  private docNpcNames(current: string): string[] {
    const names = new Set<string>();
    for (const entity of this.callbacks.getDocument().entities) {
      if (entity.kind === 'npc') names.add(entity.def.name ?? entity.def.id);
      if (entity.kind === 'logic' && entity.def.kind === 'npcSpawner') {
        for (const npc of entity.def.npcs) names.add(npc.name ?? npc.id);
      }
    }
    return withCurrent([...names].sort(), current);
  }

  private docParamTargetNames(current: string): string[] {
    const names = new Set(
      this.docIoTargets()
        .filter((target) => target.classId === 'marker')
        .map((target) => target.name),
    );
    return withCurrent([...names].sort(), current);
  }

  private docIoTargets(): DocumentIOTarget[] {
    const targets: DocumentIOTarget[] = [];
    for (const entity of this.callbacks.getDocument().entities) {
      const name = entityIoName(entity);
      const classId = entityIoClass(entity);
      if (name && classId) targets.push({ name, classId });

      if (entity.kind === 'logic' && entity.def.kind === 'npcSpawner') {
        for (const npc of entity.def.npcs) {
          targets.push({ name: npc.name || npc.id, classId: 'npc' });
        }
      }
    }
    return targets;
  }

  private targetClasses(target: string, sourceClass: EntityClassId): EntityClassId[] {
    if (target === '!self' || target === '!caller') return [sourceClass];
    if (target === '!player') return ['player'];
    if (isContextTarget(target)) return [];
    return [...new Set(
      this.docIoTargets()
        .filter((candidate) => targetNameMatches(target, candidate.name))
        .map((candidate) => candidate.classId),
    )];
  }

  private connectionInputInfo(
    target: string,
    sourceClass: EntityClassId,
    inputId: string,
  ): ConnectionInputInfo {
    const classes = this.targetClasses(target, sourceClass);
    if (classes.length === 0) return { knownTarget: false, inputs: [] };

    const descriptors = classes.map((classId) => descriptorFor(classId));
    const first = descriptors[0]?.inputs ?? [];
    const inputs = first.filter((input) => descriptors.every((descriptor) =>
      descriptor?.inputs.some((candidate) =>
        candidate.id === input.id && (candidate.param ?? 'none') === (input.param ?? 'none'),
      ),
    ));
    return {
      knownTarget: true,
      inputs,
      descriptor: inputs.find((input) => input.id === inputId),
    };
  }

  private normalizeConnectionInput(conn: EntityConnection, sourceClass: EntityClassId): void {
    const info = this.connectionInputInfo(conn.target, sourceClass, conn.input);
    if (info.knownTarget && !info.descriptor) conn.input = info.inputs[0]?.id ?? '';
    this.normalizeConnectionParam(conn, sourceClass);
  }

  private normalizeConnectionParam(conn: EntityConnection, sourceClass: EntityClassId): void {
    const descriptor = this.connectionInputInfo(conn.target, sourceClass, conn.input).descriptor;
    const paramKind = descriptor?.param ?? 'none';
    if (paramKind === 'none') {
      conn.param = undefined;
    } else if (paramKind === 'number' && typeof conn.param !== 'number') {
      conn.param = defaultNumberParam(conn.input);
    } else if (paramKind !== 'number' && typeof conn.param !== 'string') {
      conn.param = undefined;
    }
  }

  private connectionParamField(
    conn: EntityConnection,
    sourceClass: EntityClassId,
  ): HTMLElement | null {
    const info = this.connectionInputInfo(conn.target, sourceClass, conn.input);
    const paramKind: InputParamKind | null = info.descriptor?.param ?? (info.descriptor ? 'none' : null);
    switch (paramKind) {
      case 'none':
        return null;
      case 'number':
        return numberField('Parametro', typeof conn.param === 'number' ? conn.param : defaultNumberParam(conn.input), (v) => {
          conn.param = v;
          this.commit();
        }).element;
      case 'targetName': {
        const current = typeof conn.param === 'string' ? conn.param : '';
        return selectField('Parametro (targetname)', current, this.docParamTargetNames(current), (v) => {
          conn.param = v === '' ? undefined : v;
          this.commit();
        }).element;
      }
      case 'string':
        if (conn.input === 'SetBlobPose') {
          const current = typeof conn.param === 'string' ? conn.param : '';
          return selectField('Pose del Blob', current, this.docBlobPoseIds(conn.target, current), (v) => {
            conn.param = v === '' ? undefined : v;
            this.commit();
          }).element;
        }
        return textField('Parametro', typeof conn.param === 'string' ? conn.param : '', (v) => {
          conn.param = v === '' ? undefined : v;
          this.commit();
        }).element;
      case null:
        return textField('Parametro', conn.param === undefined ? '' : String(conn.param), (v) => {
          conn.param = v === '' ? undefined : v;
          this.commit();
        }).element;
    }
  }

  private docBlobPoseIds(target: string, current: string): string[] {
    const ids = new Set<string>();
    const addNpc = (name: string, npc: NPCDefinition): void => {
      const matches = target === '!self' || target === '!caller'
        ? this.entity?.kind === 'npc' && this.entity.def === npc
        : targetNameMatches(target, name);
      if (!matches) return;
      for (const pose of npc.blobPoses ?? []) if (pose.id) ids.add(pose.id);
    };
    for (const entity of this.callbacks.getDocument().entities) {
      if (entity.kind === 'npc') addNpc(entity.def.name ?? entity.def.id, entity.def);
      if (entity.kind === 'logic' && entity.def.kind === 'npcSpawner') {
        for (const npc of entity.def.npcs) addNpc(npc.name ?? npc.id, npc);
      }
    }
    return withCurrent([...ids].filter(Boolean).sort(), current);
  }

  private storyEditor(spec: BuildingSpec, story: BuildingStorySpec, index: number): HTMLElement {
    const details = document.createElement('details');
    details.className = 'editor-substory';
    details.open = this.openStories.has(index);
    details.addEventListener('toggle', () => {
      if (details.open) this.openStories.add(index);
      else this.openStories.delete(index);
    });
    const summary = document.createElement('summary');
    summary.textContent = `Piso ${index}`;
    details.append(summary);

    const windowsMode = Array.isArray(story.windows) ? 'manual' : story.windows ?? 'auto';
    const windowOptions = Array.isArray(story.windows) ? ['manual', 'auto', 'none'] : ['auto', 'none'];
    details.append(
      selectField('Ventanas', windowsMode, windowOptions, (v) => {
        if (v === 'manual') return; // 'manual' = array a mano: no se sintetiza desde aca.
        story.windows = v as 'auto' | 'none';
        this.commit();
      }).element,
    );

    const doors = story.doors ?? [];
    doors.forEach((door, di) => details.append(this.doorEditor(story, door, di)));
    details.append(
      miniButton('+ Puerta', () => {
        (story.doors ??= []).push({ side: 'south', offset: 0, width: 1.4 });
        this.openStories.add(index);
        this.commitAndRerender();
      }),
    );

    if (index === spec.stories.length - 1) {
      const note = document.createElement('p');
      note.className = 'editor-note';
      note.textContent = 'El ultimo piso es el techo: no lleva escalera.';
      details.append(note);
    } else {
      details.append(
        checkboxField('Escalera', story.stair !== undefined, (on) => {
          story.stair = on ? defaultStair(spec) : undefined;
          this.openStories.add(index);
          this.commitAndRerender();
        }).element,
      );
      if (story.stair) details.append(this.stairEditor(story.stair));
    }

    return details;
  }

  private doorEditor(story: BuildingStorySpec, door: BuildingDoor, di: number): HTMLElement {
    const item = document.createElement('div');
    item.className = 'editor-subitem';
    item.append(
      subitemHeader(`Puerta ${di}`, () => {
        story.doors?.splice(di, 1);
        this.commitAndRerender();
      }),
      selectField('Lado', door.side, SIDES, (v) => { door.side = v as HouseSide; this.commit(); }).element,
      numberField('Offset', door.offset ?? 0, (v) => { door.offset = v; this.commit(); }, 0.25).element,
      numberField('Ancho', door.width, (v) => { door.width = v; this.commit(); }, 0.1).element,
      numberField('Alto', door.height ?? 2.2, (v) => { door.height = v; this.commit(); }, 0.1).element,
    );
    return item;
  }

  private stairEditor(stair: BuildingStair): HTMLElement {
    const item = document.createElement('div');
    item.className = 'editor-subitem';
    const fp = stair.footprint;
    const setFootprint = (axis: 'x' | 'z', center: number, size: number): void => {
      const half = Math.max(0.25, size) / 2;
      stair.footprint[axis] = [center - half, center + half];
      this.commit();
    };
    item.append(
      numberField('Centro X', (fp.x[0] + fp.x[1]) / 2, (v) => {
        setFootprint('x', v, Math.abs(stair.footprint.x[1] - stair.footprint.x[0]));
      }, 0.25).element,
      numberField('Largo X', Math.abs(fp.x[1] - fp.x[0]), (v) => {
        setFootprint('x', (stair.footprint.x[0] + stair.footprint.x[1]) / 2, v);
      }, 0.25).element,
      numberField('Centro Z', (fp.z[0] + fp.z[1]) / 2, (v) => {
        setFootprint('z', v, Math.abs(stair.footprint.z[1] - stair.footprint.z[0]));
      }, 0.25).element,
      numberField('Largo Z', Math.abs(fp.z[1] - fp.z[0]), (v) => {
        setFootprint('z', (stair.footprint.z[0] + stair.footprint.z[1]) / 2, v);
      }, 0.25).element,
      selectField('Sube hacia', stair.topAt, SIDES, (v) => { stair.topAt = v as HouseSide; this.commit(); }).element,
      numberField('Escalones', stair.steps ?? 0, (v) => {
        const n = Math.round(v);
        stair.steps = n > 0 ? n : undefined;
        this.commit();
      }, 1).element,
    );
    return item;
  }

  private houseFields(spec: HouseSpec): void {
    this.append(numberField('Ancho', spec.width, (v) => { spec.width = v; this.commit(); }, 0.5));
    this.append(numberField('Profundidad', spec.depth, (v) => { spec.depth = v; this.commit(); }, 0.5));
    this.append(numberField('Alto', spec.height, (v) => { spec.height = v; this.commit(); }, 0.25));
    this.append(checkboxField('Techo a dos aguas', spec.roof ?? true, (v) => { spec.roof = v; this.commit(); }));
    this.append(checkboxField('Losa de planta baja', spec.groundSlab ?? false, (v) => { spec.groundSlab = v; this.commit(); }));
    this.append(selectField('Puerta lado', spec.door?.side ?? NO_DOOR, [NO_DOOR, ...SIDES], (v) => {
      spec.door = v === NO_DOOR ? undefined : { side: v as HouseSide, width: spec.door?.width ?? 1.4 };
      this.commit();
    }));
    if (spec.door) {
      this.append(numberField('Puerta ancho', spec.door.width, (v) => { if (spec.door) spec.door.width = v; this.commit(); }, 0.1));
    }
    this.append(selectField('Pared abierta', spec.removeWall ?? NO_WALL, [NO_WALL, ...SIDES], (v) => {
      spec.removeWall = v === NO_WALL ? undefined : (v as HouseSide);
      this.commit();
    }));
  }

  private rampFields(spec: RampSpec): void {
    this.append(vec2Field('Inicio XZ', spec.start, (v) => { spec.start = v; this.commit(); }));
    this.append(vec2Field('Fin XZ', spec.end, (v) => { spec.end = v; this.commit(); }));
    this.append(numberField('Y inicio', spec.startY, (v) => { spec.startY = v; this.commit(); }, 0.1));
    this.append(numberField('Y fin', spec.endY, (v) => { spec.endY = v; this.commit(); }, 0.1));
    this.append(numberField('Ancho', spec.width, (v) => { spec.width = v; this.commit(); }, 0.1));
    this.append(numberField('Escalones', spec.steps, (v) => { spec.steps = Math.max(1, Math.round(v)); this.commit(); }, 1));
  }

  private propFields(prop: PropEntitySpec): void {
    switch (prop.prop) {
      case 'crate': {
        const s = prop.spec;
        this.append(numberField('Tamano', s.size ?? 0.9, (v) => { s.size = v; this.commit(); }, 0.1));
        this.append(selectField('Material', s.material ?? 'crate', MATERIAL_KEYS, (v) => { s.material = v as MaterialKey; this.commit(); }));
        this.append(checkboxField('Dinamico', s.dynamic ?? false, (v) => { s.dynamic = v; this.commit(); }));
        this.append(numberField('Masa', s.mass ?? 18, (v) => { s.mass = v; this.commit(); }, 1));
        return;
      }
      case 'crateStack': {
        const s = prop.spec;
        this.append(numberField('Filas', s.rows ?? 2, (v) => { s.rows = Math.round(v); this.commit(); }, 1));
        this.append(numberField('Columnas', s.cols ?? 2, (v) => { s.cols = Math.round(v); this.commit(); }, 1));
        this.append(numberField('Capas', s.layers ?? 1, (v) => { s.layers = Math.round(v); this.commit(); }, 1));
        this.append(numberField('Tamano caja', s.crateSize ?? 0.9, (v) => { s.crateSize = v; this.commit(); }, 0.1));
        this.append(selectField('Material', s.material ?? 'crate', MATERIAL_KEYS, (v) => { s.material = v as MaterialKey; this.commit(); }));
        this.append(numberField('Seed', s.seed ?? 0, (v) => { s.seed = Math.round(v); this.commit(); }, 1));
        return;
      }
      case 'sandbagLine': {
        const s = prop.spec;
        this.append(vec2Field('Desde XZ', s.from, (v) => { s.from = v; this.commit(); }));
        this.append(vec2Field('Hasta XZ', s.to, (v) => { s.to = v; this.commit(); }));
        this.append(numberField('Altura', s.height ?? 0.95, (v) => { s.height = v; this.commit(); }, 0.05));
        this.append(numberField('Grosor', s.thickness ?? 0.7, (v) => { s.thickness = v; this.commit(); }, 0.05));
        this.append(selectField('Material', s.material ?? 'sand', MATERIAL_KEYS, (v) => { s.material = v as MaterialKey; this.commit(); }));
        return;
      }
      case 'coverWall': {
        const s = prop.spec;
        this.append(selectField('Eje', s.axis, AXES, (v) => { s.axis = v as 'x' | 'z'; this.commit(); }));
        this.append(numberField('Largo', s.length, (v) => { s.length = v; this.commit(); }, 0.1));
        this.append(numberField('Altura', s.height ?? 1.3, (v) => { s.height = v; this.commit(); }, 0.05));
        this.append(numberField('Grosor', s.thickness ?? 0.4, (v) => { s.thickness = v; this.commit(); }, 0.05));
        this.append(selectField('Material', s.material ?? 'brick', MATERIAL_KEYS, (v) => { s.material = v as MaterialKey; this.commit(); }));
        return;
      }
      case 'pillar': {
        const s = prop.spec;
        this.append(numberField('Altura', s.height ?? 3, (v) => { s.height = v; this.commit(); }, 0.1));
        this.append(numberField('Lado', s.side ?? 0.8, (v) => { s.side = v; this.commit(); }, 0.1));
        this.append(selectField('Material', s.material ?? 'brick', MATERIAL_KEYS, (v) => { s.material = v as MaterialKey; this.commit(); }));
        return;
      }
      case 'cargoContainer': {
        const s = prop.spec;
        this.append(selectField('Eje', s.axis, AXES, (v) => { s.axis = v as 'x' | 'z'; this.commit(); }));
        this.append(selectField('Material', s.material ?? 'trim', MATERIAL_KEYS, (v) => { s.material = v as MaterialKey; this.commit(); }));
        return;
      }
      case 'watchtower': {
        const s = prop.spec;
        this.append(numberField('Alto plataforma', s.platformHeight ?? 3, (v) => { s.platformHeight = v; this.commit(); }, 0.1));
        this.append(numberField('Tamano', s.size ?? 3.4, (v) => { s.size = v; this.commit(); }, 0.1));
        this.append(selectField('Lado rampa', s.rampSide ?? 'south', SIDES, (v) => { s.rampSide = v as HouseSide; this.commit(); }));
        this.append(selectField('Material', s.material ?? 'trim', MATERIAL_KEYS, (v) => { s.material = v as MaterialKey; this.commit(); }));
        return;
      }
    }
  }

  private append(field: { element: HTMLElement }): void {
    this.body.append(field.element);
  }
}

function header(icon: HTMLElement, title: string, subtitle: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'editor-inspector__header';
  const text = document.createElement('div');
  text.className = 'editor-inspector__header-text';
  const h = document.createElement('h3');
  h.textContent = title;
  const sub = document.createElement('span');
  sub.textContent = subtitle;
  text.append(h, sub);
  el.append(icon, text);
  return el;
}

function empty(text: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'editor-empty';
  el.textContent = text;
  return el;
}

function degTuple(rad: VectorTuple): [number, number, number] {
  return [radToDeg(rad[0]), radToDeg(rad[1]), radToDeg(rad[2])];
}

function radToDeg(r: number): number {
  return r * (180 / Math.PI);
}

function degToRad(d: number): number {
  return d * (Math.PI / 180);
}

function subheading(text: string): HTMLElement {
  const el = document.createElement('h4');
  el.className = 'editor-subheading';
  el.textContent = text;
  return el;
}

function miniButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'editor-button editor-button--mini';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

/** Cabecera de un sub-item (puerta) con boton de borrar. */
function subitemHeader(title: string, onRemove: () => void): HTMLElement {
  const head = document.createElement('div');
  head.className = 'editor-subitem__head';
  const label = document.createElement('span');
  label.textContent = title;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'editor-outliner__icon editor-outliner__icon--danger';
  remove.textContent = 'X';
  remove.title = 'Quitar';
  remove.addEventListener('click', onRemove);
  head.append(label, remove);
  return head;
}

const SEQUENCE_STEP_KINDS: readonly SequenceStep['kind'][] = ['gesture', 'wait', 'waitForCue', 'say', 'face'];
const GESTURE_IDS: readonly GestureId[] = ['point', 'wave', 'talk', 'crouch'];

interface DocumentIOTarget {
  name: string;
  classId: EntityClassId;
}

interface ConnectionInputInfo {
  knownTarget: boolean;
  inputs: readonly EntityInputDescriptor[];
  descriptor?: EntityInputDescriptor;
}

function entityIoClass(entity: EditorEntity): EntityClassId | null {
  switch (entity.kind) {
    case 'trigger':
      return 'trigger';
    case 'door':
      return 'door';
    case 'npc':
      return 'npc';
    case 'logic':
      return entity.def.kind;
    case 'sequence':
      return 'sequence';
    default:
      return null;
  }
}

function isContextTarget(target: string): boolean {
  return target === '!self' || target === '!activator' || target === '!caller' || target === '!player';
}

function connectionWarning(message: string): HTMLParagraphElement {
  const warning = document.createElement('p');
  warning.className = 'editor-note editor-note--warning';
  warning.setAttribute('role', 'note');
  warning.textContent = message;
  return warning;
}

function defaultNumberParam(input: string): number {
  if (input === 'Add' || input === 'Subtract') return 1;
  if (input === 'SplitBlob') return 3;
  return 0;
}

function blobPoseNeedsTarget(kind: BlobPoseKind): boolean {
  return kind === 'tendril' || kind === 'bridge' || kind === 'wall';
}

function defaultBlobPoseDimension(
  kind: BlobPoseKind,
  field: 'radius' | 'height' | 'width' | 'depth',
): number {
  if (field === 'depth') return kind === 'wall' || kind === 'bridge' ? 0.8 : 1.2;
  if (field === 'height') return kind === 'column' || kind === 'wall' ? 4 : 2;
  if (field === 'width') return kind === 'wall' || kind === 'bridge' ? 5 : 2.5;
  return kind === 'tendril' ? 0.7 : 2;
}

function uniqueBlobPoseId(poses: readonly BlobPoseDefinition[]): string {
  const occupied = new Set(poses.map((pose) => pose.id));
  let index = poses.length + 1;
  while (occupied.has(`pose-${index}`)) index += 1;
  return `pose-${index}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function targetNameMatches(pattern: string, name: string): boolean {
  if (!pattern.includes('*') && !pattern.includes('?')) return pattern === name;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`).test(name);
}

/** Lista de opciones con `current` garantizado presente (y primero si no vacío). */
function withCurrent(options: readonly string[], current: string): string[] {
  if (options.includes(current)) return [...options];
  return [current, ...options];
}

function defaultSequenceStep(kind: SequenceStep['kind']): SequenceStep {
  switch (kind) {
    case 'gesture':
      return { kind, gesture: 'point', duration: 1.5 };
    case 'wait':
      return { kind, seconds: 1 };
    case 'waitForCue':
      return { kind };
    case 'say':
      return { kind, text: '', duration: 3 };
    case 'face':
      return { kind, target: '!player' };
  }
}

function appendSequenceStepFields(item: HTMLElement, step: SequenceStep, commit: () => void): void {
  switch (step.kind) {
    case 'gesture':
      item.append(
        selectField('Gesto', step.gesture, GESTURE_IDS, (v) => { step.gesture = v as GestureId; commit(); }).element,
        numberField('Duración (s)', step.duration ?? 1, (v) => { step.duration = v; commit(); }, 0.25).element,
      );
      return;
    case 'wait':
      item.append(numberField('Segundos', step.seconds, (v) => { step.seconds = v; commit(); }, 0.25).element);
      return;
    case 'say':
      item.append(
        textField('Hablante', step.speaker ?? '', (v) => { step.speaker = v || undefined; commit(); }).element,
        textField('Texto', step.text, (v) => { step.text = v; commit(); }).element,
        numberField('Duración (s)', step.duration, (v) => { step.duration = v; commit(); }, 0.5).element,
      );
      return;
    case 'face':
      item.append(textField('Objetivo (marker o !player)', step.target, (v) => { step.target = v; commit(); }).element);
      return;
    case 'waitForCue':
      return;
  }
}

/** Escalera por defecto: un hueco centrado en X que recorre la profundidad. */
function defaultStair(spec: BuildingSpec): BuildingStair {
  const x0 = -spec.width / 2 + 1;
  const x1 = Math.max(x0 + 0.5, Math.min(x0 + 2, spec.width / 2 - 1));
  const zHalf = Math.max(1, Math.min(2, spec.depth / 2 - 1.5));
  return { footprint: { x: [x0, x1], z: [-zHalf, zHalf] }, topAt: 'north' };
}
