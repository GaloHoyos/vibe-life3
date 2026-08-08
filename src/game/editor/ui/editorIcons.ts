import type { EditorEntityKind } from '../EditorDocument';

/**
 * Iconos line-art del editor. Igual que `HudIcons`, son markup SVG estatico y
 * confiable (sin input de usuario): se inyectan via `innerHTML` en un span.
 * Todos usan `stroke="currentColor"` para heredar el color del contenedor CSS.
 */
const PATHS = {
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:
    '<path d="M3 3l18 18"/><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2"/><path d="M9.9 4.24A10.9 10.9 0 0 1 12 4c6.5 0 10 7 10 7a17.8 17.8 0 0 1-3.06 4.06M6.12 6.12A17.9 17.9 0 0 0 2 11s3.5 7 10 7a10.9 10.9 0 0 0 3.06-.43"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  play: '<path d="M7 4l13 8-13 8Z"/>',
  folder: '<path d="M3 6h6l2 2h10v10a1 1 0 0 1-1 1H3Z"/>',
  save: '<path d="M5 3h12l3 3v15H5Z"/><path d="M8 3v6h7V3"/><path d="M8 14h8v5H8Z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  gear:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h11a5 5 0 0 1 0 10h-2"/>',
  redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12H9a5 5 0 0 0 0 10h2"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="1"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
  magnet: '<path d="M6 3v8a6 6 0 0 0 12 0V3"/><path d="M6 3H2v8M18 3h4v8"/>',
  warning: '<path d="M12 3l10 18H2Z"/><path d="M12 10v5M12 18h.01"/>',
  file: '<path d="M6 2h8l6 6v14H6Z"/><path d="M14 2v6h6"/>',
  cube: '<path d="M12 2 3 7v10l9 5 9-5V7Z"/><path d="M3 7l9 5 9-5M12 12v10"/>',
  building: '<rect x="5" y="3" width="14" height="18"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
  house: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
  stairs: '<path d="M3 21V17h5v-4h5V9h5V5"/>',
  door: '<path d="M5 21V3h11v18M5 21h14"/><path d="M13 12h.01"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>',
  person: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21v-1a7 7 0 0 1 14 0v1"/>',
  weapon: '<path d="M3 8h16v4h-7l-2 4H6v-4H3Z"/><path d="M16 10h4"/>',
  ammo: '<path d="M7 19h10"/><path d="M9 19V7l3-4 3 4v12"/><path d="M9 9h6M9 14h6"/>',
  item: '<path d="M3 7 12 3l9 4-9 4Z"/><path d="M3 7v10l9 4 9-4V7"/>',
} as const;

export type EditorIconName = keyof typeof PATHS;

/** Span con un icono SVG inline, listo para anteponer a un label. */
export function iconSpan(name: EditorIconName): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'editor-icon';
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return span;
}

const KIND_ICONS: Record<EditorEntityKind, EditorIconName> = {
  staticBox: 'cube',
  dynamicBox: 'cube',
  door: 'door',
  actionButton: 'bolt',
  npc: 'person',
  weaponPickup: 'weapon',
  itemPickup: 'item',
  ammoPickup: 'ammo',
  charger: 'bolt',
  trigger: 'target',
  explosiveBarrel: 'cube',
  propEntity: 'cube',
  hazardVolume: 'warning',
  vehicle: 'gear',
  vehicleWaypoint: 'target',
  waterVolume: 'grid',
  vehicleNavArea: 'grid',
  vehicleNavLane: 'stairs',
  vehicleNavMarker: 'target',
  checkpoint: 'save',
  building: 'building',
  house: 'house',
  ramp: 'stairs',
  prop: 'cube',
  prebuiltBuilding: 'building',
  logic: 'bolt',
  sequence: 'person',
};

export function entityIcon(kind: EditorEntityKind): HTMLSpanElement {
  return iconSpan(KIND_ICONS[kind]);
}
