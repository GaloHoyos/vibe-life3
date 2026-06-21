import type { Object3D } from "three";
import { Vector3 } from "three";
import { InteractionsConfig } from "@game/config/gameplay.config";
import type { GameEventBus, LevelActionKind } from "@game/GameEvents";
import type { Interactable } from "./Interactable";

export class ActionButton implements Interactable {
  readonly maxDistance = InteractionsConfig.doorButtonRange;
  private readonly worldPosition = new Vector3();

  constructor(
    readonly id: string,
    readonly label: string,
    readonly object: Object3D,
    private readonly action: LevelActionKind,
    private readonly eventBus: GameEventBus,
  ) {}

  interact(): void {
    this.object.getWorldPosition(this.worldPosition);
    this.eventBus.emit("level.action", {
      id: this.id,
      action: this.action,
      position: this.worldPosition.clone(),
    });
  }
}
