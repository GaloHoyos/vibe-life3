import type { EditorDocument } from '../EditorDocument';

/**
 * Genera el codigo fuente `.ts` del nivel como una cadena `createMap().…build()`
 * lista para pegar en `src/game/levels/maps/` y registrar. Los smart objects se
 * emiten como llamadas a los builders (`structure`/`house`/`ramp`/`prop`), asi
 * que el archivo resultante sigue siendo re-editable a mano.
 */
export function toTypeScript(doc: EditorDocument): string {
  const propFns = new Set<string>();
  const lines: string[] = [];

  if (doc.terrain) lines.push(`  .terrain(${lit(doc.terrain)})`);

  for (const entity of doc.entities) {
    switch (entity.kind) {
      case 'staticBox':
        lines.push(`  .boxes(${lit(entity.def)})`);
        break;
      case 'dynamicBox':
        lines.push(`  .dynamicBoxes(${lit(entity.def)})`);
        break;
      case 'door':
        lines.push(`  .door(${lit(entity.def)})`);
        break;
      case 'actionButton':
        lines.push(`  .actionButton(${lit(entity.def)})`);
        break;
      case 'npc':
        lines.push(`  .npc(${lit(entity.def)})`);
        break;
      case 'weaponPickup':
        lines.push(`  .pickup(${lit(entity.def)})`);
        break;
      case 'itemPickup':
        lines.push(`  .item(${lit(entity.def)})`);
        break;
      case 'charger':
        lines.push(`  .charger(${lit(entity.def)})`);
        break;
      case 'trigger':
        lines.push(`  .trigger(${lit(entity.def)})`);
        break;
      case 'explosiveBarrel':
        lines.push(`  .explosiveBarrel(${lit(entity.def)})`);
        break;
      case 'hazardVolume':
        lines.push(`  .hazardVolume(${lit(entity.def)})`);
        break;
      case 'building':
        lines.push(`  .structure(${lit(entity.spec)})`);
        break;
      case 'house':
        lines.push(`  .house(${lit(entity.spec)})`);
        break;
      case 'ramp':
        lines.push(`  .ramp(${lit(entity.spec)})`);
        break;
      case 'prop':
        propFns.add(entity.prop.prop);
        lines.push(`  .prop(${entity.prop.prop}(${lit(entity.prop.spec)}))`);
        break;
      case 'prebuiltBuilding':
        lines.push(`  .building(${lit(entity.artifact)})`);
        break;
    }
  }

  const imports = [`import { createMap } from '@game/levels/builders/MapCreator';`];
  if (propFns.size > 0) {
    imports.push(
      `import { ${[...propFns].sort().join(', ')} } from '@game/levels/builders/PropBuilder';`,
    );
  }

  return (
    `${imports.join('\n')}\n\n` +
    `export const ${identifier(doc.meta.id)} = createMap(${lit(doc.meta, true)})\n` +
    `${lines.join('\n')}\n` +
    `  .build();\n`
  );
}

function lit(value: unknown, pretty = false): string {
  return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

function identifier(id: string): string {
  const camel = id
    .replace(/[^a-zA-Z0-9]+(.)?/g, (_, ch: string | undefined) => (ch ? ch.toUpperCase() : ''))
    .replace(/^[^a-zA-Z_]+/, '');
  return camel ? `${camel}Level` : 'level';
}
