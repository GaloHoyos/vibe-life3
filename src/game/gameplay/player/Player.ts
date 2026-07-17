import { Scene, Vector3 } from "three";
import type { AssetManager } from "@engine/assets/AssetManager";
import type { GameEventBus } from "@game/GameEvents";
import type { Input } from "@engine/input/Input";
import type { CameraSystem } from "@engine/render/CameraSystem";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast } from "@engine/physics/Raycast";
import {
  CharacterController,
  type MovementInput,
} from "@engine/physics/character/CharacterController";
import type { Damageable, DamageType } from "@shared/types/lifecycle";
import { PlayerConfig } from "@game/config/gameplay.config";
import type { DifficultyProvider } from "@game/config/difficulty.config";
import type { Controls } from "./Controls";
import { PlayerHealth } from "./PlayerHealth";
import { Stamina } from "./Stamina";
import { WeaponController } from "@game/gameplay/weapons/core/WeaponController";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import type { RocketSystem } from "@game/gameplay/weapons/rocket/RocketSystem";
import type { BoltSystem } from "@game/gameplay/weapons/bolt/BoltSystem";
import type { EnergyBallSystem } from "@game/gameplay/weapons/energyball/EnergyBallSystem";
import type { IceGunSystem } from "@game/gameplay/weapons/ice/IceGunSystem";
import type { PortalGunSystem } from "@game/gameplay/weapons/portal/PortalGunSystem";
import type { PropImpactSystem } from "@game/gameplay/combat/PropImpactSystem";
import {
  OrganicMatterController,
  organicYieldForMass,
  type OrganicMatterHandle,
} from "@game/gameplay/organic/OrganicMatter";

const PLAYER_ORGANIC_MASS = PlayerConfig.collider.mass;
const FULL_ORGANIC_RESTRAINT_COVERAGE = 0.72;
const NO_MOVEMENT: MovementInput = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jumpPressed: false,
  sprintDown: false,
  crouchDown: false,
};

export class Player implements Damageable {
  readonly health: PlayerHealth;
  readonly stamina: Stamina;
  readonly controller: CharacterController;
  readonly weapons: WeaponController;
  private readonly organicMatter: OrganicMatterController;
  private organicRestraintCoverage = 0;

  constructor(
    startPosition: Vector3,
    physics: PhysicsWorld,
    raycast: Raycast,
    assets: AssetManager,
    scene: Scene,
    private readonly eventBus: GameEventBus,
    grenades: GrenadeSystem,
    rockets: RocketSystem,
    bolts: BoltSystem,
    energyBalls: EnergyBallSystem,
    iceGun: IceGunSystem,
    portals: PortalGunSystem,
    propImpacts: PropImpactSystem,
    difficulty?: DifficultyProvider,
  ) {
    this.health = new PlayerHealth(
      eventBus,
      PlayerConfig.vitals.maxHealth,
      PlayerConfig.vitals.armorMax,
      undefined,
      difficulty,
    );
    this.stamina = new Stamina(eventBus);
    this.controller = new CharacterController(physics, {
      position: startPosition,
      radius: PlayerConfig.collider.radius,
      standingHalfHeight: PlayerConfig.collider.standingHalfHeight,
      crouchHalfHeight: PlayerConfig.collider.crouchHalfHeight,
      standingEyeHeight: PlayerConfig.collider.standingEyeHeight,
      crouchEyeHeight: PlayerConfig.collider.crouchEyeHeight,
      walkSpeed: PlayerConfig.movement.walkSpeed,
      sprintSpeed: PlayerConfig.movement.sprintSpeed,
      crouchSpeed: PlayerConfig.movement.crouchSpeed,
      jumpSpeed: PlayerConfig.movement.jumpSpeed,
      groundAccelerate: PlayerConfig.movement.groundAccelerate,
      airAccelerate: PlayerConfig.movement.airAccelerate,
      maxAirWishSpeed: PlayerConfig.movement.maxAirWishSpeed,
      friction: PlayerConfig.movement.friction,
      stopSpeed: PlayerConfig.movement.stopSpeed,
      crouchTransitionTime: PlayerConfig.movement.crouchTransitionTime,
      dynamicPushMass: PlayerConfig.collider.mass,
    });
    physics.registerCollider(this.controller.collider, {
      id: "player",
      kind: "player",
      damageable: this,
    });
    this.weapons = new WeaponController(
      eventBus,
      physics,
      raycast,
      assets,
      scene,
      grenades,
      rockets,
      bolts,
      energyBalls,
      iceGun,
      portals,
      propImpacts,
    );
    this.organicMatter = new OrganicMatterController({
      id: "player",
      characterId: "player",
      radius:
        PlayerConfig.collider.standingHalfHeight +
        PlayerConfig.collider.radius,
      mass: PLAYER_ORGANIC_MASS,
      yieldNodes: organicYieldForMass(PLAYER_ORGANIC_MASS),
      getPosition: (out) => out.copy(this.controller.getPosition()),
      isAlive: () => this.isAlive(),
      setRestraint: (coverage) => {
        this.organicRestraintCoverage = coverage;
        this.controller.setMovementSpeedMultiplier(
          movementScaleForCoverage(coverage),
        );
      },
      // La secuencia de muerte es duena de la camara/cuerpo del jugador. El
      // handle puede agotarse y alimentar al Blob sin desmontarla por debajo.
      onConsumed: () => {},
    });
  }

