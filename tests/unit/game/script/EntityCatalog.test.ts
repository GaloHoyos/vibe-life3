import { describe, expect, it } from 'vitest';
import { EntityCatalog } from '@game/script/EntityCatalog';

describe('EntityCatalog vehicle I/O', () => {
  it('expone órdenes vehiculares y aterrizaje sistémico al editor', () => {
    const inputs = new Map(
      EntityCatalog.vehicle.inputs.map((input) => [input.id, input.param] as const),
    );

    expect(inputs.get('SetGoal')).toBe('string');
    expect(inputs.has('ClearGoal')).toBe(true);
    expect(inputs.get('SetBehavior')).toBe('string');
    expect(inputs.get('LandAt')).toBe('targetName');
    expect(inputs.has('AbortLanding')).toBe(true);
  });

  it('publica los resultados de órdenes y aterrizajes', () => {
    const outputs = new Set(EntityCatalog.vehicle.outputs.map((output) => output.id));

    expect([...outputs]).toEqual(expect.arrayContaining([
      'OnOrderReached',
      'OnOrderCompleted',
      'OnOrderFailed',
      'OnLandingSelected',
      'OnLanded',
      'OnLandingFailed',
    ]));
  });
});
