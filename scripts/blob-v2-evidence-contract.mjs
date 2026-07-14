export const EVIDENCE_CONTRACT = Object.freeze({
  schemaVersion: 2,
  level: 'blob-test',
  subjectId: 'blob-lab-subject',
  viewport: Object.freeze({ width: 1280, height: 720 }),
  deviceScaleFactor: 1,
  browserSeed: 0xb10b2026,
  organismSeed: 0x51f15e,
  epoch: '2026-07-14T12:00:00.000Z',
  simulationStepSeconds: 1 / 30,
  baselineSettleSteps: 75,
  cameras: Object.freeze({
    turntable: Object.freeze({
      position: Object.freeze([0, 1, -2.5]),
      yaw: 0,
      pitch: 0,
    }),
    witherPocket: Object.freeze({
      position: Object.freeze([26.5, 1.2, -8.5]),
      yaw: 0,
      pitch: 0,
    }),
  }),
  video: Object.freeze({
    sequenceSeconds: 15.2,
    trimWindowSeconds: 14.5,
    minimumSeconds: 10,
    maximumSeconds: 15,
    tickMs: 100,
    stepsPerTick: 3,
  }),
});

const turntable = EVIDENCE_CONTRACT.cameras.turntable;
const witherPocket = EVIDENCE_CONTRACT.cameras.witherPocket;

export const SCREENSHOT_SCENARIOS = Object.freeze([
  shot('idle', 'idle', 8, 'idle'),
  shot('movement', 'movement', 30, 'movement'),
  shot('climb', 'climb', 18, 'climb'),
  shot('grate-flow', 'flow', 18, 'flow'),
  shot('digest', 'digest', 18, 'digest'),
  shot('growth', 'growth', 3, 'growth'),
  shot('breach', 'breach', 6, 'breach'),
  shot('core-exposed', 'core-exposed', 3, 'core-exposed'),
  shot('return', 'split-return', 24, 'return'),
  shot('reattach', 'reattach', 30, 'reattach'),
  shot('wither', 'split-wither', 360, 'wither', witherPocket, 15),
  // ~0.8 s of renderer frames: inside the 1.4 s death transition, before cleanup.
  shot('death', 'death', 0, 'death', turntable, 3, 45),
  shot('freeze', 'freeze', 0, 'freeze'),
  shot('portal', 'portal', 18, 'portal'),
  shot('poses', 'pose', 18, 'poses'),
]);

export const VIDEO_SEQUENCES = Object.freeze([
  video('locomotion-climb', turntable, [
    stage(0, 'movement'),
    stage(5.2, 'climb'),
  ], 'locomotion-climb'),
  video('grate-flow', turntable, [
    stage(0, 'movement'),
    stage(3.2, 'flow'),
  ], 'grate-flow'),
  video('split-return-reattach', turntable, [
    stage(0, 'split-return'),
  ], 'split-return-reattach'),
  video('split-wither', witherPocket, [
    stage(0, 'split-wither'),
  ], 'split-wither'),
]);

