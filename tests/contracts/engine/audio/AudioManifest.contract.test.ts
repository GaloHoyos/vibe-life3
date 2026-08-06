import { describe, expect, it } from "vitest";
import { AudioClipCatalog } from "@engine/audio/AudioManifest";
import { ClipLoudnessTable } from "@engine/audio/generated/loudness.generated";
import { inferAudioRole } from "@engine/audio/mix/ClipRoles";
import { gainToDb, resolveClipGain } from "@engine/audio/mix/GainStaging";
import { RoleLoudnessTargets } from "@engine/audio/mix/MixProfile";

const clips = Object.values(AudioClipCatalog);

describe("AudioClipCatalog", () => {
  it("tiene clips", () => {
    expect(clips.length).toBeGreaterThan(200);
  });

  it("todo clip esta medido (si falla, correr `npm run audio:levels`)", () => {
    const missing = clips
      .filter((clip) => !ClipLoudnessTable[clip.source])
      .map((clip) => `${clip.id} -> ${clip.source}`);

    expect(missing).toEqual([]);
  });

  it("todo clip resuelve a un rol con objetivo definido", () => {
    for (const clip of clips) {
      expect(RoleLoudnessTargets[clip.role]).toBeTypeOf("number");
    }
  });

  it("el id y el source son unicos", () => {
    const ids = clips.map((clip) => clip.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ningun clip queda fuera de un rango razonable tras normalizar", () => {
    const outliers = clips
      .map((clip) => ({ id: clip.id, db: gainToDb(resolveClipGain(clip)) }))
      .filter((entry) => entry.db > 12.001 || entry.db < -40);

    expect(outliers).toEqual([]);
  });
});

describe("inferAudioRole", () => {
  it("separa el disparo de la manipulacion del arma", () => {
    expect(
      inferAudioRole({ id: "weapons.revolver.hl2.shot1", bus: "weapons" }),
    ).toBe("weaponFire");
    expect(
      inferAudioRole({ id: "weapons.revolver.hl2.reload1", bus: "weapons" }),
    ).toBe("weaponHandling");
  });

  it("`dryfire` es el clic del arma vacia, no un disparo", () => {
    expect(
      inferAudioRole({ id: "weapons.gravityGun.hl2.dryfire", bus: "weapons" }),
    ).toBe("weaponHandling");
  });

  it("`shotdown` es un impacto pese a empezar con `shot`", () => {
    expect(
      inferAudioRole({ id: "weapons.rpg.hl2.shotdown", bus: "weapons" }),
    ).toBe("impact");
  });

  it("el bus de armas distingue el fuego de torreta del chillido de headcrab", () => {
    expect(
      inferAudioRole({ id: "enemies.turret.hl2.attack1", bus: "weapons" }),
    ).toBe("weaponFire");
    expect(
      inferAudioRole({ id: "enemies.headcrab.hl2.attack1", bus: "enemies" }),
    ).toBe("vocalization");
  });

  it("distingue el lecho de ambiente del one-shot", () => {
    const id = "background.hl2.wind.med1";
    expect(inferAudioRole({ id, bus: "ambience", loop: true })).toBe(
      "ambienceBed",
    );
    expect(inferAudioRole({ id, bus: "ambience" })).toBe("ambienceOneShot");
  });

  it("la voz del traje va a `voice` y sus dispositivos a `hevBeep`", () => {
    expect(inferAudioRole({ id: "hev.fvox.damage", bus: "voice" })).toBe(
      "voice",
    );
    expect(inferAudioRole({ id: "hev.items.suitChargeOk", bus: "ui" })).toBe(
      "hevBeep",
    );
  });
});
