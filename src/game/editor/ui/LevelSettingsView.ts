import type { Disposable } from '@shared/types/lifecycle';
import type { TerrainDefinition } from '@game/levels/LevelDefinition';
import type { SkyboxId } from '@engine/render/environment/Skybox';
import type { EditorDocument } from '../EditorDocument';
import { MATERIAL_KEYS, SKYBOX_IDS } from '../editorOptions';
import { iconSpan } from './editorIcons';
import {
  checkboxField,
  colorField,
  jsonField,
  numberField,
  selectField,
  splitList,
  textField,
  vec3Field,
} from './editorFields';

export interface SettingsCallbacks {
  getDocument(): EditorDocument;
  onMetaChanged(): void;
  onTerrainChanged(terrain: TerrainDefinition | undefined): void;
}

const DEFAULT_SUN_DIR: [number, number, number] = [0.4, 1, 0.3];

function defaultTerrain(): TerrainDefinition {
  return {
    id: 'terrain',
    position: [0, 0, 0],
    size: [80, 80],
    widthSamples: 64,
    depthSamples: 64,
    source: { kind: 'noise', seed: 1, octaves: 4, frequency: 0.03, amplitude: 5 },
    material: 'snow',
  };
}

/** Panel de configuracion del nivel: meta, sol, audio y terreno. */
export class LevelSettingsView implements Disposable {
  readonly element = document.createElement('div');
  private readonly body = document.createElement('div');
  private readonly details = document.createElement('details');

  constructor(private readonly callbacks: SettingsCallbacks) {
    this.element.className = 'editor-panel editor-settings';
    const summary = document.createElement('summary');
    summary.className = 'editor-panel__title';
    summary.append(iconSpan('gear'));
    const label = document.createElement('span');
    label.textContent = 'Nivel';
    summary.append(label);
    this.details.append(summary, this.body);
    this.body.className = 'editor-panel__body';
    this.element.append(this.details);
    this.refresh();
  }

  /** Despliega el panel y lo trae a la vista (menu "Configuracion del nivel"). */
  open(): void {
    this.details.open = true;
    this.element.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  refresh(): void {
    const doc = this.callbacks.getDocument();
    const meta = doc.meta;
    const changed = (): void => this.callbacks.onMetaChanged();
    this.body.replaceChildren();

    this.body.append(
      textField('Id', meta.id, (v) => { meta.id = v; changed(); }).element,
      textField('Titulo', meta.title, (v) => { meta.title = v; changed(); }).element,
      textField('Descripcion', meta.description ?? '', (v) => { meta.description = v || undefined; changed(); }).element,
      colorField('Fondo', meta.background, (v) => { meta.background = v; changed(); }).element,
      selectField('Skybox', meta.skybox ?? 'default', SKYBOX_IDS, (v) => { meta.skybox = v as SkyboxId; changed(); }).element,
      vec3Field('Spawn', meta.playerStart, (v) => { meta.playerStart = v; changed(); }).element,
    );

    const sun = meta.sun ?? {};
    this.body.append(
      vec3Field('Sol: direccion', sun.direction ?? DEFAULT_SUN_DIR, (v) => {
        meta.sun = { ...meta.sun, direction: v };
        changed();
      }).element,
      colorField('Sol: color', sun.color ?? 0xfff2d6, (v) => {
        meta.sun = { ...meta.sun, color: v };
        changed();
      }).element,
      numberField('Sol: intensidad', sun.intensity ?? 3, (v) => {
        meta.sun = { ...meta.sun, intensity: v };
        changed();
      }, 0.1).element,
    );

    this.body.append(
      textField('Ambiences', meta.audio.ambiences.join(', '), (v) => {
        meta.audio.ambiences = splitList(v);
        changed();
      }).element,
      textField('Pasos', meta.audio.footstepSounds.join(', '), (v) => {
        meta.audio.footstepSounds = splitList(v);
        changed();
      }).element,
      textField('Musica', meta.audio.music ?? '', (v) => {
        meta.audio.music = v || undefined;
        changed();
      }).element,
    );

    this.body.append(this.terrainSection(doc));
  }

  dispose(): void {
    this.details.replaceChildren();
    this.element.replaceChildren();
  }

  private terrainSection(doc: EditorDocument): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'editor-settings__terrain';
    wrap.append(
      checkboxField('Terreno', doc.terrain !== undefined, (enabled) => {
        this.callbacks.onTerrainChanged(enabled ? defaultTerrain() : undefined);
        this.refresh();
      }).element,
    );

    const terrain = doc.terrain;
    if (!terrain) return wrap;

    const apply = (): void => this.callbacks.onTerrainChanged(terrain);
    wrap.append(
      vec3Field('Centro', terrain.position, (v) => { terrain.position = v; apply(); }).element,
      numberField('Ancho X', terrain.size[0], (v) => { terrain.size = [v, terrain.size[1]]; apply(); }, 1).element,
      numberField('Profundidad Z', terrain.size[1], (v) => { terrain.size = [terrain.size[0], v]; apply(); }, 1).element,
      numberField('Muestras X', terrain.widthSamples, (v) => { terrain.widthSamples = Math.round(v); apply(); }, 1).element,
      numberField('Muestras Z', terrain.depthSamples, (v) => { terrain.depthSamples = Math.round(v); apply(); }, 1).element,
      selectField('Material', terrain.material, MATERIAL_KEYS, (v) => { terrain.material = v as typeof terrain.material; apply(); }).element,
      jsonField('Fuente (noise/flat)', terrain.source, (parsed) => {
        if (parsed && typeof parsed === 'object') {
          Object.assign(terrain.source, parsed);
          apply();
        }
      }).element,
    );
    return wrap;
  }
}