export function evaluateScreenshotAssertions(scenario, capture) {
  const assertions = commonScreenshotAssertions(scenario, capture);
  const before = capture.preparation.before;
  const after = capture.preparation.afterScenario;
  const semantic = capture.semanticSnapshot;
  const samples = capture.samples.map((sample) => sample.snapshot);
  const events = capture.finalRuntime.events ?? [];
  const eventTypes = events.map((event) => event.type);
  const fragmentStates = new Set([
    ...samples.flatMap((snapshot) => snapshot.fragments?.map((fragment) => fragment.state) ?? []),
    ...(semantic.fragments?.map((fragment) => fragment.state) ?? []),
  ]);
  const traversalStates = new Set([
    after.traversalState,
    ...samples.map((snapshot) => snapshot.traversalState),
    semantic.traversalState,
  ]);
  const runtimeDiagnostics = [
    capture.preparation.beforeDiagnostics,
    capture.preparation.afterDiagnostics,
    ...capture.samples.map((sample) => sample.diagnostics),
    capture.semanticDiagnostics,
    capture.finalRuntime.blobDiagnostics,
  ].filter(Boolean);

  switch (scenario.expectation) {
    case 'idle':
      add(assertions, 'organism idle', 'Idle', after.organismState, after.organismState === 'Idle');
      add(assertions, 'ground traversal', 'Ground', after.traversalState, after.traversalState === 'Ground');
      break;
    case 'movement': {
      const displacement = distance(before.core.position, semantic.core.position);
      add(assertions, 'hunt locomotion state', 'Hunt', after.organismState, after.organismState === 'Hunt');
      add(assertions, 'core translated', '>= 0.25 m', displacement, displacement >= 0.25);
      add(assertions, 'ground traversal observed', true, traversalStates.has('Ground'), traversalStates.has('Ground'));
      break;
    }
    case 'climb': {
      const rise = particleBounds(semantic).max.y - particleBounds(before).max.y;
      const climbDiagnostics = runtimeDiagnostics.filter(
        (diagnostics) => diagnostics.traversal?.kind === 'climb',
      );
      add(assertions, 'climb traversal observed', true, traversalStates.has('Climb'), traversalStates.has('Climb'));
      add(assertions, 'climbing cells gained height', '>= 0.5 m', rise, rise >= 0.5);
      add(assertions, 'climb link diagnostics', 'blob-debug-climb', climbDiagnostics.map((diagnostics) => diagnostics.traversal.linkId), climbDiagnostics.some((diagnostics) => diagnostics.traversal.linkId === 'blob-debug-climb'));
      add(assertions, 'climb motion diagnostics', true, runtimeDiagnostics.some((diagnostics) => diagnostics.motion?.wantsMove === true && Array.isArray(diagnostics.motion?.target)), runtimeDiagnostics.some((diagnostics) => diagnostics.motion?.wantsMove === true && Array.isArray(diagnostics.motion?.target)));
      add(assertions, 'core held until crossing threshold', true, climbDiagnostics.map((diagnostics) => ({ crossedFraction: diagnostics.traversal.crossedFraction, requiredFraction: diagnostics.traversal.requiredFraction, coreReleased: diagnostics.traversal.coreReleased })), climbDiagnostics.some((diagnostics) => !diagnostics.traversal.coreReleased && diagnostics.traversal.crossedFraction < diagnostics.traversal.requiredFraction));
      break;
    }
    case 'flow': {
      const flowDiagnostics = runtimeDiagnostics.filter(
        (diagnostics) => diagnostics.traversal?.kind === 'flow',
      );
      const maximumAssignments = Math.max(
        0,
        ...flowDiagnostics.map(
          (diagnostics) => Object.keys(diagnostics.traversal.channelAssignments ?? {}).length,
        ),
      );
      add(assertions, 'squeeze traversal observed', true, traversalStates.has('Squeeze'), traversalStates.has('Squeeze'));
      add(assertions, 'flow changed particle bounds', true, boundsChanged(before, semantic, 0.1), boundsChanged(before, semantic, 0.1));
      add(assertions, 'flow link diagnostics', 'blob-debug-flow', flowDiagnostics.map((diagnostics) => diagnostics.traversal.linkId), flowDiagnostics.some((diagnostics) => diagnostics.traversal.linkId === 'blob-debug-flow'));
      add(assertions, 'flow channel assignments', '> 0', maximumAssignments, maximumAssignments > 0);
      add(assertions, 'flow accepted', null, flowDiagnostics.map((diagnostics) => diagnostics.traversal.rejectedReason), flowDiagnostics.some((diagnostics) => diagnostics.traversal.rejectedReason === null));
      break;
    }
    case 'digest':
      add(assertions, 'digest organism state', 'Digest', after.organismState, after.organismState === 'Digest');
      add(assertions, 'digest scripted pose', 'ScriptedPose', after.overrideState, after.overrideState === 'ScriptedPose');
      add(assertions, 'digest pose deformed particles', true, boundsChanged(before, semantic, 0.15), boundsChanged(before, semantic, 0.15));
      break;
    case 'growth': {
      const growthEvent = events.find((event) => event.type === 'biomassChanged' && event.reason === 'consumed');
      add(assertions, 'biomass increased', `> ${before.biomass.total}`, semantic.biomass.total, semantic.biomass.total > before.biomass.total);
      add(assertions, 'growth reached maximum', semantic.biomass.maximum, semantic.biomass.total, semantic.biomass.total === semantic.biomass.maximum);
      add(assertions, 'consumed biomass event', 'biomassChanged:consumed', growthEvent ? `${growthEvent.type}:${growthEvent.reason}` : null, Boolean(growthEvent));
      break;
    }
    case 'breach':
      add(assertions, 'fragment detached', true, semantic.fragments.length > 0, semantic.fragments.length > 0);
      add(assertions, 'open wound present', true, semantic.wounds.some((wound) => wound.state !== 'Closed'), semantic.wounds.some((wound) => wound.state !== 'Closed'));
      add(assertions, 'fragmentDetached event', true, eventTypes.includes('fragmentDetached'), eventTypes.includes('fragmentDetached'));
      break;
    case 'core-exposed':
      add(assertions, 'core exposed', 'Exposed', semantic.core.state, semantic.core.state === 'Exposed');
      add(assertions, 'coreExposed event', true, eventTypes.includes('coreExposed'), eventTypes.includes('coreExposed'));
      break;
    case 'return':
      add(assertions, 'returning fragment observed', true, fragmentStates.has('Returning'), fragmentStates.has('Returning'));
      add(assertions, 'fragmentDetached event', true, eventTypes.includes('fragmentDetached'), eventTypes.includes('fragmentDetached'));
      break;
    case 'reattach': {
      const reattached = eventTypes.includes('fragmentReattached');
      const attachedState = fragmentStates.has('Reattaching') || fragmentStates.has('Attached');
      add(assertions, 'reattach state observed', true, attachedState, attachedState);
      add(assertions, 'fragmentReattached event', true, reattached, reattached);
      break;
    }
    case 'wither':
      add(assertions, 'withering state observed', true, fragmentStates.has('Withering'), fragmentStates.has('Withering'));
      add(assertions, 'dead fragment observed', true, fragmentStates.has('Dead'), fragmentStates.has('Dead'));
      add(assertions, 'fragmentWithered event', true, eventTypes.includes('fragmentWithered'), eventTypes.includes('fragmentWithered'));
      add(assertions, 'biomass lost', '> 0', semantic.biomass.lost, semantic.biomass.lost > 0);
      break;
    case 'death':
      add(assertions, 'dead override', 'Dead', after.overrideState, after.overrideState === 'Dead');
      add(assertions, 'core dead', 'Dead', after.core.state, after.core.state === 'Dead');
      add(assertions, 'core health depleted', 0, after.core.health, after.core.health === 0);
      add(assertions, 'death simulation stopped', before.simulationTime, semantic.simulationTime, semantic.simulationTime === before.simulationTime);
      add(assertions, 'death transition retained for capture', false, capture.finalRuntime.blobDiagnostics?.presentation?.disposed ?? null, capture.finalRuntime.blobDiagnostics?.presentation?.disposed === false);
      break;
    case 'freeze':
      add(assertions, 'frozen override', 'Frozen', after.overrideState, after.overrideState === 'Frozen');
      add(assertions, 'freeze preserved simulation time', before.simulationTime, semantic.simulationTime, semantic.simulationTime === before.simulationTime);
      add(assertions, 'freeze preserved particle bounds', true, !boundsChanged(before, semantic, 1e-6), !boundsChanged(before, semantic, 1e-6));
      break;
    case 'portal':
      add(assertions, 'portal traversal', 'PortalTraverse', after.traversalState, after.traversalState === 'PortalTraverse');
      add(assertions, 'portal scripted pose', 'ScriptedPose', after.overrideState, after.overrideState === 'ScriptedPose');
      add(assertions, 'portal pose deformed particles', true, boundsChanged(before, semantic, 0.15), boundsChanged(before, semantic, 0.15));
      break;
    case 'poses': {
      const beforeSpan = particleBounds(before).span.y;
      const afterSpan = particleBounds(semantic).span.y;
      const poseDiagnostics = runtimeDiagnostics
        .map((diagnostics) => diagnostics.pose)
        .filter((pose) => pose?.active === true);
      add(assertions, 'scripted pose override', 'ScriptedPose', after.overrideState, after.overrideState === 'ScriptedPose');
      add(assertions, 'column increased vertical span', `> ${beforeSpan + 0.5}`, afterSpan, afterSpan > beforeSpan + 0.5);
      add(assertions, 'column pose diagnostics', 'blob-debug-pose:column', poseDiagnostics.map((pose) => `${pose.id}:${pose.kind}`), poseDiagnostics.some((pose) => pose.id === 'blob-debug-pose' && pose.kind === 'column'));
      add(assertions, 'pose targets assigned', '> 0', Math.max(0, ...poseDiagnostics.map((pose) => pose.targetCount)), poseDiagnostics.some((pose) => pose.targetCount > 0));
      add(assertions, 'pose transition progressed', '> 0', Math.max(0, ...poseDiagnostics.map((pose) => pose.progress)), poseDiagnostics.some((pose) => pose.progress > 0));
      break;
    }
  }
  return assertions;
}

