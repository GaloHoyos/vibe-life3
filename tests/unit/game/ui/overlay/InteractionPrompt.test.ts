import { describe, expect, it } from "vitest";
import { InteractionPrompt } from "@game/ui/overlay/InteractionPrompt";

describe("InteractionPrompt", () => {
  it("normalizes labels and toggles visibility", () => {
    const prompt = new InteractionPrompt();

    expect(prompt.element.classList.contains("is-visible")).toBe(false);

    prompt.setLabel("[E] open door");

    expect(prompt.element.textContent).toContain("E");
    expect(prompt.element.textContent).toContain("OPEN DOOR");
    expect(prompt.element.classList.contains("is-visible")).toBe(true);

    prompt.setLabel("   ");

    expect(prompt.element.classList.contains("is-visible")).toBe(false);
  });
});
