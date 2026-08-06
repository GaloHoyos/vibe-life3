import type {
  VehicleTacticalDoctrine,
  VehicleTacticalSituation,
  VehicleTacticId,
} from './VehicleTacticalTypes';

export interface VehicleTacticDefinition {
  readonly id: VehicleTacticId;
  applicable(situation: VehicleTacticalSituation): boolean;
  situationUtility(
    situation: VehicleTacticalSituation,
    doctrine: VehicleTacticalDoctrine,
  ): number;
}

export const VEHICLE_TACTIC_CATALOG: readonly VehicleTacticDefinition[] = [
  tactic('follow', canFollow, followUtility),
  tactic('intercept', canIntercept, interceptUtility),
  tactic('attackRun', canAttackRun, attackRunUtility),
  tactic('suppress', canSuppress, suppressUtility),
  tactic('reposition', canReposition, repositionUtility),
  tactic('deploy', canDeploy, deployUtility),
  tactic('search', canSearch, searchUtility),
  tactic('recover', canRecover, recoverUtility),
  tactic('replaceDriver', canReplaceDriver, replaceDriverUtility),
  tactic('switchVehicle', canSwitchVehicle, switchVehicleUtility),
  tactic('continueOnFoot', canContinueOnFoot, continueOnFootUtility),
  tactic('requestExtraction', canRequestExtraction, requestExtractionUtility),
  tactic('abandon', canAbandon, abandonUtility),
];

function tactic(
  id: VehicleTacticId,
  applicable: VehicleTacticDefinition['applicable'],
  situationUtility: VehicleTacticDefinition['situationUtility'],
): VehicleTacticDefinition {
  return { id, applicable, situationUtility };
}

function canOperate(situation: VehicleTacticalSituation): boolean {
  return situation.capabilities.canDrive && situation.capabilities.driverAvailable;
}

function canFollow(situation: VehicleTacticalSituation): boolean {
  return situation.objective?.status === 'active' &&
    situation.objective.kind !== 'hold' &&
    canOperate(situation) &&
    situation.objectiveReachable !== false;
}

function followUtility(situation: VehicleTacticalSituation): number {
  const sourceBonus = {
    overwatch: 30,
    extraction: 24,
    authored: 14,
    autonomous: 4,
  }[situation.objective?.source ?? 'autonomous'];
  const distanceBonus = Math.min(10, (situation.objectiveDistance ?? 0) / 20);
  return sourceBonus + distanceBonus + (situation.routeAvailable ? 4 : 0);
}

function canIntercept(situation: VehicleTacticalSituation): boolean {
  const threat = situation.threat;
  return canOperate(situation) &&
    threat !== null &&
    (threat.mobility === 'vehicle' || situation.objective?.kind === 'intercept') &&
    threat.reachableByVehicle !== false;
}

function interceptUtility(
  situation: VehicleTacticalSituation,
  doctrine: VehicleTacticalDoctrine,
): number {
  const threat = situation.threat;
  if (!threat) return 0;
  return (threat.visible ? 18 : 4) +
    (threat.mobility === 'vehicle' ? 18 : 0) +
    (doctrine.ramEnemyVehicles && threat.mobility === 'vehicle' ? 6 : 0);
}

function canAttackRun(situation: VehicleTacticalSituation): boolean {
  const weapon = situation.capabilities.weapon;
  const threat = situation.threat;
  return canOperate(situation) &&
    threat !== null &&
    threat.visible &&
    weapon.operational &&
    weapon.operatorAvailable &&
    threat.reachableByVehicle !== false;
}

/**
 * Tirar en movimiento cuesta puntería, así que sólo gana cuando quedarse quieto
 * es peor: sin traverse hay que apuntar con el casco, y bajo fuego un vehículo
 * detenido es un blanco fijo.
 */
function attackRunUtility(
  situation: VehicleTacticalSituation,
  doctrine: VehicleTacticalDoctrine,
): number {
  const threat = situation.threat;
  if (!threat) return 0;
  const cargoPenalty = doctrine.preserveCargo &&
    situation.capabilities.cargoActorIds.length > 0
    ? 40
    : 0;
  return 14 +
    (situation.capabilities.weapon.traverseAvailable ? 0 : 20) +
    (situation.underFire ? 12 : 0) +
    (threat.mobility === 'vehicle' && doctrine.ramEnemyVehicles ? 6 : 0) -
    cargoPenalty;
}

function canSuppress(situation: VehicleTacticalSituation): boolean {
  const weapon = situation.capabilities.weapon;
  const threat = situation.threat;
  return threat !== null &&
    weapon.operational &&
    weapon.operatorAvailable &&
    weapon.traverseAvailable &&
    threat.lineOfSight &&
    threat.withinWeaponRange;
}

function suppressUtility(situation: VehicleTacticalSituation): number {
  return (situation.threat?.visible ? 22 : 4) +
    (situation.underFire ? 10 : 0) +
    (!situation.capabilities.driverAvailable ? 8 : 0);
}

/**
 * El arma sirve y el blanco está ubicado, pero desde esta pose no entra: falta
 * alcance, la torreta llegó al tope o el casco quedó trabado contra algo.
 */
function canReposition(situation: VehicleTacticalSituation): boolean {
  const weapon = situation.capabilities.weapon;
  const threat = situation.threat;
  return canOperate(situation) &&
    threat !== null &&
    weapon.operational &&
    weapon.operatorAvailable &&
    threat.memoryAgeSeconds <= 6 &&
    threat.reachableByVehicle !== false &&
    (!threat.lineOfSight ||
      !threat.withinWeaponRange ||
      !weapon.traverseAvailable ||
      situation.blockedSeconds >= 1.5);
}

