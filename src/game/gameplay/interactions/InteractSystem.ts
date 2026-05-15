import { Object3D, Raycaster, Vector3 } from 'three';
import type { GameEventBus } from "../../GameEvents";
import type { Input } from '../../../engine/Input';
import type { Interactable } from './Interactable';

export class InteractSystem {
  private readonly interactables: Interactable[] = [];
  private readonly raycaster = new Raycaster();
  private current: Interactable | null = null;

  constructor(private readonly eventBus: GameEventBus) {}

  register(interactable: Interactable): void {
    this.interactables.push(interactable);
  }

  update(cameraPosition: Vector3, cameraDirection: Vector3, input: Input): void {
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

    if (this.current && input.wasKeyPressed('KeyE')) {
      this.current.interact();
    }
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