export function evaluateVideoAssertions(sequence, capture) {
  const assertions = [];
  const snapshots = capture.samples.map((sample) => sample.snapshot);
  const events = capture.finalRuntime.events ?? [];
  const eventTypes = events.map((event) => event.type);
  const traversalStates = new Set(snapshots.map((snapshot) => snapshot.traversalState));
  const organismStates = new Set(snapshots.map((snapshot) => snapshot.organismState));
  const fragmentStates = new Set(
    snapshots.flatMap((snapshot) => snapshot.fragments.map((fragment) => fragment.state)),
  );
  const runtimeDiagnostics = [
    capture.baselineDiagnostics,
    ...capture.stages.map((stageCapture) => stageCapture.diagnostics),
    ...capture.samples.map((sample) => sample.diagnostics),
    capture.finalRuntime.blobDiagnostics,
  ].filter(Boolean);

  add(
    assertions,
    'trimmed video duration',
    `${EVIDENCE_CONTRACT.video.minimumSeconds}-${EVIDENCE_CONTRACT.video.maximumSeconds} s`,
    capture.video.durationSeconds,
    capture.video.durationSeconds >= EVIDENCE_CONTRACT.video.minimumSeconds &&
      capture.video.durationSeconds <= EVIDENCE_CONTRACT.video.maximumSeconds,
  );
  add(assertions, 'browser page errors', 0, capture.diagnostics.pageErrors.length, capture.diagnostics.pageErrors.length === 0);
  add(
    assertions,
    'deterministic settled baseline',
    EVIDENCE_CONTRACT.baselineSettleSteps * EVIDENCE_CONTRACT.simulationStepSeconds,
    capture.baseline.simulationTime,
    Math.abs(
      capture.baseline.simulationTime -
        EVIDENCE_CONTRACT.baselineSettleSteps * EVIDENCE_CONTRACT.simulationStepSeconds,
    ) <= 1e-8,
  );
  add(
    assertions,
    'runtime telemetry sampled',
    '> 0 simulation samples',
    capture.finalRuntime.telemetry?.simulation?.samples ?? null,
    (capture.finalRuntime.telemetry?.simulation?.samples ?? 0) > 0,
  );
  addPresentationAssertions(assertions, capture.finalRuntime);

  switch (sequence.expectation) {
    case 'locomotion-climb': {
      const maxDisplacement = maximumCoreDisplacement(capture.baseline, snapshots);
      add(assertions, 'movement command captured', true, hasCommand(capture, 'movement'), hasCommand(capture, 'movement'));
      add(assertions, 'climb command captured', true, hasCommand(capture, 'climb'), hasCommand(capture, 'climb'));
      add(assertions, 'hunt locomotion observed', true, organismStates.has('Hunt'), organismStates.has('Hunt'));
      add(assertions, 'climb traversal observed', true, traversalStates.has('Climb'), traversalStates.has('Climb'));
      add(assertions, 'core translated', '>= 0.5 m', maxDisplacement, maxDisplacement >= 0.5);
      add(assertions, 'climb link diagnostics', 'blob-debug-climb', runtimeDiagnostics.map((diagnostics) => diagnostics.traversal?.linkId), runtimeDiagnostics.some((diagnostics) => diagnostics.traversal?.kind === 'climb' && diagnostics.traversal.linkId === 'blob-debug-climb'));
      break;
    }
    case 'grate-flow': {
      const flowDiagnostics = runtimeDiagnostics.filter(
        (diagnostics) => diagnostics.traversal?.kind === 'flow',
      );
      add(assertions, 'flow command captured', true, hasCommand(capture, 'flow'), hasCommand(capture, 'flow'));
      add(assertions, 'squeeze traversal observed', true, traversalStates.has('Squeeze'), traversalStates.has('Squeeze'));
      add(assertions, 'flow link diagnostics', 'blob-debug-flow', flowDiagnostics.map((diagnostics) => diagnostics.traversal.linkId), flowDiagnostics.some((diagnostics) => diagnostics.traversal.linkId === 'blob-debug-flow'));
      add(assertions, 'flow channel assignments', '> 0', Math.max(0, ...flowDiagnostics.map((diagnostics) => Object.keys(diagnostics.traversal.channelAssignments ?? {}).length)), flowDiagnostics.some((diagnostics) => Object.keys(diagnostics.traversal.channelAssignments ?? {}).length > 0));
      break;
    }
    case 'split-return-reattach':
      add(assertions, 'fragment detached event', true, eventTypes.includes('fragmentDetached'), eventTypes.includes('fragmentDetached'));
      add(assertions, 'returning fragment observed', true, fragmentStates.has('Returning'), fragmentStates.has('Returning'));
      add(assertions, 'reattaching/attached fragment observed', true, fragmentStates.has('Reattaching') || fragmentStates.has('Attached'), fragmentStates.has('Reattaching') || fragmentStates.has('Attached'));
      add(assertions, 'fragment reattached event', true, eventTypes.includes('fragmentReattached'), eventTypes.includes('fragmentReattached'));
      break;
    case 'split-wither':
      add(assertions, 'fragment detached event', true, eventTypes.includes('fragmentDetached'), eventTypes.includes('fragmentDetached'));
      add(assertions, 'withering fragment observed', true, fragmentStates.has('Withering'), fragmentStates.has('Withering'));
      add(assertions, 'dead fragment observed', true, fragmentStates.has('Dead'), fragmentStates.has('Dead'));
      add(assertions, 'fragment withered event', true, eventTypes.includes('fragmentWithered'), eventTypes.includes('fragmentWithered'));
      break;
  }
  return assertions;
}

