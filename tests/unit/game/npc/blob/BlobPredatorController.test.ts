import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import type { Faction } from "@engine/ai/Faction";
import type { Damageable } from "@shared/types/lifecycle";
import { BlobConfig } from "@game/config/blob.config";
import { OrganicMatterController } from "@game/gameplay/organic/OrganicMatter";
import {
  BlobPredatorController,
  type BlobFeedingBody,
} from "@game/npc/blob/BlobPredatorController";
import type { NpcLocomotionHandle } from "@game/npc/brain/NpcBrainContext";
import type { ActorSnapshot, AiFrameContext } from "@game/npc/core/INpc";

describe("BlobPredatorController", () => {
  it("prioriza un cadaver, ignora otros Blobs y materia no organica, y navega hacia el claim", () => {
    const core = new Vector3();
    const body = new FeedingBodyFake();
    const predator = new BlobPredatorController("hunter", body, () => core.clone());
    const locomotion = locomotionFixture();
    const livingPlayer = preyFixture({
      id: "player",
      characterId: "player",
      faction: "player",
      position: new Vector3(2, 0, 0),
    });
    const corpse = preyFixture({
      id: "corpse",
      position: new Vector3(12, 0, 0),
      alive: false,
    });
    const otherBlob = preyFixture({
      id: "blob-friend",
      characterId: "blob",
      faction: "blob",
      position: new Vector3(1, 0, 0),
      alive: false,
    });
    const robot = nonOrganicActor("manhack", new Vector3(0.5, 0, 0));
    const ctx = frame(livingPlayer.actor, [robot, otherBlob.actor, corpse.actor]);

    const selected = predator.update(ctx, locomotion.handle);

    expect(selected?.id).toBe("corpse");
    expect(corpse.matter.isClaimedBy("hunter")).toBe(true);
    expect(livingPlayer.matter.isClaimedBy("hunter")).toBe(false);
    expect(otherBlob.matter.isClaimedBy("hunter")).toBe(false);
    expect(predator.getState()).toBe("blob-approaching");
    expect(locomotion.moveTo).toHaveBeenCalledTimes(1);
    expect(locomotion.lastMove).toEqual(corpse.position);
    expect(locomotion.lastGait).toBe("walk");
    expect(body.clearFeedingTarget).toHaveBeenCalledTimes(1);
  });

  it("abandona el cadaver pero termina un agresor antes de cambiar al siguiente", () => {
    const body = new FeedingBodyFake();
    body.coverage = 1;
    const predator = new BlobPredatorController(
      "hunter",
      body,
      () => new Vector3(),
    );
    const locomotion = locomotionFixture();
    const corpse = preyFixture({
      id: "corpse",
      position: new Vector3(1, 0, 0),
      alive: false,
    });
    const attacker = preyFixture({
      id: "attacker",
      position: new Vector3(1.4, 0, 0),
    });
    const secondAttacker = preyFixture({
      id: "second-attacker",
      position: new Vector3(1.2, 0, 0.2),
    });
    const ctx = frame(nonOrganicPlayer(), [
      corpse.actor,
      attacker.actor,
      secondAttacker.actor,
    ]);

    tick(
      predator,
      ctx,
      locomotion.handle,
      BlobConfig.predator.embraceRampSeconds + 0.2,
    );
    expect(predator.getState()).toBe("blob-digesting");
    expect(corpse.matter.isClaimedBy("hunter")).toBe(true);

    const selected = predator.update(
      { ...ctx, delta: 0.1 },
      locomotion.handle,
      attacker.actor,
    );

    expect(selected?.id).toBe("attacker");
    expect(corpse.matter.isClaimedBy("hunter")).toBe(false);
    expect(corpse.setDigestionProgress).toHaveBeenLastCalledWith(0);
    expect(corpse.onConsumed).not.toHaveBeenCalled();
    expect(attacker.matter.isClaimedBy("hunter")).toBe(true);

    const stillSelected = predator.update(
      { ...ctx, delta: 0.1 },
      locomotion.handle,
      secondAttacker.actor,
    );
    expect(stillSelected?.id).toBe("attacker");
    expect(attacker.matter.isClaimedBy("hunter")).toBe(true);
    expect(secondAttacker.matter.isClaimedBy("hunter")).toBe(false);

    attacker.actor.entity.applyDamage(1000);
    const selectedAfterKill = predator.update(
      { ...ctx, delta: 0.1 },
      locomotion.handle,
      secondAttacker.actor,
    );
    expect(selectedAfterKill?.id).toBe("second-attacker");
    expect(attacker.matter.isClaimedBy("hunter")).toBe(false);
    expect(secondAttacker.matter.isClaimedBy("hunter")).toBe(true);
  });

  it("abraza progresivamente e inflige dano solo con cobertura fisica suficiente", () => {
    const body = new FeedingBodyFake();
    body.coverage = BlobConfig.predator.damageCoverageThreshold - 0.01;
    const predator = new BlobPredatorController(
      "hunter",
      body,
      () => new Vector3(),
    );
    const locomotion = locomotionFixture();
    const victim = preyFixture({
      id: "victim",
      position: new Vector3(1, 0, 0),
      health: 100,
    });
    const ctx = frame(nonOrganicPlayer(), [victim.actor]);

    tick(predator, ctx, locomotion.handle, 3);

    expect(predator.getState()).toBe("blob-embracing");
    expect(body.setFeedingTarget).toHaveBeenCalled();
    expect(victim.setRestraint).toHaveBeenLastCalledWith(body.coverage);
    expect(victim.damage).not.toHaveBeenCalled();

    body.coverage = 1;
    predator.update({ ...ctx, delta: 0.1 }, locomotion.handle);
    expect(victim.damage).toHaveBeenCalledTimes(1);
    expect(victim.damage).toHaveBeenCalledWith(
      BlobConfig.predator.damagePerPulse,
      expect.any(Vector3),
      undefined,
      "hunter",
      expect.any(Vector3),
      "melee",
    );

    // La cobertura no convierte el pulso en dano por frame.
    predator.update({ ...ctx, delta: 0.1 }, locomotion.handle);
    expect(victim.damage).toHaveBeenCalledTimes(1);
    expect(locomotion.stop).toHaveBeenCalled();
    expect(locomotion.face).toHaveBeenCalled();
  });

  it("mantiene el abrazo ante empujes y solo lo reinicia fuera del margen", () => {
    const body = new FeedingBodyFake();
    body.coverage = 0.4;
    const predator = new BlobPredatorController(
      "hunter",
      body,
      () => new Vector3(),
    );
    const locomotion = locomotionFixture();
    const victim = preyFixture({
      id: "moving-victim",
      position: new Vector3(
        BlobConfig.predator.coreEmbraceDistance + 0.3,
        0,
        0,
      ),
    });
    const ctx = frame(nonOrganicPlayer(), [victim.actor]);

    predator.update(ctx, locomotion.handle);
    expect(predator.getState()).toBe("blob-embracing");

    victim.position.x =
      BlobConfig.predator.coreEmbraceDistance +
      victim.actor.radius +
      BlobConfig.predator.embraceReleasePadding * 0.75;
    predator.update(ctx, locomotion.handle);
    expect(predator.getState()).toBe("blob-embracing");

    victim.position.x =
      BlobConfig.predator.coreEmbraceDistance +
      victim.actor.radius +
      BlobConfig.predator.embraceReleasePadding +
      0.1;
    predator.update(ctx, locomotion.handle);
    expect(predator.getState()).toBe("blob-approaching");
  });

  it("mata a un zombie sano en cuatro pulsos sin demorar el abrazo", () => {
    const body = new FeedingBodyFake();
    body.coverage = 1;
    const predator = new BlobPredatorController(
      "hunter",
      body,
      () => new Vector3(),
    );
    const locomotion = locomotionFixture();
    const zombie = preyFixture({
      id: "zombie-victim",
      position: new Vector3(1, 0, 0),
      health: 50,
    });
    const ctx = frame(nonOrganicPlayer(), [zombie.actor]);

    tick(predator, ctx, locomotion.handle, 1.6);

    expect(zombie.matter.isAlive()).toBe(false);
    expect(zombie.damage).toHaveBeenCalledTimes(4);
  });

  it("atrae el cadaver hacia el core antes de alcanzar cobertura de digestion", () => {
    const body = new FeedingBodyFake();
    body.coverage = 0;
    const core = new Vector3(2, 1, -1);
    const predator = new BlobPredatorController(
      "hunter",
      body,
      () => core.clone(),
    );
    const locomotion = locomotionFixture();
    const corpse = preyFixture({
      id: "corpse",
      position: new Vector3(3, 0, -1),
      alive: false,
    });

    predator.update(frame(nonOrganicPlayer(), [corpse.actor]), locomotion.handle);

    expect(corpse.pullToward).toHaveBeenCalledTimes(1);
    expect(corpse.pullToward).toHaveBeenCalledWith(
      new Vector3(2, 1 + BlobConfig.predator.corpsePullCoreHeight, -1),
      0.1,
      {
        positionGain: BlobConfig.predator.corpsePullPositionGain,
        maxSpeed: BlobConfig.predator.corpsePullMaxSpeed,
        acceleration: BlobConfig.predator.corpsePullAcceleration,
      },
    );
    expect(corpse.setDigestionProgress).not.toHaveBeenCalled();
    expect(predator.getState()).toBe("blob-embracing");
  });

  it("conserva la presa al morir, la digiere visiblemente y suma su biomasa", () => {
    const body = new FeedingBodyFake();
    body.coverage = 0;
    const predator = new BlobPredatorController(
      "hunter",
      body,
      () => new Vector3(),
    );
    const locomotion = locomotionFixture();
    const victim = preyFixture({
      id: "victim",
      position: new Vector3(1, 0, 0),
      health: BlobConfig.predator.damagePerPulse,
      yieldNodes: 6,
    });
    const ctx = frame(nonOrganicPlayer(), [victim.actor]);

    // Completa el tiempo de abrazo, pero el doble fisico aun no rodeo la presa.
    tick(
      predator,
      ctx,
      locomotion.handle,
      BlobConfig.predator.embraceRampSeconds + 0.2,
    );
    expect(victim.damage).not.toHaveBeenCalled();

    body.coverage = 1;
    predator.update({ ...ctx, delta: 0.1 }, locomotion.handle);
    expect(victim.matter.isAlive()).toBe(false);
    expect(victim.matter.isClaimedBy("hunter")).toBe(true);
    expect(predator.getState()).toBe("blob-digesting");

    // Once digestion starts, transient loss of node contact must not leave a
    // permanently shrunken corpse claimed by the Blob.
    body.coverage = 0;
    tick(
      predator,
      ctx,
      locomotion.handle,
      BlobConfig.predator.digestionSeconds + 0.3,
    );

    expect(victim.setDigestionProgress).toHaveBeenCalled();
    expect(victim.setDigestionProgress).toHaveBeenLastCalledWith(1);
    expect(victim.onConsumed).toHaveBeenCalledTimes(1);
    expect(victim.matter.isAvailable()).toBe(false);
    expect(body.addOrganicMass).toHaveBeenCalledTimes(1);
    expect(body.addOrganicMass).toHaveBeenCalledWith(6);
    expect(predator.getState()).toBe("blob-searching");
    expect(body.clearFeedingTarget).toHaveBeenCalled();
  });

  it("libera el claim al disponer el depredador o cuando la presa queda demasiado lejos", () => {
    const near = preyFixture({ id: "near", position: new Vector3(5, 0, 0) });
    const firstBody = new FeedingBodyFake();
    const first = new BlobPredatorController(
      "hunter-a",
      firstBody,
      () => new Vector3(),
    );
    const firstLocomotion = locomotionFixture();
    const firstCtx = frame(nonOrganicPlayer(), [near.actor]);
    first.update(firstCtx, firstLocomotion.handle);
    expect(near.matter.isClaimedBy("hunter-a")).toBe(true);

    first.dispose();
    first.dispose();
    expect(near.matter.isClaimedBy("hunter-a")).toBe(false);
    expect(near.matter.tryClaim("replacement")).toBe(true);
    near.matter.release("replacement");
    expect(firstBody.clearFeedingTarget).toHaveBeenCalled();

    const moving = preyFixture({ id: "moving", position: new Vector3(5, 0, 0) });
    const secondBody = new FeedingBodyFake();
    const second = new BlobPredatorController(
      "hunter-b",
      secondBody,
      () => new Vector3(),
    );
    const secondLocomotion = locomotionFixture();
    const secondCtx = frame(nonOrganicPlayer(), [moving.actor]);
    second.update(secondCtx, secondLocomotion.handle);
    expect(moving.matter.isClaimedBy("hunter-b")).toBe(true);

    moving.position.set(BlobConfig.predator.disengageRange + 2, 0, 0);
    second.update({ ...secondCtx, delta: 0.1 }, secondLocomotion.handle);

    expect(moving.matter.isClaimedBy("hunter-b")).toBe(false);
    expect(moving.matter.tryClaim("replacement")).toBe(true);
    expect(second.getState()).toBe("blob-searching");
    expect(secondLocomotion.stop).toHaveBeenCalled();
    expect(secondBody.clearFeedingTarget).toHaveBeenCalled();
  });
});

