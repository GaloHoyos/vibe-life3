export type NavSurface = 'terrain' | 'floor' | 'roof' | 'stair';

/**
 * Celda navegable en el `NavSpace`. Storage CSR: cada celda apunta a un slice
 * contiguo del array global de edges (`NavSpace.edges`) via `edgeStart` y
 * `edgeCount`. Esto evita allocations per-frame y mantiene el grafo
 * cache-friendly durante A*.
 *
 * Las celdas exteriores cubren terreno + staticBoxes caminables (grid 1.5 m).
 * Las celdas interiores cubren rooms (grid 0.75 m) y traen los ids del room
 * y del building dueno para queries semanticas rapidas sin pasar por
 * `BuildingRegistry`.
 */
export interface NavCell {
  index: number;
  center: [number, number, number];
  surface: NavSurface;
  roomId: string | null;
  buildingId: string | null;
  componentId: number;
  edgeStart: number;
  edgeCount: number;
}

/**
 * Edge dirigido entre dos celdas. Si `portalIndex >= 0`, el cruce usa el
 * portal correspondiente y su tipo decide quien lo puede usar (jump portals
 * solo si el preset declara `canJump`, etc.).
 */
export interface NavEdge {
  toCell: number;
  cost: number;
  portalIndex: number;
}
