import { describe, expect, it } from 'vitest';
import {
  buildVehicleLaneGraph,
  VehicleLaneGraph,
} from '@game/gameplay/vehicles/ai/VehicleLaneGraph';
import type { VehicleLaneGraphData } from '@game/gameplay/vehicles/ai/VehicleAiTypes';

describe('VehicleLaneGraph', () => {
  it('respeta el sentido único de un carril', () => {
    const graph = new VehicleLaneGraph(buildVehicleLaneGraph([{
      id: 'one-way',
      points: [[0, 0, 0], [0, 0, 10]],
      width: 3,
      direction: 'forward',
      speedLimit: 12,
    }]));
    expect(graph.findRoute([0, 0, 0], [0, 0, 10])?.points).toHaveLength(2);
    expect(graph.findRoute([0, 0, 10], [0, 0, 0])).toBeNull();
  });

  it('no conecta cruces geométricos ni puentes a distinta altura sin endpoints compatibles', () => {
    const data = buildVehicleLaneGraph([
      {
        id: 'east-west',
        points: [[-10, 0, 0], [10, 0, 0]],
        width: 3,
        direction: 'both',
      },
      {
        id: 'north-south-bridge',
        points: [[0, 5, -10], [0, 5, 10]],
        width: 3,
        direction: 'both',
      },
      {
        id: 'stacked-endpoint',
        points: [[10, 5, 0], [20, 5, 0]],
        width: 3,
        direction: 'both',
      },
    ]);
    expect(data.edges.filter((edge) => edge.laneId === null)).toHaveLength(0);
  });

  it('A* elige el coste global menor y conserva sus edges', () => {
    const data: VehicleLaneGraphData = {
      nodes: [
        { id: 'start', position: [0, 0, 0], laneId: 'entry', pointIndex: 0 },
        { id: 'slow', position: [0, 0, 5], laneId: 'slow', pointIndex: 0 },
        { id: 'fast', position: [5, 0, 5], laneId: 'fast', pointIndex: 0 },
        { id: 'goal', position: [0, 0, 10], laneId: 'exit', pointIndex: 0 },
      ],
      edges: [
        edge('start-slow', 'start', 'slow', 5),
        edge('slow-goal', 'slow', 'goal', 5),
        edge('start-fast', 'start', 'fast', 2),
        edge('fast-goal', 'fast', 'goal', 2),
      ],
    };
    const route = new VehicleLaneGraph(data).findRoute([0, 0, 0], [0, 0, 10]);
    expect(route?.nodeIds).toEqual(['start', 'fast', 'goal']);
    expect(route?.edgeIds).toEqual(['start-fast', 'fast-goal']);
    expect(route?.cost).toBe(4);
  });
});

function edge(id: string, from: string, to: string, cost: number) {
  return {
    id,
    from,
    to,
    laneId: 'test',
    length: cost,
    travelCost: cost,
    speedLimit: 10,
    priority: 0,
    width: 3,
    tags: [],
    reservable: false,
  };
}