class FeedingBodyFake implements BlobFeedingBody {
  coverage = 1;
  readonly setFeedingTarget = vi.fn(
    (_position: Vector3, _radius: number, _requestedCoverage01: number) => {},
  );
  readonly clearFeedingTarget = vi.fn(() => {});
  readonly addOrganicMass = vi.fn((_nodeCount: number) => {});

  getFeedingCoverage(): number {
    return this.coverage;
  }
}

function preyFixture(options: {
  id: string;
  characterId?: string;
  faction?: Faction;
  position: Vector3;
  alive?: boolean;
  health?: number;
  yieldNodes?: number;
}) {
  let alive = options.alive ?? true;
  let health = options.health ?? 100;
  const position = options.position.clone();
  const setRestraint = vi.fn();
  const pullToward = vi.fn();
  const setDigestionProgress = vi.fn();
  const onConsumed = vi.fn();
  const matter = new OrganicMatterController({
    id: options.id,
    characterId: options.characterId ?? "zombie",
    radius: 0.4,
    mass: 60,
    yieldNodes: options.yieldNodes ?? 5,
    getPosition: (out) => out.copy(position),
    isAlive: () => alive,
    setRestraint,
    pullToward,
    setDigestionProgress,
    onConsumed,
  });
  const damage = vi.fn((amount: number) => {
    health -= amount;
    if (health <= 0) alive = false;
  });
  const entity: Damageable = {
    applyDamage: damage,
    isAlive: () => matter.isAlive(),
  };
  const actor: ActorSnapshot = {
    id: options.id,
    characterId: options.characterId ?? "zombie",
    position: position.clone(),
    faction: options.faction ?? "zombies",
    entity,
    isAlive: alive,
    radius: 0.4,
    organicMatter: matter,
  };
  return {
    actor,
    matter,
    position,
    damage,
    setRestraint,
    pullToward,
    setDigestionProgress,
    onConsumed,
  };
}