export function summarizeSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    version: snapshot.version,
    simulationTime: snapshot.simulationTime,
    interpolationAlpha: snapshot.interpolationAlpha,
    organismState: snapshot.organismState,
    traversalState: snapshot.traversalState,
    overrideState: snapshot.overrideState,
    biomass: snapshot.biomass,
    core: snapshot.core,
    cells: snapshot.cells?.length ?? 0,
    islands: snapshot.islands,
    wounds: snapshot.wounds,
    fragments: snapshot.fragments,
    particleCount: snapshot.particles?.length ?? 0,
    particleBounds: particleBounds(snapshot),
    particleFingerprint: particleFingerprint(snapshot.particles),
    scriptedSplit: snapshot.scriptedSplit,
  };
}

function particleFingerprint(particles = []) {
  let hash = 0x811c9dc5;
  let speedSquared = 0;
  for (const particle of particles) {
    hashNumber(particle.cellId);
    hashNumber(particle.islandId);
    for (const vector of [
      particle.position,
      particle.previousPosition,
      particle.renderPosition,
      particle.velocity,
      particle.contactNormal,
    ]) {
      hashNumber(vector?.x ?? 0);
      hashNumber(vector?.y ?? 0);
      hashNumber(vector?.z ?? 0);
    }
    speedSquared +=
      (particle.velocity?.x ?? 0) ** 2 +
      (particle.velocity?.y ?? 0) ** 2 +
      (particle.velocity?.z ?? 0) ** 2;
    hashNumber(particle.contactAmount ?? 0);
    hashNumber(particle.radius ?? 0);
  }
  return {
    hash: (hash >>> 0).toString(16).padStart(8, '0'),
    speedSquared,
  };

  function hashNumber(value) {
    const quantized = Math.round((Number.isFinite(value) ? value : 0) * 1e9);
    hash ^= quantized | 0;
    hash = Math.imul(hash, 0x01000193);
    hash ^= Math.trunc(quantized / 0x1_0000_0000) | 0;
    hash = Math.imul(hash, 0x01000193);
  }
}

