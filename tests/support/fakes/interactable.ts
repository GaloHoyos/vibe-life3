import { Object3D } from "three";
import { vi } from "vitest";
import type { Interactable } from "@game/gameplay/interactions/Interactable";

export type FakeInteractable = Interactable & {
  interact: ReturnType<typeof vi.fn>;
  interactHeld: ReturnType<typeof vi.fn>;
  interactEnd: ReturnType<typeof vi.fn>;
};

export function fakeInteractable(
  overrides: Partial<Interactable> = {},
): FakeInteractable {
  return {
    id: "interactable-1",
    label: "Use panel",
    object: new Object3D(),
    maxDistance: 4,
    interact: vi.fn(),
    interactHeld: vi.fn(),
    interactEnd: vi.fn(),
    ...overrides,
  } as FakeInteractable;
}
