import type { LogicEntityKind } from './EntityIOTypes';

/**
 * Catálogo de outputs/inputs por clase de entidad. Fuente de verdad única que
 * consumen el editor (dropdowns), el sanitize de Workshop y las herramientas de
 * validación. El runtime no valida contra esto (los handles ignoran inputs
 * desconocidos), pero mantenerlo alineado evita conexiones muertas.
 */

export type EntityClassId =
  | 'player'
  | 'trigger'
  | 'door'
  | 'npc'
  | 'sequence'
  | 'vehicle'
  | 'vehicleWaypoint'
  | 'vehicleNavMarker'
  | LogicEntityKind;

/** Tipo del parámetro que un input espera, para renderizar el campo correcto en el editor. */
export type InputParamKind = 'none' | 'string' | 'number' | 'targetName';

export interface EntityOutputDescriptor {
  id: string;
  label: string;
}

export interface EntityInputDescriptor {
  id: string;
  label: string;
  param?: InputParamKind;
}

export interface EntityIODescriptor {
  outputs: readonly EntityOutputDescriptor[];
  inputs: readonly EntityInputDescriptor[];
}

const ENABLE_INPUTS: readonly EntityInputDescriptor[] = [
  { id: 'Enable', label: 'Habilitar' },
  { id: 'Disable', label: 'Deshabilitar' },
  { id: 'Toggle', label: 'Alternar' },
];