export function assertionsPassed(assertions) {
  return assertions.every((assertion) => assertion.passed);
}

function commonScreenshotAssertions(scenario, capture) {
  const assertions = [];
  const baselineTime = capture.preparation.before.simulationTime;
  const expectedTime = baselineTime + scenario.steps * EVIDENCE_CONTRACT.simulationStepSeconds;
  add(
    assertions,
    'fixed action simulation clock',
    expectedTime,
    capture.semanticSnapshot.simulationTime,
    Math.abs(capture.semanticSnapshot.simulationTime - expectedTime) <= 1e-8,
  );
  add(
    assertions,
    'deterministic settled baseline',
    EVIDENCE_CONTRACT.baselineSettleSteps * EVIDENCE_CONTRACT.simulationStepSeconds,
    baselineTime,
    Math.abs(
      baselineTime -
        EVIDENCE_CONTRACT.baselineSettleSteps * EVIDENCE_CONTRACT.simulationStepSeconds,
    ) <= 1e-8,
  );
  add(
    assertions,
    'browser page errors',
    0,
    capture.diagnostics.pageErrors.length,
    capture.diagnostics.pageErrors.length === 0,
  );
  add(
    assertions,
    'runtime telemetry sampled',
    '> 0 simulation samples',
    capture.finalRuntime.telemetry?.simulation?.samples ?? null,
    (capture.finalRuntime.telemetry?.simulation?.samples ?? 0) > 0,
  );
  add(
    assertions,
    'subject available',
    EVIDENCE_CONTRACT.subjectId,
    capture.finalRuntime.sourceIds,
    capture.finalRuntime.sourceIds.includes(EVIDENCE_CONTRACT.subjectId),
  );
  add(
    assertions,
    'biomass accounting',
    capture.semanticSnapshot.biomass.total,
    capture.semanticSnapshot.biomass.attached + capture.semanticSnapshot.biomass.fragments,
    capture.semanticSnapshot.biomass.total ===
      capture.semanticSnapshot.biomass.attached + capture.semanticSnapshot.biomass.fragments,
  );
  add(
    assertions,
    'core health bounded',
    `0-${capture.semanticSnapshot.core.maximumHealth}`,
    capture.semanticSnapshot.core.health,
    capture.semanticSnapshot.core.health >= 0 &&
      capture.semanticSnapshot.core.health <= capture.semanticSnapshot.core.maximumHealth,
  );
  const core = capture.semanticSnapshot.core.position;
  add(
    assertions,
    'finite core position',
    true,
    [core.x, core.y, core.z],
    [core.x, core.y, core.z].every(Number.isFinite),
  );
  addPresentationAssertions(assertions, capture.finalRuntime);
  return assertions;
}

