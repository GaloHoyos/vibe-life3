import {
  cargoContainer,
  coverWall,
  crate,
  crateStack,
  pillar,
  sandbagLine,
  watchtower,
  type PropArtifact,
} from '@game/levels/builders/PropBuilder';
import type { PropEntitySpec } from './EditorDocument';

/**
 * Corre el builder del `PropBuilder` correspondiente al spec etiquetado.
 * Compartido por el preview de la escena y el codegen a `LevelDefinition`.
 */
export function buildProp(prop: PropEntitySpec): PropArtifact {
  switch (prop.prop) {
    case 'crate':
      return crate(prop.spec);
    case 'crateStack':
      return crateStack(prop.spec);
    case 'sandbagLine':
      return sandbagLine(prop.spec);
    case 'coverWall':
      return coverWall(prop.spec);
    case 'pillar':
      return pillar(prop.spec);
    case 'cargoContainer':
      return cargoContainer(prop.spec);
    case 'watchtower':
      return watchtower(prop.spec);
  }
}
