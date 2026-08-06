import { describe, expect, it } from 'vitest';
import { VehicleTacticMemory } from '@game/gameplay/vehicles/ai/VehicleTacticMemory';
import type { VehicleTacticMemoryScope } from '@game/gameplay/vehicles/ai/VehicleTacticalTypes';

describe('VehicleTacticMemory', () => {
  const scope: VehicleTacticMemoryScope = {
    objectiveId: 'hunt',
    objectiveRevision: 1,
    context: 'corridor-a',
  };

  it('recuerda como máximo los últimos 16 intentos', () => {
    const memory = new VehicleTacticMemory();
    for (let index = 0; index < 17; index += 1) {
      memory.recordFailure(
        { ...scope, context: `cell-${index}` },
        'recover',
        'noProgress',
        index,
      );
    }

    const attempts = memory.attemptsAt(16);
    expect(attempts).toHaveLength(16);
    expect(attempts[0].scope.context).toBe('cell-1');
    expect(attempts.at(-1)?.scope.context).toBe('cell-16');
  });

  it('aplica cooldown después de dos fallos equivalentes y conserva penalización', () => {
    const memory = new VehicleTacticMemory();
    memory.recordFailure(scope, 'recover', 'blocked', 0);
    memory.recordFailure(scope, 'recover', 'blocked', 1);

    expect(memory.assess(scope, 'recover', 1)).toEqual({
      failures: 2,
      penalty: 84,
      coolingDown: true,
    });
    expect(memory.assess(scope, 'recover', 9)).toEqual({
      failures: 2,
      penalty: 24,
      coolingDown: false,
    });
    expect(memory.assess(scope, 'recover', 31)).toEqual({
      failures: 0,
      penalty: 0,
      coolingDown: false,
    });
  });

  it('limpia los fallos equivalentes después de cinco metros de progreso real', () => {
    const memory = new VehicleTacticMemory();
    memory.recordFailure(scope, 'recover', 'noProgress', 0);
    memory.recordFailure(scope, 'recover', 'noProgress', 1);

    expect(memory.recordProgress(scope, 2, 2)).toBe(false);
    expect(memory.recordProgress(scope, 2.9, 3)).toBe(false);
    expect(memory.recordProgress(scope, 0.1, 4)).toBe(true);
    expect(memory.assess(scope, 'recover', 4).failures).toBe(0);
  });

  it('no mezcla fallos de otra revisión u otro obstáculo', () => {
    const memory = new VehicleTacticMemory();
    memory.recordFailure(scope, 'recover', 'blocked', 0);
    memory.recordFailure(
      { ...scope, objectiveRevision: 2 },
      'recover',
      'blocked',
      1,
    );
    memory.recordFailure(
      { ...scope, context: 'corridor-b' },
      'recover',
      'blocked',
      2,
    );

    expect(memory.assess(scope, 'recover', 2).failures).toBe(1);
  });
});
