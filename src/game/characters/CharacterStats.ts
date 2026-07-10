import type { CharacterDefinition } from '@engine/characters/CharacterDefinition';
import type { NpcPreset } from '@game/npc/presets/NpcPreset';

/**
 * Para perfiles humanoides, `CharacterPresets` es LA fuente de vida y
 * percepcion: pisa los defaults del builder del brain, asi cada variante
 * (combine/elite/shotgunner, rebeldes) tunea stats sin duplicar schedules.
 * Los no-humanoides (creatures/bosses) conservan los valores de su builder.
 */
export function applyDefinitionStats(
  preset: NpcPreset,
  definition: CharacterDefinition,
): NpcPreset {
  preset.maxHealth = definition.health.maxHealth;
  if (definition.attack.grenade?.enabled) {
    preset.grenade = definition.attack.grenade;
  }
  preset.perception = {
    visionRange: definition.perception.viewDistance,
    visionConeRadians: definition.perception.viewConeRadians,
    hearingRadius: definition.perception.hearingRadius,
    memoryTime: definition.perception.memoryDuration,
    eyeHeight: definition.perception.eyeHeight,
    ...(definition.perception.detection ? { detection: definition.perception.detection } : {}),
  };
  return preset;
}
