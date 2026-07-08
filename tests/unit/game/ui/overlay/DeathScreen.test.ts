import { describe, expect, it, vi } from "vitest";
import { DeathScreen } from "@game/ui/overlay/DeathScreen";

describe("DeathScreen", () => {
  it("controls tint, prompt state and respawn input", () => {
    const root = document.createElement("div");
    const onRespawn = vi.fn();
    const onExit = vi.fn();
    const screen = new DeathScreen(root, { onRespawn, onExit });

    screen.begin();
    screen.setIntensity(0.5);

    expect(root.contains(screen.element)).toBe(true);
    expect(root.querySelector(".hev-death-tint")?.getAttribute("style")).toContain("opacity: 0.39");

    screen.showPrompt(true);
    document.dispatchEvent(new MouseEvent("mousedown"));
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));

    expect(onRespawn).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();

    screen.dispose();
    expect(root.contains(screen.element)).toBe(false);
  });

  it("exits with Escape or when respawn is unavailable", () => {
    const root = document.createElement("div");
    const onRespawn = vi.fn();
    const onExit = vi.fn();
    const screen = new DeathScreen(root, { onRespawn, onExit });

    screen.showPrompt(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyR" }));

    expect(onRespawn).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledTimes(1);

    screen.showPrompt(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));

    expect(onExit).toHaveBeenCalledTimes(2);
    screen.dispose();
  });
});