export const EntityCatalog: Record<EntityClassId, EntityIODescriptor> = {
  player: {
    outputs: [],
    inputs: [
      { id: 'Kill', label: 'Matar' },
      { id: 'Teleport', label: 'Teletransportar', param: 'targetName' },
    ],
  },
  trigger: {
    outputs: [
      { id: 'OnStartTouch', label: 'Al entrar' },
      { id: 'OnEndTouch', label: 'Al salir' },
    ],
    inputs: ENABLE_INPUTS,
  },
  door: {
    outputs: [
      { id: 'OnOpen', label: 'Al abrir' },
      { id: 'OnClose', label: 'Al cerrar' },
    ],
    inputs: [
      { id: 'Open', label: 'Abrir' },
      { id: 'Close', label: 'Cerrar' },
      { id: 'Toggle', label: 'Alternar' },
    ],
  },
  npc: {
    outputs: [
      { id: 'OnDeath', label: 'Al morir' },
      { id: 'OnDamaged', label: 'Al recibir daño' },
      { id: 'OnEscortArrived', label: 'Al llegar (escolta)' },
    ],
    inputs: [
      { id: 'StartFollowing', label: 'Seguir' },
      { id: 'StopFollowing', label: 'Esperar' },
      { id: 'EscortTo', label: 'Escoltar a', param: 'targetName' },
      { id: 'Teleport', label: 'Teletransportar', param: 'targetName' },
      { id: 'Kill', label: 'Matar' },
    ],
  },
  sequence: {
    outputs: [
      { id: 'OnBegin', label: 'Al comenzar' },
      { id: 'OnArrived', label: 'Al llegar' },
      { id: 'OnEnd', label: 'Al terminar' },
      { id: 'OnCanceled', label: 'Al cancelar' },
    ],
    inputs: [
      { id: 'Start', label: 'Iniciar' },
      { id: 'Cancel', label: 'Cancelar' },
      { id: 'Cue', label: 'Señal (cue)' },
    ],
  },
  vehicle: {
    outputs: [
      { id: 'OnPlayerEntered', label: 'Al entrar el jugador' },
      { id: 'OnPlayerExited', label: 'Al salir el jugador' },
      { id: 'OnStarted', label: 'Al arrancar' },
      { id: 'OnStopped', label: 'Al detenerse' },
      { id: 'OnWaypoint', label: 'Al pasar un waypoint' },
      { id: 'OnDamaged', label: 'Al recibir daño' },
      { id: 'OnDisabled', label: 'Al quedar inutilizado' },
      { id: 'OnDestroyed', label: 'Al destruirse' },
      { id: 'OnCrashed', label: 'Al chocar' },
      { id: 'OnStuck', label: 'Al quedar atascado' },
      { id: 'OnOrderReached', label: 'Al alcanzar una orden' },
      { id: 'OnOrderCompleted', label: 'Al completar una orden' },
      { id: 'OnOrderFailed', label: 'Al fallar una orden' },
      { id: 'OnLandingSelected', label: 'Al elegir dónde aterrizar' },
      { id: 'OnLanded', label: 'Al aterrizar' },
      { id: 'OnLandingFailed', label: 'Al fallar el aterrizaje' },
    ],
    inputs: [
      { id: 'Enable', label: 'Habilitar' },
      { id: 'Disable', label: 'Deshabilitar' },
      { id: 'Lock', label: 'Bloquear' },
      { id: 'Unlock', label: 'Desbloquear' },
      { id: 'TurnOn', label: 'Encender motor' },
      { id: 'TurnOff', label: 'Apagar motor' },
      { id: 'Start', label: 'Iniciar ruta' },
      { id: 'Stop', label: 'Detener ruta' },
      { id: 'SetSpeed', label: 'Fijar velocidad', param: 'number' },
      { id: 'EnableGun', label: 'Habilitar arma' },
      { id: 'DisableGun', label: 'Deshabilitar arma' },
      { id: 'EnableDamage', label: 'Hacer vulnerable' },
      { id: 'DisableDamage', label: 'Hacer invulnerable' },
      { id: 'EnableCrewing', label: 'Ofrecer tripulación IA' },
      { id: 'DisableCrewing', label: 'Retirar oferta de tripulación' },
      { id: 'Attach', label: 'Montar actor', param: 'string' },
      { id: 'Detach', label: 'Desmontar actor', param: 'string' },
      { id: 'SetGoal', label: 'Fijar objetivo', param: 'string' },
      { id: 'ClearGoal', label: 'Limpiar objetivo' },
      { id: 'SetBehavior', label: 'Cambiar comportamiento', param: 'string' },
      { id: 'LandAt', label: 'Aterrizar en', param: 'targetName' },
      { id: 'AbortLanding', label: 'Abortar aterrizaje' },
      { id: 'Repair', label: 'Reparar' },
      { id: 'Crash', label: 'Iniciar choque' },
    ],
  },
  vehicleWaypoint: {
    outputs: [{ id: 'OnPass', label: 'Al pasar' }],
    inputs: [
      { id: 'Enable', label: 'Habilitar' },
      { id: 'Disable', label: 'Deshabilitar' },
      { id: 'SetNext', label: 'Cambiar siguiente', param: 'string' },
      { id: 'SetSpeed', label: 'Fijar velocidad', param: 'number' },
    ],
  },
  vehicleNavMarker: {
    outputs: [],
    inputs: [],
  },
  relay: {
    outputs: [{ id: 'OnTrigger', label: 'Al disparar' }],
    inputs: [
      { id: 'Trigger', label: 'Disparar' },
      ...ENABLE_INPUTS,
      { id: 'CancelPending', label: 'Cancelar pendientes' },
    ],
  },
  auto: {
    outputs: [{ id: 'OnMapSpawn', label: 'Al cargar el mapa' }],
    inputs: [],
  },
  timer: {
    outputs: [{ id: 'OnTimer', label: 'Al vencer' }],
    inputs: [...ENABLE_INPUTS, { id: 'ResetTimer', label: 'Reiniciar' }],
  },
  counter: {
    outputs: [
      { id: 'OnHitMax', label: 'Al llegar al máximo' },
      { id: 'OnChanged', label: 'Al cambiar' },
    ],
    inputs: [
      { id: 'Add', label: 'Sumar', param: 'number' },
      { id: 'Subtract', label: 'Restar', param: 'number' },
      { id: 'SetValue', label: 'Fijar valor', param: 'number' },
      { id: 'Reset', label: 'Reiniciar' },
    ],
  },
  marker: {
    outputs: [],
    inputs: [],
  },
  message: {
    outputs: [],
    inputs: [{ id: 'Show', label: 'Mostrar' }],
  },
  objective: {
    outputs: [],
    inputs: [{ id: 'Apply', label: 'Aplicar' }],
  },
  soundscape: {
    outputs: [],
    inputs: [{ id: 'Activate', label: 'Activar' }],
  },
  ambientSound: {
    outputs: [],
    inputs: [
      { id: 'PlaySound', label: 'Reproducir' },
      { id: 'StopSound', label: 'Detener' },
      { id: 'Toggle', label: 'Alternar' },
    ],
  },
  npcSpawner: {
    outputs: [
      { id: 'OnSpawned', label: 'Al spawnear' },
      { id: 'OnSpawnFailed', label: 'Al fallar el spawn' },
    ],
    inputs: [{ id: 'Spawn', label: 'Spawnear' }],
  },
  levelAction: {
    outputs: [],
    inputs: [{ id: 'Trigger', label: 'Disparar' }],
  },
  changelevel: {
    outputs: [],
    inputs: [{ id: 'Trigger', label: 'Disparar' }],
  },
};

/** Devuelve el descriptor de una clase, o `null` si no está en el catálogo. */
export function descriptorFor(classId: string): EntityIODescriptor | null {
  return (EntityCatalog as Record<string, EntityIODescriptor | undefined>)[classId] ?? null;
}
