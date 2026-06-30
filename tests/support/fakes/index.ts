export * from "./assets";
export * from "./audio";
export * from "./controls";
export * from "./dom";
export * from "./interactable";
export * from "./physics";
export * from "./raycast";
export * from "./storage";
export * from "./ui";
export * from "./workshop";

import type { VfxSystem } from "@engine/render/effects/VfxSystem";

export function fakeVfx(): VfxSystem {
  return {
    explosion: () => undefined,
  } as unknown as VfxSystem;
}
