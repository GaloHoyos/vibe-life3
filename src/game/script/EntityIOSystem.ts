import type { ConnectionParam, EntityConnection } from './EntityIOTypes';
import type { EntityClassId } from './EntityCatalog';
import type { ActivatorRef } from './ActivatorRef';

export type { ActivatorRef } from './ActivatorRef';

export interface InputArgs {
  param?: ConnectionParam;
  activator: ActivatorRef;
  /** Targetname de la entidad que emitió el output (`!caller`). */
  caller: string;
}

/**
 * Identidad de un emisor de outputs. `key` distingue instancias aunque varias
 * compartan targetname; `name` es el nombre visible para `!self`/`!caller`.
 * Un string sigue siendo aceptado como shorthand key=name.
 */
export interface EntityOutputSource {
  readonly key: string;
  readonly name: string;
}

export type EntityOutputSourceRef = string | EntityOutputSource;

/** Contrato de una entidad que puede recibir inputs por targetname. */
export interface EntityHandle {
  /** Identidad exacta para targets procedurales como `!self`; default = name. */
  readonly key?: string;
  readonly name: string;
  readonly classId: EntityClassId;
  acceptInput(input: string, args: InputArgs): void;
  update?(delta: number): void;
}

interface ConnectionRuntime {
  readonly def: EntityConnection;
  firesLeft: number;
}

interface PendingDispatch {
  source: EntityOutputSource;
  target: ResolvedTarget;
  input: string;
  param?: ConnectionParam;
  activator: ActivatorRef;
  dueAt: number;
  serial: number;
}

type ResolvedTarget =
  | { readonly kind: 'name'; readonly name: string }
  | { readonly kind: 'exact'; readonly key: string; readonly fallbackName: string };

/** Cota de profundidad para cadenas de delay-0 (evita stack overflow por ciclos). */
const MAX_IMMEDIATE_DEPTH = 64;

/**
 * Dispatcher data-driven de entity I/O. Los inputs se resuelven por targetname
 * (fan-out y comodines), mientras las conexiones salientes pertenecen a una
 * instancia concreta, como en Source. Los delays preservan el orden del mapa y
 * las operaciones asíncronas quedan invalidadas al limpiar el nivel.
 */
export class EntityIOSystem {
  private readonly handles = new Map<string, EntityHandle[]>();
  private readonly handlesByKey = new Map<string, EntityHandle>();
  private readonly updatables: EntityHandle[] = [];
  private readonly connections = new Map<string, ConnectionRuntime[]>();
  private readonly connectedSources = new Set<string>();
  private readonly pending: PendingDispatch[] = [];
  private readonly warned = new Set<string>();
  private immediateDepth = 0;
  private pendingSerial = 0;
  private lifecycle = 0;
  private clock = 0;

  registerEntity(handle: EntityHandle): void {
    const key = handle.key ?? handle.name;
    if (handle.key && this.handlesByKey.has(key)) {
      throw new Error(`[EntityIO] entity key duplicada: '${key}'`);
    }

    // Validar antes de mutar los indices: si un mapa trae una key duplicada,
    // el registro falla de forma atomica y no deja un handle fantasma por name.
    const list = this.handles.get(handle.name);
    if (list) list.push(handle);
    else this.handles.set(handle.name, [handle]);
    // Handles legacy sin key comparten name; el primero sirve como fallback
    // procedural y el target normal continúa haciendo fan-out a todos.
    if (!this.handlesByKey.has(key)) this.handlesByKey.set(key, handle);
    if (handle.update) this.updatables.push(handle);
  }

  /** Registra una sola vez las conexiones de una instancia emisora. */
  registerConnections(
    sourceRef: EntityOutputSourceRef,
    connections: readonly EntityConnection[],
  ): void {
    if (connections.length === 0) return;
    const source = normalizeSource(sourceRef);
    if (this.connectedSources.has(source.key)) return;
    this.connectedSources.add(source.key);
    this.connections.set(
      source.key,
      connections.map((def) => ({
        def,
        firesLeft: def.maxFires ?? Number.POSITIVE_INFINITY,
      })),
    );
  }

  fireOutput(sourceRef: EntityOutputSourceRef, output: string, activator: ActivatorRef): void {
    const source = normalizeSource(sourceRef);
    const conns = this.connections.get(source.key);
    if (!conns) return;
    for (const conn of conns) {
      if (conn.def.output !== output || conn.firesLeft <= 0) continue;
      conn.firesLeft -= 1;
      const target = this.resolveTarget(conn.def.target, source, activator);
      if (target === null) continue;
      const delay = conn.def.delay ?? 0;
      if (delay > 0) {
        this.pending.push({
          source,
          target,
          input: conn.def.input,
          param: conn.def.param,
          activator,
          dueAt: this.clock + delay,
          serial: this.pendingSerial,
        });
        this.pendingSerial += 1;
      } else {
        this.dispatch(source, target, conn.def.input, conn.def.param, activator);
      }
    }
  }

