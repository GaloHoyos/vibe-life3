import type { Raycast } from "@engine/physics/Raycast";

export function fakeRaycast(): Raycast {
  return {
    cast: () => null,
  } as unknown as Raycast;
}
