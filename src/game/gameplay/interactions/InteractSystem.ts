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

  /** Vacía el registro (al recargar nivel) — evita interactables huérfanos. */
  clear(): void {
    this.endHeld();
    this.interactables.length = 0;
    this.current = null;
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