  /**
   * Emite al completar una operación asíncrona. `clear()` invalida el callback,
   * evitando que un spawn del nivel anterior alcance el grafo siguiente.
   */
  fireOutputAfter(
    completion: Promise<unknown>,
    sourceRef: EntityOutputSourceRef,
    output: string,
    activator: ActivatorRef,
    failureOutput?: string,
  ): void {
    const source = normalizeSource(sourceRef);
    const lifecycle = this.lifecycle;
    void completion.then(
      () => {
        if (this.lifecycle === lifecycle) this.fireOutput(source, output, activator);
      },
      (error: unknown) => {
        if (this.lifecycle !== lifecycle) return;
        const detail = error instanceof Error ? error.message : String(error);
        this.warnOnce(
          `async:${source.key}:${output}:${detail}`,
          `[EntityIO] operación asíncrona de '${source.name}' falló antes de '${output}': ${detail}`,
        );
        if (failureOutput) this.fireOutput(source, failureOutput, activator);
      },
    );
  }

  /** Cancela delays originados por una instancia (input `CancelPending`). */
  cancelPendingFrom(sourceRef: EntityOutputSourceRef): void {
    const source = normalizeSource(sourceRef);
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      if (this.pending[i].source.key === source.key) this.pending.splice(i, 1);
    }
  }

  update(delta: number): void {
    this.clock += Math.max(0, delta);
    for (const handle of this.updatables) handle.update?.(delta);

    const due: PendingDispatch[] = [];
    // Extraer primero evita consumir en este frame delays creados por un input
    // que acaba de vencer. El serial conserva el orden definido por el mapper.
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      const entry = this.pending[i];
      if (!entry) continue;
      if (entry.dueAt <= this.clock) {
        this.pending.splice(i, 1);
        due.push(entry);
      }
    }
    due.sort((a, b) => a.dueAt - b.dueAt || a.serial - b.serial);
    for (const entry of due) {
      this.dispatch(entry.source, entry.target, entry.input, entry.param, entry.activator);
    }
  }

  clear(): void {
    this.handles.clear();
    this.handlesByKey.clear();
    this.updatables.length = 0;
    this.connections.clear();
    this.connectedSources.clear();
    this.pending.length = 0;
    this.warned.clear();
    this.immediateDepth = 0;
    this.pendingSerial = 0;
    this.clock = 0;
    this.lifecycle += 1;
  }

  private resolveTarget(
    target: string,
    source: EntityOutputSource,
    activator: ActivatorRef,
  ): ResolvedTarget | null {
    if (target === '!self' || target === '!caller') {
      return { kind: 'exact', key: source.key, fallbackName: source.name };
    }
    if (target === '!activator') {
      if (activator.kind === 'player') {
        return { kind: 'exact', key: '!player', fallbackName: '!player' };
      }
      if (activator.kind === 'entity') {
        return activator.key
          ? { kind: 'exact', key: activator.key, fallbackName: activator.name }
          : { kind: 'name', name: activator.name };
      }
      this.warnOnce(
        `activator:${source.key}`,
        `[EntityIO] '!activator' desde '${source.name}' no es una entidad con nombre; input ignorado`,
      );
      return null;
    }
    if (target === '!player') {
      return { kind: 'exact', key: '!player', fallbackName: '!player' };
    }
    return { kind: 'name', name: target };
  }

  private dispatch(
    source: EntityOutputSource,
    target: ResolvedTarget,
    input: string,
    param: ConnectionParam | undefined,
    activator: ActivatorRef,
  ): void {
    const handles = this.resolveHandles(target);
    const targetLabel = target.kind === 'name' ? target.name : target.fallbackName;
    if (handles.length === 0) {
      this.warnOnce(
        `target:${targetLabel}:${input}`,
        `[EntityIO] target '${targetLabel}' no existe (input '${input}' desde '${source.name}')`,
      );
      return;
    }
    if (this.immediateDepth >= MAX_IMMEDIATE_DEPTH) {
      this.warnOnce(
        `depth:${source.key}`,
        `[EntityIO] cadena de I/O demasiado profunda desde '${source.name}' — abortada`,
      );
      return;
    }
    this.immediateDepth += 1;
    try {
      for (const handle of [...handles]) {
        handle.acceptInput(input, { param, activator, caller: source.name });
      }
    } finally {
      this.immediateDepth -= 1;
    }
  }

  private resolveHandles(target: ResolvedTarget): EntityHandle[] {
    if (target.kind === 'exact') {
      const exact = this.handlesByKey.get(target.key);
      return exact ? [exact] : [];
    }
    if (!target.name.includes('*') && !target.name.includes('?')) {
      return this.handles.get(target.name) ?? [];
    }
    const pattern = globPattern(target.name);
    const matches: EntityHandle[] = [];
    for (const [name, handles] of this.handles) {
      if (pattern.test(name)) matches.push(...handles);
    }
    return matches;
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(message);
  }
}

function normalizeSource(source: EntityOutputSourceRef): EntityOutputSource {
  return typeof source === 'string' ? { key: source, name: source } : source;
}

function globPattern(value: string): RegExp {
  const escaped = value.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}
