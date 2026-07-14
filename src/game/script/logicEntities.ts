import type { EntityHandle, EntityIOSystem, InputArgs } from './EntityIOSystem';
import type { ConnectionParam, LogicEntityDefinition } from './EntityIOTypes';
import { effectiveName } from './EntityIOTypes';

type RelayDef = Extract<LogicEntityDefinition, { kind: 'relay' }>;
type AutoDef = Extract<LogicEntityDefinition, { kind: 'auto' }>;
type TimerDef = Extract<LogicEntityDefinition, { kind: 'timer' }>;
type CounterDef = Extract<LogicEntityDefinition, { kind: 'counter' }>;

function numParam(param: ConnectionParam | undefined, fallback: number): number {
  if (typeof param === 'number') return param;
  if (typeof param === 'string') {
    const parsed = Number(param);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

/** logic_relay: reenvía `Trigger`→`OnTrigger`; deshabilitado rompe la cadena. */
export function createRelayHandle(def: RelayDef, io: EntityIOSystem): EntityHandle {
  const name = effectiveName(def);
  const source = { key: def.id, name };
  let enabled = !def.startDisabled;
  let consumed = false;
  let lockRemaining = 0;
  const retriggerLock = Math.max(
    0.001,
    ...((def.connections ?? [])
      .filter((connection) => connection.output === 'OnTrigger')
      .map((connection) => Math.max(0, connection.delay ?? 0) + 0.001)),
  );
  return {
    key: def.id,
    name,
    classId: 'relay',
    acceptInput(input: string, args: InputArgs): void {
      switch (input) {
        case 'Trigger':
          if (!enabled || consumed || lockRemaining > 0) return;
          io.fireOutput(source, 'OnTrigger', args.activator);
          if (def.triggerOnce) {
            consumed = true;
            enabled = false;
          } else if (!def.allowFastRetrigger) {
            lockRemaining = retriggerLock;
          }
          return;
        case 'Enable':
          enabled = true;
          return;
        case 'Disable':
          enabled = false;
          return;
        case 'Toggle':
          enabled = !enabled;
          return;
        case 'CancelPending':
          io.cancelPendingFrom(source);
          lockRemaining = 0;
          return;
      }
    },
    update(delta: number): void {
      lockRemaining = Math.max(0, lockRemaining - Math.max(0, delta));
    },
  };
}

/** logic_auto: dispara `OnMapSpawn` una vez, en el primer `update` tras cargar. */
export function createAutoHandle(def: AutoDef, io: EntityIOSystem): EntityHandle {
  const name = effectiveName(def);
  const source = { key: def.id, name };
  let fired = false;
  return {
    key: def.id,
    name,
    classId: 'auto',
    acceptInput(): void {},
    update(): void {
      if (fired) return;
      fired = true;
      io.fireOutput(source, 'OnMapSpawn', {
        kind: 'entity',
        key: source.key,
        name: source.name,
      });
    },
  };
}

/** logic_timer: dispara `OnTimer` cada `interval` segundos mientras esté habilitado. */
export function createTimerHandle(def: TimerDef, io: EntityIOSystem): EntityHandle {
  const name = effectiveName(def);
  const source = { key: def.id, name };
  const interval = Math.max(0.01, def.interval);
  let enabled = !def.startDisabled;
  let elapsed = 0;
  return {
    key: def.id,
    name,
    classId: 'timer',
    acceptInput(input: string): void {
      switch (input) {
        case 'Enable':
          if (!enabled) elapsed = 0;
          enabled = true;
          return;
        case 'Disable':
          enabled = false;
          return;
        case 'Toggle':
          enabled = !enabled;
          if (enabled) elapsed = 0;
          return;
        case 'ResetTimer':
          elapsed = 0;
          return;
      }
    },
    update(delta: number): void {
      if (!enabled) return;
      elapsed += delta;
      // Un solo disparo por update aunque el frame sea largo: evita ráfagas.
      if (elapsed >= interval) {
        elapsed -= interval;
        io.fireOutput(source, 'OnTimer', {
          kind: 'entity',
          key: source.key,
          name: source.name,
        });
      }
    },
  };
}

/** math_counter: `Add`/`Subtract` mueven el valor; `OnHitMax` dispara una vez hasta `Reset`. */
export function createCounterHandle(def: CounterDef, io: EntityIOSystem): EntityHandle {
  const name = effectiveName(def);
  const source = { key: def.id, name };
  let value = def.startValue ?? 0;
  let hitMax = false;
  return {
    key: def.id,
    name,
    classId: 'counter',
    acceptInput(input: string, args: InputArgs): void {
      switch (input) {
        case 'Add':
          value += numParam(args.param, 1);
          break;
        case 'Subtract':
          value -= numParam(args.param, 1);
          break;
        case 'SetValue':
          value = numParam(args.param, 0);
          break;
        case 'Reset':
          value = def.startValue ?? 0;
          hitMax = false;
          io.fireOutput(source, 'OnChanged', args.activator);
          return;
        default:
          return;
      }
      io.fireOutput(source, 'OnChanged', args.activator);
      if (!hitMax && value >= def.max) {
        hitMax = true;
        io.fireOutput(source, 'OnHitMax', args.activator);
      }
    },
  };
}