function nonOrganicPlayer(): ActorSnapshot {
  return nonOrganicActor("player", new Vector3(100, 0, 100), "player", "player");
}

function nonOrganicActor(
  id: string,
  position: Vector3,
  faction: Faction = "combine",
  characterId = id,
): ActorSnapshot {
  return {
    id,
    characterId,
    position: position.clone(),
    faction,
    entity: {
      applyDamage: vi.fn(),
      isAlive: () => true,
    },
    isAlive: true,
    radius: 0.35,
  };
}

function locomotionFixture() {
  let lastMove: Vector3 | null = null;
  let lastGait: "walk" | "sprint" | undefined;
  const moveTo = vi.fn(
    (target: Vector3, options?: { gait?: "walk" | "sprint" }) => {
      lastMove = target.clone();
      lastGait = options?.gait;
    },
  );
  const stop = vi.fn();
  const face = vi.fn();
  const handle: NpcLocomotionHandle = {
    moveTo,
    stop,
    distanceToTarget: () => Infinity,
    hasPath: () => false,
    isStuck: () => false,
    face,
    leap: vi.fn(),
    isLeaping: () => false,
  };
  return {
    handle,
    moveTo,
    stop,
    face,
    get lastMove() {
      return lastMove;
    },
    get lastGait() {
      return lastGait;
    },
  };
}

function frame(
  player: ActorSnapshot,
  npcs: ActorSnapshot[],
  delta = 0.1,
): AiFrameContext {
  return {
    delta,
    elapsed: 0,
    aiLod: "near",
    player,
    npcs,
    tacticalMap: {} as AiFrameContext["tacticalMap"],
    squadDirector: {} as AiFrameContext["squadDirector"],
    eventBus: {} as AiFrameContext["eventBus"],
  };
}

function tick(
  predator: BlobPredatorController,
  ctx: AiFrameContext,
  locomotion: NpcLocomotionHandle,
  seconds: number,
): void {
  const frames = Math.ceil(seconds / 0.1);
  for (let index = 0; index < frames; index += 1) {
    predator.update({ ...ctx, delta: 0.1, elapsed: index * 0.1 }, locomotion);
  }
}