function repositionUtility(situation: VehicleTacticalSituation): number {
  const threat = situation.threat;
  if (!threat) return 0;
  return (threat.lineOfSight ? 0 : 16) +
    (threat.withinWeaponRange ? 0 : 12) +
    (situation.capabilities.weapon.traverseAvailable ? 0 : 10) +
    (situation.underFire ? 8 : 0) +
    Math.min(10, situation.blockedSeconds * 4);
}

function canDeploy(situation: VehicleTacticalSituation): boolean {
  return situation.threat?.mobility === 'foot' &&
    situation.threat.visible &&
    situation.capabilities.deployableActorIds.length > 0 &&
    situation.safeToDismount &&
    situation.deploymentPositionAvailable;
}

function deployUtility(
  situation: VehicleTacticalSituation,
  doctrine: VehicleTacticalDoctrine,
): number {
  const cargoPenalty = doctrine.preserveCargo &&
    situation.capabilities.cargoActorIds.length > 0
    ? 45
    : 0;
  return (doctrine.deployAgainstFootTargets ? 34 : -24) +
    (situation.capabilities.weapon.operational ? 6 : 14) -
    cargoPenalty;
}

function canSearch(situation: VehicleTacticalSituation): boolean {
  const threat = situation.threat;
  return threat !== null &&
    !threat.visible &&
    threat.memoryAgeSeconds <= 8 &&
    (canOperate(situation) || situation.capabilities.canContinueOnFoot);
}

function searchUtility(situation: VehicleTacticalSituation): number {
  return Math.max(0, 20 - (situation.threat?.memoryAgeSeconds ?? 10) * 2);
}

function canRecover(situation: VehicleTacticalSituation): boolean {
  return canOperate(situation) &&
    situation.capabilities.canRecover &&
    (situation.overturned ||
      situation.noProgressSeconds >= 2 ||
      situation.blockedSeconds >= 2);
}

function recoverUtility(situation: VehicleTacticalSituation): number {
  return (situation.overturned ? 32 : 0) +
    Math.min(36, situation.noProgressSeconds * 9) +
    Math.min(20, situation.blockedSeconds * 5) +
    (situation.capabilities.canReverse ? 5 : 0);
}

function canReplaceDriver(situation: VehicleTacticalSituation): boolean {
  return situation.capabilities.canDrive &&
    !situation.capabilities.driverAvailable &&
    situation.capabilities.replacementDriverIds.length > 0;
}

function replaceDriverUtility(situation: VehicleTacticalSituation): number {
  return 30 + Math.min(12, situation.capabilities.replacementDriverIds.length * 4);
}

function canSwitchVehicle(situation: VehicleTacticalSituation): boolean {
  return situation.capabilities.alternativeVehicleIds.length > 0 &&
    (!situation.capabilities.canDrive ||
      situation.healthFraction < 0.3 ||
      situation.noProgressSeconds >= 4);
}

function switchVehicleUtility(situation: VehicleTacticalSituation): number {
  return (!situation.capabilities.canDrive ? 38 : 0) +
    (situation.healthFraction < 0.3 ? 24 : 0) +
    Math.min(18, situation.noProgressSeconds * 3);
}

function canContinueOnFoot(situation: VehicleTacticalSituation): boolean {
  return situation.objective !== null &&
    situation.capabilities.canContinueOnFoot &&
    situation.capabilities.deployableActorIds.length > 0 &&
    (situation.objectiveReachable === false ||
      !situation.capabilities.canDrive ||
      situation.noProgressSeconds >= 4);
}

function continueOnFootUtility(
  situation: VehicleTacticalSituation,
  doctrine: VehicleTacticalDoctrine,
): number {
  const preservePenalty = doctrine.preserveCargo &&
    situation.capabilities.cargoActorIds.length > 0
    ? 36
    : 0;
  return (situation.objectiveReachable === false ? 38 : 0) +
    (!situation.capabilities.canDrive ? 26 : 0) +
    Math.min(20, situation.noProgressSeconds * 3) -
    preservePenalty;
}

function canRequestExtraction(situation: VehicleTacticalSituation): boolean {
  return situation.capabilities.extractionAvailable &&
    (situation.extractionRequested ||
      !situation.capabilities.canDrive ||
      situation.objectiveReachable === false ||
      situation.healthFraction < 0.3);
}

function requestExtractionUtility(situation: VehicleTacticalSituation): number {
  return (situation.extractionRequested ? 48 : 0) +
    (!situation.capabilities.canDrive ? 28 : 0) +
    (situation.capabilities.cargoActorIds.length > 0 ? 22 : 0) +
    (situation.healthFraction < 0.3 ? 18 : 0);
}

function canAbandon(situation: VehicleTacticalSituation): boolean {
  return situation.capabilities.canAbandon &&
    (!situation.capabilities.canDrive ||
      situation.healthFraction < 0.18 ||
      (situation.overturned && !situation.capabilities.canRecover) ||
      situation.noProgressSeconds >= 8);
}

function abandonUtility(
  situation: VehicleTacticalSituation,
  doctrine: VehicleTacticalDoctrine,
): number {
  const riskBonus = (1 - doctrine.riskTolerance) * 20;
  return (!situation.capabilities.canDrive ? 32 : 0) +
    (situation.healthFraction < 0.18 ? 42 : 0) +
    (situation.underFire ? 12 : 0) +
    Math.min(24, situation.noProgressSeconds * 3) +
    riskBonus;
}
