import { describe, expect, it } from "vitest";
import { measureBlobV2Coverage } from "@game/npc/blob/v2/BlobV2Coverage";

describe("measureBlobV2Coverage", () => {
  it("distinguishes a single touching particle from real envelopment", () => {
    const result = measureBlobV2Coverage(
      { x: 0, y: 0, z: 0 },
      [{ position: { x: 0.25, y: 0, z: 0 }, radius: 0.25 }],
      { targetRadius: 0.2 },
    );

    expect(result.contact).toBe(true);
    expect(result.enveloped).toBe(false);
    expect(result.nearbyParticles).toBe(1);
  });

  it("requires attached mass distributed over several angular sectors", () => {
    const particles = Array.from({ length: 8 }, (_, index) => {
      const angle = (index / 8) * Math.PI * 2;
      return {
        position: {
          x: Math.cos(angle) * 0.36,
          y: index % 2 === 0 ? 0.08 : -0.08,
          z: Math.sin(angle) * 0.36,
        },
        radius: 0.25,
      };
    });
    const result = measureBlobV2Coverage(
      { x: 0, y: 0, z: 0 },
      particles,
      { targetRadius: 0.2 },
    );

    expect(result.enveloped).toBe(true);
    expect(result.nearbyParticles).toBe(8);
    expect(result.occupiedSectors).toBeGreaterThanOrEqual(3);
  });

  it("uses lower exit thresholds to avoid flicker after envelopment", () => {
    const particles = [
      { position: { x: 0.32, y: 0, z: 0.04 }, radius: 0.25 },
      { position: { x: 0.34, y: 0.08, z: -0.05 }, radius: 0.25 },
      { position: { x: -0.32, y: 0, z: 0.04 }, radius: 0.25 },
      { position: { x: -0.34, y: -0.08, z: -0.05 }, radius: 0.25 },
    ];

    expect(measureBlobV2Coverage(
      { x: 0, y: 0, z: 0 },
      particles,
      { targetRadius: 0.2 },
    ).enveloped).toBe(false);
    expect(measureBlobV2Coverage(
      { x: 0, y: 0, z: 0 },
      particles,
      { targetRadius: 0.2, previouslyEnveloped: true },
    ).enveloped).toBe(true);
  });
});
