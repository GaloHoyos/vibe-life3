import { describe, expect, it } from "vitest";
import { Subtitles } from "@game/ui/subtitles/Subtitles";

describe("Subtitles", () => {
  it("renders, expires and disposes subtitle lines", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const subtitles = new Subtitles(root);

    expect(root.contains(subtitles.element)).toBe(true);
    expect(subtitles.element.className).toBe("hev-subtitles");

    subtitles.show("Ready", 1, "HEV");

    expect(subtitles.element.textContent).toBe("HEV: Ready");
    expect(subtitles.element.classList.contains("is-visible")).toBe(true);

    subtitles.update(0.5);
    expect(subtitles.element.classList.contains("is-visible")).toBe(true);

    subtitles.update(0.5);
    expect(subtitles.element.classList.contains("is-visible")).toBe(false);
    expect(subtitles.element.textContent).toBe("");

    subtitles.dispose();
    expect(root.contains(subtitles.element)).toBe(false);
  });
});