  update(
    delta: number,
    input: Input,
    controls: Controls,
    cameraSystem: CameraSystem,
    elapsed: number,
  ): void {
    if (this.health.isDead) {
      return;
    }

    const fullyRestrained =
      this.organicRestraintCoverage >= FULL_ORGANIC_RESTRAINT_COVERAGE;
    this.controller.update(
      delta,
      fullyRestrained ? NO_MOVEMENT : readMovement(controls, this.stamina),
      cameraSystem,
    );
    this.applyFallDamage();
    if (!fullyRestrained) {
      this.weapons.update(
        delta,
        input,
        controls,
        cameraSystem,
        elapsed,
        this.controller.getMoveIntensity(),
        this.controller.isGrounded(),
      );
    }
    this.stamina.tick(delta, this.controller.isSprinting());
  }

  /**
   * Render-tick que corre todos los frames, incluso cuando el input est
   * suspendido (F9 debug mouse release). Mantiene el view model actualizado
   * para que los tweaks del debug panel se vean en vivo.
   */
  tickRender(delta: number, cameraSystem: CameraSystem): void {
    this.weapons.tickRender(delta, cameraSystem, this.controller.getMoveIntensity());
  }

  getPosition(): Vector3 {
    return this.controller.getPosition();
  }

  getEyePosition(): Vector3 {
    return this.controller.getEyePosition();
  }

  getMoveIntensity(): number {
    return this.controller.getMoveIntensity();
  }

  isSprinting(): boolean {
    return this.controller.isSprinting();
  }

  isCrouched(): boolean {
    return this.controller.isCrouched();
  }

  dispose(): void {
    this.organicMatter.invalidate();
    this.weapons.dispose();
  }

  getOrganicMatterHandle(): OrganicMatterHandle {
    return this.organicMatter;
  }

  /** Aplica daño por caída si el controller registró un aterrizaje fuerte este frame. */
  private applyFallDamage(): void {
    const impact = this.controller.consumeLandingImpact();
    const fall = PlayerConfig.fallDamage;
    if (impact <= fall.safeSpeed) {
      return;
    }
    const t = Math.min(
      1,
      (impact - fall.safeSpeed) / (fall.fatalSpeed - fall.safeSpeed),
    );
    this.health.takeDamage(Math.round(t * fall.fatalDamage), "fall", undefined, "physics");
  }

  applyDamage(
    amount: number,
    hitDirection?: Vector3,
    _hitPartName?: string,
    _attackerId?: string,
    _hitPoint?: Vector3,
    damageType?: DamageType,
  ): void {
    this.health.takeDamage(amount, "npc", hitDirection, damageType);
  }

  applyKnockback(direction: Vector3, strength: number): void {
    this.controller.applyImpulse(direction, strength);
  }

  isAlive(): boolean {
    return this.health.isAlive();
  }
}

function readMovement(controls: Controls, stamina: Stamina): MovementInput {
  return {
    forward: controls.isDown("moveForward"),
    back: controls.isDown("moveBack"),
    left: controls.isDown("moveLeft"),
    right: controls.isDown("moveRight"),
    jumpPressed: controls.wasPressed("jump"),
    sprintDown: controls.isDown("sprint") && !stamina.isDepleted(),
    crouchDown: controls.isDown("crouch"),
  };
}

function movementScaleForCoverage(coverage: number): number {
  const restraint = Math.min(
    1,
    Math.max(0, coverage) / FULL_ORGANIC_RESTRAINT_COVERAGE,
  );
  const smooth = restraint * restraint * (3 - 2 * restraint);
  return 1 - smooth;
}
