import type { ActorSnapshot, AiFrameContext } from "@game/npc/core/INpc";
import type { NpcLocomotionHandle } from "@game/npc/brain/NpcBrainContext";

/**
 * Controlador opcional para organismos cuyo comportamiento no encaja en los
 * schedules de combate convencionales. El runtime Npc sigue siendo dueno del
 * motor, animacion y teardown; el controlador solo decide locomocion/target.
 */
export interface NpcBehaviorController {
  update(
    ctx: AiFrameContext,
    locomotion: NpcLocomotionHandle,
  ): ActorSnapshot | null;
  getState(): string;
  dispose(): void;
}
