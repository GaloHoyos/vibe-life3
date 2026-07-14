/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Input } from "@engine/input/Input";

describe("Input pointer capture", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "userActivation");
  });

  it("reports a successful pointer-lock request", async () => {
    setUserActivation(true);
    const target = document.createElement("canvas");
    const requestPointerLock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(target, "requestPointerLock", {
      configurable: true,
      value: requestPointerLock,
    });
    const input = new Input(target);

    await expect(input.requestPointerLock()).resolves.toBe(true);
    expect(requestPointerLock).toHaveBeenCalledOnce();

    input.dispose();
  });

  it("handles a denied pointer-lock request without rejecting", async () => {
    setUserActivation(true);
    const target = document.createElement("canvas");
    const requestPointerLock = vi
      .fn()
      .mockRejectedValue(new DOMException("User activation expired", "NotAllowedError"));
    Object.defineProperty(target, "requestPointerLock", {
      configurable: true,
      value: requestPointerLock,
    });
    const input = new Input(target);

    await expect(input.requestPointerLock()).resolves.toBe(false);
    expect(requestPointerLock).toHaveBeenCalledOnce();

    input.dispose();
  });

  it("skips pointer lock after transient user activation expires", async () => {
    setUserActivation(false);
    const target = document.createElement("canvas");
    const requestPointerLock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(target, "requestPointerLock", {
      configurable: true,
      value: requestPointerLock,
    });
    const input = new Input(target);

    await expect(input.requestPointerLock()).resolves.toBe(false);
    expect(requestPointerLock).not.toHaveBeenCalled();

    input.dispose();
  });
});

function setUserActivation(isActive: boolean): void {
  Object.defineProperty(navigator, "userActivation", {
    configurable: true,
    value: { hasBeenActive: isActive, isActive },
  });
}