function addPresentationAssertions(assertions, runtime) {
  const presentation = runtime.blobDiagnostics?.presentation;
  add(
    assertions,
    'marching surfaces ready',
    true,
    presentation?.surfaces?.map((surface) => ({
      id: surface.id,
      hasBuild: surface.hasBuild,
      pending: surface.pending,
    })) ?? null,
    Boolean(presentation) &&
      presentation.surfaces.length > 0 &&
      presentation.surfaces.every((surface) => surface.hasBuild && !surface.pending),
  );
  add(
    assertions,
    'fallback skin hidden',
    0,
    presentation?.fallbackCellCount ?? null,
    presentation?.fallbackCellCount === 0,
  );
  add(
    assertions,
    'evidence overlays hidden',
    { hud: 'none', subtitles: 'none' },
    runtime.evidenceOverlays,
    runtime.evidenceOverlays?.hud === 'none' &&
      runtime.evidenceOverlays?.subtitles === 'none',
  );
}

function particleBounds(snapshot) {
  const particles = snapshot?.particles ?? [];
  if (particles.length === 0) {
    return {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
      span: { x: 0, y: 0, z: 0 },
    };
  }
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const particle of particles) {
    const position = particle.renderPosition ?? particle.position;
    min.x = Math.min(min.x, position.x);
    min.y = Math.min(min.y, position.y);
    min.z = Math.min(min.z, position.z);
    max.x = Math.max(max.x, position.x);
    max.y = Math.max(max.y, position.y);
    max.z = Math.max(max.z, position.z);
  }
  return {
    min,
    max,
    span: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
  };
}

function boundsChanged(before, after, threshold) {
  const left = particleBounds(before).span;
  const right = particleBounds(after).span;
  return Math.max(
    Math.abs(left.x - right.x),
    Math.abs(left.y - right.y),
    Math.abs(left.z - right.z),
  ) >= threshold;
}

function maximumCoreDisplacement(baseline, snapshots) {
  return Math.max(
    0,
    ...snapshots.map((snapshot) => distance(baseline.core.position, snapshot.core.position)),
  );
}

function hasCommand(capture, command) {
  return capture.stages.some((stageCapture) => stageCapture.command === command);
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function add(assertions, name, expected, actual, passed) {
  assertions.push({ name, expected, actual, passed: Boolean(passed) });
}

function shot(
  id,
  command,
  steps,
  expectation,
  camera = turntable,
  chunkSteps = 3,
  renderFrames = 12,
) {
  return Object.freeze({
    id,
    command,
    steps,
    expectation,
    camera,
    chunkSteps,
    renderFrames,
  });
}

function video(id, camera, timeline, expectation) {
  return Object.freeze({ id, camera, timeline: Object.freeze(timeline), expectation });
}

function stage(atSeconds, command) {
  return Object.freeze({ atSeconds, command });
}
