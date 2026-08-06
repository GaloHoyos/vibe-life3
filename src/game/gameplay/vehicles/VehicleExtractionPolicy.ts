export const VEHICLE_EXTRACTION_RESOURCE_WAIT_SECONDS = 30;

export function hasExtractionResourceWaitExpired(
  requestedAtSeconds: number,
  elapsedSeconds: number,
): boolean {
  return (
    Number.isFinite(requestedAtSeconds) &&
    Number.isFinite(elapsedSeconds) &&
    elapsedSeconds - requestedAtSeconds >=
      VEHICLE_EXTRACTION_RESOURCE_WAIT_SECONDS
  );
}

export function recordExtractionActorFailure(
  failedActorIds: Set<string>,
  actorId: string,
): boolean {
  if (failedActorIds.has(actorId)) return false;
  failedActorIds.add(actorId);
  return true;
}
