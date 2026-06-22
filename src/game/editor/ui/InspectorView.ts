import type { Disposable } from '@shared/types/lifecycle';
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
import type { EditorDocument, EditorEntity, PropEntitySpec } from '../EditorDocument';
import { entityKindLabel, entityLevelId } from '../EditorDocument';
import {
  editablePayload,
  getPosition,
  getRotationY,
  getSize,
  setLevelId,
  setPosition,
  setRotationY,
  setSize,
} from '../EditorEntityOps';
import {
  CHARACTER_IDS,
  CHARGER_KINDS,
  ITEM_IDS,
  LEVEL_ACTIONS,
  MATERIAL_KEYS,
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

  private mode: 'entity' | 'player' | null = null;
  private entity: EditorEntity | null = null;
  private posField: Field<[number, number, number]> | null = null;
  private sizeField: Field<[number, number, number]> | null = null;

  /** Pisos con su `<details>` desplegado, para preservar el estado al re-render. */
  private readonly openStories = new Set<number>([0]);

  constructor(private readonly callbacks: InspectorCallbacks) {
    this.element.className = 'editor-panel editor-inspector';
    this.clear();
  }

  clear(): void {
    this.mode = null;
    this.entity = null;
    this.posField = null;
    this.sizeField = null;
    this.element.replaceChildren(empty('Nada seleccionado.'));
  }

  showPlayerStart(): void {
    this.mode = 'player';
    this.entity = null;
    this.sizeField = null;
    this.element.replaceChildren();
    this.element.append(header('Spawn del jugador', 'playerStart'));
    const doc = this.callbacks.getDocument();
    this.posField = vec3Field('Posicion', doc.meta.playerStart, (v) => {
      doc.meta.playerStart = v;
      this.callbacks.onPlayerStartChanged();
    });
    this.element.append(this.posField.element);
  }

  showEntity(entity: EditorEntity): void {
    this.mode = 'entity';
    this.entity = entity;
    this.element.replaceChildren();
    this.element.append(header(entityKindLabel(entity.kind), entityLevelId(entity)));

    this.element.append(
      textField('Id', entityLevelId(entity), (v) => {
        if (v) setLevelId(entity, v);
        this.commit();
      }).element,
    );

    this.posField = vec3Field('Posicion', getPosition(entity), (v) => {
      setPosition(entity, v);
      this.commit();
    });
    this.element.append(this.posField.element);

    const size = getSize(entity);
    if (size) {
      this.sizeField = vec3Field('Tamano', size, (v) => {
        setSize(entity, v);
        this.commit();
      });
      this.element.append(this.sizeField.element);
    } else {
      this.sizeField = null;
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
    this.element.append(advanced);
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
    }
  }

  dispose(): void {
    this.element.replaceChildren();
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
          this.commit();
        }));
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
        this.append(checkboxField('Una sola vez', entity.def.once, (v) => {
          entity.def.once = v;
          this.commit();
        }));
        this.append(textField('Hablante', entity.def.dialogue.speaker ?? '', (v) => {
          entity.def.dialogue.speaker = v || undefined;
          this.commit();
        }));
        this.append(textField('Texto', entity.def.dialogue.text, (v) => {
          entity.def.dialogue.text = v;
          this.commit();
        }));
        this.append(numberField('Duracion (s)', entity.def.dialogue.duration, (v) => {
          entity.def.dialogue.duration = v;
          this.commit();
        }, 0.5));
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
    this.append(selectField('Mat. base', spec.palette?.base ?? 'concrete', MATERIAL_KEYS, (v) => { spec.palette = { ...spec.palette, base: v as MaterialKey }; this.commit(); }));
    this.append(selectField('Mat. trim', spec.palette?.trim ?? 'trim', MATERIAL_KEYS, (v) => { spec.palette = { ...spec.palette, trim: v as MaterialKey }; this.commit(); }));
    this.append(selectField('Mat. techo', spec.palette?.roof ?? 'roof', MATERIAL_KEYS, (v) => { spec.palette = { ...spec.palette, roof: v as MaterialKey }; this.commit(); }));
    this.append(selectField('Mat. piso', spec.palette?.floor ?? 'floor', MATERIAL_KEYS, (v) => { spec.palette = { ...spec.palette, floor: v as MaterialKey }; this.commit(); }));

    const stack = document.createElement('div');
    stack.className = 'editor-substack';
    stack.append(subheading('Pisos: puertas y escaleras'));
    spec.stories.forEach((story, i) => stack.append(this.storyEditor(spec, story, i)));
    this.element.append(stack);
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
    this.element.append(field.element);
  }
}

function header(title: string, subtitle: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'editor-inspector__header';
  const h = document.createElement('h3');
  h.textContent = title;
  const sub = document.createElement('span');
  sub.textContent = subtitle;
  el.append(h, sub);
  return el;
}

function empty(text: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'editor-empty';
  el.textContent = text;
  return el;
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

/** Escalera por defecto: un hueco centrado en X que recorre la profundidad. */
function defaultStair(spec: BuildingSpec): BuildingStair {
  const x0 = -spec.width / 2 + 1;
  const x1 = Math.max(x0 + 0.5, Math.min(x0 + 2, spec.width / 2 - 1));
  const zHalf = Math.max(1, Math.min(2, spec.depth / 2 - 1.5));
  return { footprint: { x: [x0, x1], z: [-zHalf, zHalf] }, topAt: 'north' };
}
