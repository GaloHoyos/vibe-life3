import { describe, expect, it } from "vitest";
import { AudioClipCatalog } from "@engine/audio/AudioManifest";
import {
  CarryAudio,
  DoorAudio,
  EnemyAudio,
  HevDamageDiagnosis,
  HevSuitAudio,
  MaterialImpacts,
  MusicTracks,
  PickupAudio,
  PlayerAudio,
  PlayerDamageVoice,
  PlayerHazardAudio,
  RicochetSounds,
  Soundscapes,
  SurfaceBulletImpacts,
  SurfaceFootsteps,
  UiAudio,
  WeaponAudio,
  WeaponSelectorAudio,
} from "@game/config/audio.config";
import {
  ArchetypeAudio,
  ArchetypeOneShotAudio,
  SyntheticVehicleClips,
} from "@game/gameplay/vehicles/VehicleAudioSystem";

/**
 * Las tablas de `audio.config` referencian clips por id suelto: TypeScript no
 * ve la diferencia entre un id vivo y uno que quedó colgado al renombrar un
 * asset. Este contrato la ve — un id que no existe deja el evento mudo en
 * runtime sin que falle nada más.
 */
function collectIds(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    into.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectIds(entry, into));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => collectIds(entry, into));
  }
}

const tables: Record<string, unknown> = {
  WeaponAudio,
  EnemyAudio,
  UiAudio,
  HevSuitAudio,
  HevDamageDiagnosis,
  SurfaceBulletImpacts,
  MaterialImpacts,
  RicochetSounds,
  DoorAudio,
  PlayerAudio,
  PlayerDamageVoice,
  PlayerHazardAudio,
  CarryAudio,
  PickupAudio,
  WeaponSelectorAudio,
  MusicTracks,
  SurfaceFootsteps,
  ambiences: Object.values(Soundscapes).map((scape) =>
    "ambiences" in scape ? scape.ambiences : [],
  ),
};

describe("tablas de audio del juego", () => {
  for (const [name, table] of Object.entries(tables)) {
    it(`${name} solo referencia clips del catalogo`, () => {
      const ids = new Set<string>();
      collectIds(table, ids);
      const missing = [...ids].filter((id) => !AudioClipCatalog[id]);
      expect(missing).toEqual([]);
    });
  }

  // Los vehículos alquilan sus capas sintéticas por nivel, así que sus ids
  // salen del catálogo base o de ese registro dinámico, nunca de otro lado.
  it("las capas de vehiculo salen del catalogo o del registro sintetico", () => {
    const synthetic = new Set(SyntheticVehicleClips.map((clip) => clip.id));
    const ids = new Set<string>();
    collectIds([ArchetypeAudio, ArchetypeOneShotAudio], ids);
    const missing = [...ids].filter(
      (id) => !AudioClipCatalog[id] && !synthetic.has(id),
    );
    expect(missing).toEqual([]);
  });
});
