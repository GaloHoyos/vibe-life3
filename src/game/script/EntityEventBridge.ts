import type { GameEventBus } from '@game/GameEvents';
import type {
  ActivatorRef,
  EntityIOSystem,
  EntityOutputSource,
} from './EntityIOSystem';

/** Resuelve ids de runtime a la identidad exacta de su emisor I/O. */
export interface EntitySourceResolver {
  triggerSource(id: string): EntityOutputSource | null;
  doorSource(id: string): EntityOutputSource | null;
  npcSource(id: string): EntityOutputSource | null;
}

/** Traduce eventos del juego a outputs preservando caller y activator. */
export class EntityEventBridge {
  private readonly disposers: Array<() => void> = [];

  constructor(
    eventBus: GameEventBus,
    private readonly io: EntityIOSystem,
    private readonly resolver: EntitySourceResolver,
  ) {
    this.disposers.push(
      eventBus.on('trigger.entered', ({ id }) => {
        const source = this.resolver.triggerSource(id);
        if (source) this.io.fireOutput(source, 'OnStartTouch', { kind: 'player' });
      }),
      eventBus.on('trigger.exited', ({ id }) => {
        const source = this.resolver.triggerSource(id);
        if (source) this.io.fireOutput(source, 'OnEndTouch', { kind: 'player' });
      }),
      eventBus.on('door.opened', ({ id, open, activator }) => {
        const source = this.resolver.doorSource(id);
        if (!source) return;
        this.io.fireOutput(
          source,
          open ? 'OnOpen' : 'OnClose',
          activator ?? entityActivator(source),
        );
      }),
      eventBus.on('npc.killed', ({ id, attackerId }) => {
        const source = this.resolver.npcSource(id);
        if (source) this.io.fireOutput(source, 'OnDeath', this.resolveActivator(attackerId));
      }),
      eventBus.on('npc.damaged', ({ id, attackerId }) => {
        const source = this.resolver.npcSource(id);
        if (source) this.io.fireOutput(source, 'OnDamaged', this.resolveActivator(attackerId));
      }),
    );
  }

  dispose(): void {
    this.disposers.forEach((dispose) => dispose());
    this.disposers.length = 0;
  }

  private resolveActivator(attackerId: string | undefined): ActivatorRef {
    if (!attackerId) return { kind: 'none' };
    if (attackerId === 'player') return { kind: 'player' };
    const source = this.resolver.npcSource(attackerId);
    return source ? entityActivator(source) : { kind: 'none' };
  }
}

function entityActivator(source: EntityOutputSource): ActivatorRef {
  return { kind: 'entity', key: source.key, name: source.name };
}
