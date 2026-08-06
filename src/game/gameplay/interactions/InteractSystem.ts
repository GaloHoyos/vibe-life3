import { Object3D, Raycaster, Vector3 } from 'three';
import type { GameEventBus } from "@game/GameEvents";
import type { Controls } from "@game/gameplay/player/Controls";
import type { Interactable } from './Interactable';

export class InteractSystem {
  private readonly interactables: Interactable[] = [];
  private readonly raycaster = new Raycaster();
  private current: Interactable | null = null;
  private held: Interactable | null = null;

  constructor(private readonly eventBus: GameEventBus) {}

  register(interactable: Interactable): void {
    this.interactables.push(interactable);
  }

  /** Quita un interactable por id (p.ej. una compañera que murió). */
  unregister(id: string): void {
    const index = this.interactables.findIndex((it) => it.id === id);
    if (index < 0) return;
    const [removed] = this.interactables.splice(index, 1);
    if (this.current?.id === id) this.clearFocus();
    if (this.held?.id === id) {
      removed.interactEnd?.();
      this.held = null;
    }
  }

  /** Interactable enfocado este frame; el GrabSystem le cede la prioridad. */
  getFocused(): Interactable | null {
    return this.current;
  }

  /**
   * Suelta el foco actual. Lo llama quien deja de correr `update()` (montar un
   * vehículo, muerte): sin esto el HUD se queda con el último prompt colgado.
   */
  releaseFocus(): void {
    this.endHeld();
    this.clearFocus();
  }

  /** Vacía el registro (al recargar nivel) — evita interactables huérfanos. */
  clear(): void {
    this.releaseFocus();
    this.interactables.length = 0;
  }

  update(delta: number, cameraPosition: Vector3, cameraDirection: Vector3, controls: Controls): void {
    this.raycaster.set(cameraPosition, cameraDirection);
    this.raycaster.far = 4;
    const objects = this.interactables.map((interactable) => interactable.object);
    const intersections = this.raycaster.intersectObjects(objects, true);
    const previous = this.current;
    this.current = null;

    for (const intersection of intersections) {
      const interactable = this.findInteractable(intersection.object);

      if (!interactable || intersection.distance > interactable.maxDistance) {
        continue;
      }

      this.current = interactable;
      break;
    }

    if (previous?.id !== this.current?.id) {
      if (this.current) {
        this.eventBus.emit('interaction.focus', {
          label: this.current.label,
        });
      } else {
        this.eventBus.emit('interaction.blur', {});
      }
    }

    if (this.current && controls.wasPressed("interact")) {
      this.current.interact();
    }

    const holding =
      this.current && controls.isDown("interact") ? this.current : null;
    if (this.held && this.held !== holding) {
      this.held.interactEnd?.();
    }
    holding?.interactHeld?.(delta);
    this.held = holding;
  }

  private clearFocus(): void {
    if (!this.current) return;
    this.current = null;
    this.eventBus.emit('interaction.blur', {});
  }

  private endHeld(): void {
    this.held?.interactEnd?.();
    this.held = null;
  }

  private findInteractable(object: Object3D): Interactable | null {
    return (
      this.interactables.find((interactable) => {
        let cursor: Object3D | null = object;

        while (cursor) {
          if (cursor === interactable.object) {
            return true;
          }

          cursor = cursor.parent;
        }

        return false;
      }) ?? null
    );
  }
}
