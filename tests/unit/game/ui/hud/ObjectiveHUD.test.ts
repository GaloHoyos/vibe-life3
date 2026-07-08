import { afterEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { ObjectiveHUD } from "@game/ui/hud/ObjectiveHUD";

describe("ObjectiveHUD", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows objectives and clears completed objectives after the delay", () => {
    vi.useFakeTimers();
    const markerLayer = document.createElement("div");
    const hud = new ObjectiveHUD(markerLayer);

    hud.setObjective("reach the lab", true);

    expect(hud.element.textContent).toContain("REACH THE LAB");
    expect(hud.element.classList.contains("is-visible")).toBe(true);
    expect(hud.element.classList.contains("is-completed")).toBe(true);

    vi.advanceTimersByTime(2600);

    expect(hud.element.classList.contains("is-visible")).toBe(false);
    expect(hud.element.classList.contains("is-completed")).toBe(false);
  });

  it("projects world markers and removes marker on dispose", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    const markerLayer = document.createElement("div");
    const hud = new ObjectiveHUD(markerLayer);
    const camera = new PerspectiveCamera(75, 800 / 600, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(new Vector3(0, 0, -1));
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();

    hud.setMarker(new Vector3(0, 0, -10));
    hud.update(camera);

    const marker = markerLayer.querySelector(".hev-objective__marker") as HTMLElement;
    expect(marker.classList.contains("is-visible")).toBe(true);
    expect(marker.classList.contains("is-edge")).toBe(false);
    expect(marker.textContent).toBe("10 m");
    expect(marker.style.left).toBe("400px");
    expect(marker.style.top).toBe("300px");

    hud.setMarker(null);
    expect(marker.classList.contains("is-visible")).toBe(false);

    hud.dispose();
    expect(markerLayer.querySelector(".hev-objective__marker")).toBeNull();
  });
});
