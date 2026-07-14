#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  EVIDENCE_CONTRACT as CONTRACT,
  SCREENSHOT_SCENARIOS,
  VIDEO_SEQUENCES,
  assertionsPassed,
  evaluateScreenshotAssertions,
  evaluateVideoAssertions,
  summarizeSnapshot,
} from './blob-v2-evidence-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT_ROOT = path.resolve(
  ROOT,
  process.env.BLOB_V2_ARTIFACT_DIR ?? '.artifacts/blob-v2',
);
const SCREENSHOT_ROOT = path.join(ARTIFACT_ROOT, 'screenshots');
const VIDEO_ROOT = path.join(ARTIFACT_ROOT, 'videos');
const TEMP_ROOT = path.join(ARTIFACT_ROOT, '.playwright-video');
const GOLDEN_ROOT = path.join(ROOT, 'tests/golden/blob-v2');
const GOLDEN_MAX_CHANGED_PIXEL_RATIO = 0.01;
const GOLDEN_CHANNEL_DELTA = 8;
let playwrightFfmpeg;
const EVIDENCE_OVERLAY_CSS = `
.hud,
.hev-subtitles {
  display: none !important;
}
`;

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
} else {
  try {
    await run(options);
  } catch (error) {
    console.error(`[blob-v2-evidence] ${formatError(error)}`);
    process.exitCode = 1;
  }
}

async function run(runOptions) {
  const selection = selectEvidence(runOptions);
  await prepareArtifactDirectories(selection);

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    await writeRunFailure('playwright-import', error);
    throw new Error(
      'No se pudo importar Playwright. Ejecutá `npm install` antes del harness.',
      { cause: error },
    );
  }

  let browser;
  try {
    browser = await launchEvidenceBrowser(chromium, runOptions);
  } catch (error) {
    await writeRunFailure('chromium-launch', error);
    throw new Error(
      'No se pudo iniciar el Chromium fijado por Playwright. Ejecutá `npm run evidence:blob-v2:install`.',
      { cause: error },
    );
  }

  const screenshotResults = [];
  const videoResults = [];
  const manifest = {
    schemaVersion: CONTRACT.schemaVersion,
    harness: 'blob-v2-playwright-evidence',
    generatedAt: new Date().toISOString(),
    contract: publicContract(),
    playwrightVersion: await packageVersion('playwright'),
    chromiumVersion: browser.version(),
    artifactLayout: {
      screenshots: path.relative(ARTIFACT_ROOT, SCREENSHOT_ROOT).replaceAll('\\', '/'),
      videos: path.relative(ARTIFACT_ROOT, VIDEO_ROOT).replaceAll('\\', '/'),
      goldens: path.relative(ROOT, GOLDEN_ROOT).replaceAll('\\', '/'),
    },
    requested: {
      screenshots: selection.screenshots.map((scenario) => scenario.id),
      videos: selection.videos.map((sequence) => sequence.id),
      goldenMode: runOptions.updateGoldens ? 'update' : 'compare',
    },
    screenshots: screenshotResults,
    videos: videoResults,
  };

  let evidenceServer;
  try {
    evidenceServer = await resolveServer(runOptions);
    manifest.baseURL = evidenceServer.baseURL;
    let captureIndex = 0;

    for (const scenario of selection.screenshots) {
      if (captureIndex++ > 0) {
        await browser.close();
        browser = await launchEvidenceBrowser(chromium, runOptions);
      }
      console.log(`[blob-v2-evidence] screenshot ${scenario.id}...`);
      try {
        const result = await captureScreenshot({
          browser,
          baseURL: evidenceServer.baseURL,
          scenario,
          updateGoldens: runOptions.updateGoldens,
        });
        screenshotResults.push(result);
        console.log(
          `[blob-v2-evidence] screenshot ${scenario.id}: ${result.artifacts.screenshot.bytes} B, ${result.assertions} assertions`,
        );
      } catch (error) {
        screenshotResults.push(failedResult(scenario.id, error));
        console.error(`[blob-v2-evidence] screenshot ${scenario.id} falló: ${formatError(error)}`);
      }
    }

    for (const sequence of selection.videos) {
      if (captureIndex++ > 0) {
        await browser.close();
        browser = await launchEvidenceBrowser(chromium, runOptions);
      }
      console.log(`[blob-v2-evidence] video ${sequence.id} (10-15 s)...`);
      try {
        const result = await captureVideoSequence({
          browser,
          baseURL: evidenceServer.baseURL,
          sequence,
        });
        videoResults.push(result);
        console.log(
          `[blob-v2-evidence] video ${sequence.id}: ${result.durationSeconds.toFixed(2)} s, ${result.artifacts.video.bytes} B`,
        );
      } catch (error) {
        videoResults.push(failedResult(sequence.id, error));
        console.error(`[blob-v2-evidence] video ${sequence.id} falló: ${formatError(error)}`);
      }
    }
  } catch (error) {
    manifest.fatal = serializeError(error);
    throw error;
  } finally {
    await evidenceServer?.close();
    await browser.close();
    manifest.summary = summarizeRun(screenshotResults, videoResults);
    await writeJson(path.join(ARTIFACT_ROOT, 'manifest.json'), manifest);
  }

  const failures = [...screenshotResults, ...videoResults].filter(
    (result) => result.status !== 'passed',
  );
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} evidencia(s) fallaron; ver ${path.relative(ROOT, path.join(ARTIFACT_ROOT, 'manifest.json'))}`,
    );
  }
  if (selection.videos.length === VIDEO_SEQUENCES.length) {
    await validateExactVideoDelivery();
  }

  console.log(
    `[blob-v2-evidence] entrega lista: ${screenshotResults.length} screenshots y ${videoResults.length} videos en ${path.relative(ROOT, ARTIFACT_ROOT)}.`,
  );
}

function launchEvidenceBrowser(chromium, runOptions) {
  // SwiftShader owns process-global caches and worker scheduling. A clean
  // browser process per capture keeps a matrix run identical to an isolated
  // capture instead of letting prior WebGL contexts perturb later goldens.
  return chromium.launch({
    headless: !runOptions.headed,
    args: [
      '--force-device-scale-factor=1',
      '--font-render-hinting=none',
      '--disable-lcd-text',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
}

async function validateExactVideoDelivery() {
  const actual = (await readdir(VIDEO_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.webm')
    .map((entry) => entry.name)
    .sort();
  const expected = VIDEO_SEQUENCES.map((sequence) => `${sequence.id}.webm`).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `La entrega debe contener exactamente cuatro WebM: esperado ${expected.join(', ')}, observado ${actual.join(', ')}`,
    );
  }
}

async function prepareArtifactDirectories(selection) {
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  const completeScreenshots = selection.screenshots.length === SCREENSHOT_SCENARIOS.length;
  const completeVideos = selection.videos.length === VIDEO_SEQUENCES.length;
  if (completeScreenshots) await resetArtifactDirectory(SCREENSHOT_ROOT);
  else await mkdir(SCREENSHOT_ROOT, { recursive: true });
  if (completeVideos) {
    await Promise.all([
      resetArtifactDirectory(VIDEO_ROOT),
      resetArtifactDirectory(TEMP_ROOT),
    ]);
    await removeLegacyRootEvidence();
  } else {
    await Promise.all([
      mkdir(VIDEO_ROOT, { recursive: true }),
      mkdir(TEMP_ROOT, { recursive: true }),
    ]);
  }
}

async function resetArtifactDirectory(directory) {
  assertArtifactChild(directory);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
}

async function removeLegacyRootEvidence() {
  const knownIds = new Set([
    ...SCREENSHOT_SCENARIOS.map((scenario) => scenario.id),
    ...VIDEO_SEQUENCES.map((sequence) => sequence.id),
    'split-return',
    'split-wither',
  ]);
  const entries = await readdir(ARTIFACT_ROOT, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile()) return;
    const extension = path.extname(entry.name).toLowerCase();
    const id = path.basename(entry.name, extension);
    if (!knownIds.has(id) || !['.png', '.json', '.webm'].includes(extension)) return;
    const filePath = path.resolve(ARTIFACT_ROOT, entry.name);
    if (path.dirname(filePath) !== ARTIFACT_ROOT) {
      throw new Error(`Refusing to remove legacy artifact outside root: ${filePath}`);
    }
    await rm(filePath, { force: true });
  }));
}

function assertArtifactChild(directory) {
  const relative = path.relative(ARTIFACT_ROOT, directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Unsafe generated artifact directory: ${directory}`);
  }
}

async function captureScreenshot({ browser, baseURL, scenario, updateGoldens }) {
  const screenshotPath = path.join(SCREENSHOT_ROOT, `${scenario.id}.png`);
  const sidecarPath = path.join(SCREENSHOT_ROOT, `${scenario.id}.json`);
  await Promise.all([
    rm(screenshotPath, { force: true }),
    rm(sidecarPath, { force: true }),
  ]);

  const diagnostics = freshDiagnostics();
  const context = await createEvidenceContext(browser);
  let evidence;
  let captureError;
  try {
    const page = await openEvidencePage(context, baseURL, diagnostics);
    const preparation = await prepareScreenshotScenario(page, scenario);
    const samples = await advanceScreenshotScenario(page, scenario);
    const semantic = await page.evaluate(
      (subjectId) => ({
        snapshot: globalThis.__blobDebug?.snapshot(subjectId),
        telemetry: globalThis.__blobDebug?.telemetry(subjectId),
        diagnostics: globalThis.__blobDebug?.diagnostics(subjectId),
      }),
      CONTRACT.subjectId,
    );
    const semanticSnapshot = semantic.snapshot;

    await stabilizeRuntime(page, scenario.camera);
    await pulseGameLoop(page, scenario.renderFrames);
    await finishGpuWork(page);
    const finalRuntime = await collectRuntime(page);
    validateBrowserContract(finalRuntime);

    await page.screenshot({
      path: screenshotPath,
      type: 'png',
      animations: 'disabled',
      caret: 'hide',
      fullPage: false,
    });
    const screenshotArtifact = await artifactInfo(screenshotPath, SCREENSHOT_ROOT);
    const golden = await verifyScreenshotGolden({
      page,
      screenshotPath,
      scenarioId: scenario.id,
      updateGoldens,
    });
    const assertionInput = {
      preparation,
      samples,
      semanticSnapshot,
      semanticDiagnostics: semantic.diagnostics,
      finalRuntime,
      diagnostics,
    };
    const assertions = evaluateScreenshotAssertions(scenario, assertionInput);
    assertions.push({
      name: 'PNG golden pixel diff',
      expected: updateGoldens
        ? 'explicit update mode'
        : `<= ${GOLDEN_MAX_CHANGED_PIXEL_RATIO * 100}% changed pixels`,
      actual: golden.mode === 'missing'
        ? 'missing golden'
        : {
            mode: golden.mode,
            changedPixels: golden.changedPixels,
            changedPixelRatio: golden.changedPixelRatio,
            maximumChannelDelta: golden.maximumChannelDelta,
          },
      passed: golden.passed,
    });
    const passed = assertionsPassed(assertions);

    evidence = {
      schemaVersion: CONTRACT.schemaVersion,
      kind: 'screenshot',
      id: scenario.id,
      command: scenario.command,
      status: passed ? 'passed' : 'failed',
      generatedAt: new Date().toISOString(),
      contract: publicContract(),
      camera: scenario.camera,
      clock: {
        baselineSettleSteps: CONTRACT.baselineSettleSteps,
        baselineSimulationTime: preparation.before.simulationTime,
        fixedSteps: scenario.steps,
        expectedSimulationTime:
          preparation.before.simulationTime +
          scenario.steps * CONTRACT.simulationStepSeconds,
        observedSimulationTime: semanticSnapshot.simulationTime,
        observedActionSimulationTime:
          semanticSnapshot.simulationTime - preparation.before.simulationTime,
      },
      assertions,
      preparation: {
        ...preparation,
        before: summarizeSnapshot(preparation.before),
        actionResult: summarizeScenarioResult(preparation.actionResult),
        afterScenario: summarizeSnapshot(preparation.afterScenario),
      },
      samples,
      semanticSnapshot: summarizeSnapshot(semanticSnapshot),
      semanticTelemetry: semantic.telemetry,
      semanticDiagnostics: semantic.diagnostics,
      finalRuntime: summarizeRuntime(finalRuntime),
      golden,
      diagnostics,
      artifacts: {
        screenshot: screenshotArtifact,
        ...(golden.artifact ? { golden: golden.artifact } : {}),
      },
    };
    await writeJson(sidecarPath, evidence);
    const sidecarArtifact = await artifactInfo(sidecarPath, SCREENSHOT_ROOT);

    if (!passed) throw assertionError('screenshot', scenario.id, assertions);
    return {
      id: scenario.id,
      command: scenario.command,
      status: 'passed',
      assertions: assertions.length,
      simulationTime: semanticSnapshot.simulationTime,
      telemetry: finalRuntime.telemetry,
      golden,
      artifacts: {
        screenshot: screenshotArtifact,
        sidecar: sidecarArtifact,
      },
    };
  } catch (error) {
    captureError = error;
    if (!evidence) {
      await writeJson(sidecarPath, {
        schemaVersion: CONTRACT.schemaVersion,
        kind: 'screenshot',
        id: scenario.id,
        status: 'failed',
        generatedAt: new Date().toISOString(),
        contract: publicContract(),
        diagnostics,
        error: serializeError(error),
      });
    }
  } finally {
    await context.close();
  }
  throw captureError;
}

async function verifyScreenshotGolden({ page, screenshotPath, scenarioId, updateGoldens }) {
  const goldenPath = path.join(GOLDEN_ROOT, `${scenarioId}.png`);
  const existed = await fileExists(goldenPath);
  if (updateGoldens) {
    await mkdir(GOLDEN_ROOT, { recursive: true });
    await copyFile(screenshotPath, goldenPath);
  } else if (!existed) {
    return {
      mode: 'missing',
      passed: false,
      threshold: {
        maximumChangedPixelRatio: GOLDEN_MAX_CHANGED_PIXEL_RATIO,
        changedPixelChannelDelta: GOLDEN_CHANNEL_DELTA,
      },
      file: path.relative(ROOT, goldenPath).replaceAll('\\', '/'),
    };
  }

  const comparison = await comparePngFiles(page, screenshotPath, goldenPath);
  return {
    mode: updateGoldens ? 'updated' : 'compared',
    passed:
      comparison.dimensionsMatch &&
      (updateGoldens || comparison.changedPixelRatio <= GOLDEN_MAX_CHANGED_PIXEL_RATIO),
    threshold: {
      maximumChangedPixelRatio: GOLDEN_MAX_CHANGED_PIXEL_RATIO,
      changedPixelChannelDelta: GOLDEN_CHANNEL_DELTA,
    },
    ...comparison,
    artifact: await artifactInfo(goldenPath, ROOT),
  };
}

async function comparePngFiles(page, actualPath, expectedPath) {
  const [actual, expected] = await Promise.all([
    readFile(actualPath),
    readFile(expectedPath),
  ]);
  return page.evaluate(
    async ({ actualUrl, expectedUrl, channelDelta }) => {
      const [actualImage, expectedImage] = await Promise.all([
        decode(actualUrl),
        decode(expectedUrl),
      ]);
      const dimensionsMatch =
        actualImage.naturalWidth === expectedImage.naturalWidth &&
        actualImage.naturalHeight === expectedImage.naturalHeight;
      if (!dimensionsMatch) {
        return {
          dimensionsMatch,
          actualDimensions: {
            width: actualImage.naturalWidth,
            height: actualImage.naturalHeight,
          },
          expectedDimensions: {
            width: expectedImage.naturalWidth,
            height: expectedImage.naturalHeight,
          },
          pixels: 0,
          changedPixels: 0,
          changedPixelRatio: 1,
          maximumChannelDelta: 255,
        };
      }

      const width = actualImage.naturalWidth;
      const height = actualImage.naturalHeight;
      const actualPixels = pixels(actualImage, width, height);
      const expectedPixels = pixels(expectedImage, width, height);
      let changedPixels = 0;
      let maximumChannelDelta = 0;
      for (let index = 0; index < actualPixels.length; index += 4) {
        let pixelDelta = 0;
        for (let channel = 0; channel < 4; channel += 1) {
          pixelDelta = Math.max(
            pixelDelta,
            Math.abs(actualPixels[index + channel] - expectedPixels[index + channel]),
          );
        }
        maximumChannelDelta = Math.max(maximumChannelDelta, pixelDelta);
        if (pixelDelta > channelDelta) changedPixels += 1;
      }
      const totalPixels = width * height;
      return {
        dimensionsMatch,
        actualDimensions: { width, height },
        expectedDimensions: { width, height },
        pixels: totalPixels,
        changedPixels,
        changedPixelRatio: changedPixels / totalPixels,
        maximumChannelDelta,
      };

      function decode(url) {
        return new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error('Chromium could not decode a golden PNG'));
          image.src = url;
        });
      }

      function pixels(image, width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('Chromium did not expose a 2D canvas context');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, width, height).data;
      }
    },
    {
      actualUrl: `data:image/png;base64,${actual.toString('base64')}`,
      expectedUrl: `data:image/png;base64,${expected.toString('base64')}`,
      channelDelta: GOLDEN_CHANNEL_DELTA,
    },
  );
}

async function captureVideoSequence({ browser, baseURL, sequence }) {
  const videoPath = path.join(VIDEO_ROOT, `${sequence.id}.webm`);
  const sidecarPath = path.join(VIDEO_ROOT, `${sequence.id}.json`);
  const videoTempDir = path.join(TEMP_ROOT, sequence.id);
  const rawVideoPath = path.join(videoTempDir, `${sequence.id}.raw.webm`);
  await Promise.all([
    rm(videoPath, { force: true }),
    rm(sidecarPath, { force: true }),
    rm(videoTempDir, { recursive: true, force: true }),
  ]);
  await mkdir(videoTempDir, { recursive: true });

  const diagnostics = freshDiagnostics();
  const context = await createEvidenceContext(browser, videoTempDir);
  const recordingStartedAt = performance.now();
  const page = await openEvidencePage(context, baseURL, diagnostics);
  const video = page.video();
  if (!video) {
    await context.close();
    throw new Error('Playwright no creó el recorder WebM para la secuencia');
  }

  let capture;
  let captureError;
  let videoError;
  const startedAt = performance.now();
  try {
    const baselineCapture = await page.evaluate(
      ({ subjectId, camera }) => {
        const debug = globalThis.__blobDebug;
        const player = globalThis.__player;
        if (!debug || !player) throw new Error('Blob V2 evidence adapters are incomplete');
        debug.freeze(subjectId, true);
        player.teleport(...camera.position);
        player.look(camera.yaw, camera.pitch);
        return {
          snapshot: debug.snapshot(subjectId),
          telemetry: debug.telemetry(subjectId),
          diagnostics: debug.diagnostics(subjectId),
        };
      },
      { subjectId: CONTRACT.subjectId, camera: sequence.camera },
    );
    const baseline = baselineCapture.snapshot;

    const stages = [];
    const samples = [];
    let stageIndex = 0;
    let simulatedTicks = 0;
    const totalSimulationTicks = Math.ceil(
      (CONTRACT.video.sequenceSeconds * 1000) / CONTRACT.video.tickMs,
    );
    const sequenceStartedAt = performance.now();
    const sequenceStartOffsetSeconds =
      (sequenceStartedAt - recordingStartedAt) / 1000;
    while (true) {
      const elapsedSeconds = (performance.now() - sequenceStartedAt) / 1000;
      while (
        stageIndex < sequence.timeline.length &&
        sequence.timeline[stageIndex].atSeconds <= elapsedSeconds + 1e-6
      ) {
        const stageDefinition = sequence.timeline[stageIndex];
        const stageCapture = await applyVideoStage(page, sequence, stageDefinition, elapsedSeconds);
        stages.push(stageCapture);
        stageIndex += 1;
      }
      const elapsedTicks = Math.floor(
        (Math.min(elapsedSeconds, CONTRACT.video.sequenceSeconds) * 1000) /
          CONTRACT.video.tickMs,
      );
      const targetTicks = elapsedSeconds >= CONTRACT.video.sequenceSeconds
        ? totalSimulationTicks
        : Math.min(
            totalSimulationTicks,
            Math.max(simulatedTicks + 1, elapsedTicks + 1),
          );
      if (simulatedTicks >= totalSimulationTicks) break;

      const tickCount = targetTicks - simulatedTicks;
      const sample = await advanceVideoTick(page, sequence, tickCount);
      await pulseGameLoop(page, 1);
      samples.push({
        wallTimeSeconds: elapsedSeconds,
        snapshot: sample.snapshot,
        telemetry: sample.telemetry,
        diagnostics: sample.diagnostics,
      });

      simulatedTicks = targetTicks;
      const nextTickAt = sequenceStartedAt + simulatedTicks * CONTRACT.video.tickMs;
      await delay(Math.max(0, nextTickAt - performance.now()));
    }

    await stabilizeRuntime(page, sequence.camera);
    await pulseGameLoop(page, 2);
    const finalRuntime = await collectRuntime(page);
    validateBrowserContract(finalRuntime);
    capture = {
      baseline,
      baselineTelemetry: baselineCapture.telemetry,
      baselineDiagnostics: baselineCapture.diagnostics,
      stages,
      samples,
      finalRuntime,
      diagnostics,
      sequenceStartOffsetSeconds,
      recordedSequenceSeconds: (performance.now() - sequenceStartedAt) / 1000,
    };
  } catch (error) {
    captureError = error;
  }

  try {
    const saveRawVideo = video.saveAs(rawVideoPath);
    await context.close();
    await saveRawVideo;
  } catch (error) {
    videoError = error;
  }

  if (!captureError && !videoError) {
    try {
      capture.video = await trimAndProbeVideo(
        rawVideoPath,
        videoPath,
        Math.max(0, capture.sequenceStartOffsetSeconds - 0.75),
      );
      const videoArtifact = await artifactInfo(videoPath, VIDEO_ROOT);
      const assertions = evaluateVideoAssertions(sequence, capture);
      const passed = assertionsPassed(assertions);
      const sidecar = {
        schemaVersion: CONTRACT.schemaVersion,
        kind: 'video',
        id: sequence.id,
        status: passed ? 'passed' : 'failed',
        generatedAt: new Date().toISOString(),
        contract: publicContract(),
        camera: sequence.camera,
        timeline: sequence.timeline,
        sequenceStartOffsetSeconds: capture.sequenceStartOffsetSeconds,
        recordedSequenceSeconds: capture.recordedSequenceSeconds,
        video: capture.video,
        assertions,
        baseline: summarizeSnapshot(capture.baseline),
        baselineTelemetry: capture.baselineTelemetry,
        baselineDiagnostics: capture.baselineDiagnostics,
        stages: capture.stages,
        samples: capture.samples,
        finalRuntime: summarizeRuntime(capture.finalRuntime),
        diagnostics,
        artifacts: { video: videoArtifact },
      };
      await writeJson(sidecarPath, sidecar);
      const sidecarArtifact = await artifactInfo(sidecarPath, VIDEO_ROOT);
      await rm(videoTempDir, { recursive: true, force: true });

      if (!passed) throw assertionError('video', sequence.id, assertions);
      return {
        id: sequence.id,
        status: 'passed',
        durationSeconds: capture.video.durationSeconds,
        recordedSequenceSeconds: capture.recordedSequenceSeconds,
        sequenceStartOffsetSeconds: capture.sequenceStartOffsetSeconds,
        assertions: assertions.length,
        telemetry: capture.finalRuntime.telemetry,
        artifacts: {
          video: videoArtifact,
          sidecar: sidecarArtifact,
        },
      };
    } catch (error) {
      captureError = error;
    }
  }

  await writeJson(sidecarPath, {
    schemaVersion: CONTRACT.schemaVersion,
    kind: 'video',
    id: sequence.id,
    status: 'failed',
    generatedAt: new Date().toISOString(),
    contract: publicContract(),
    diagnostics,
    capture: capture
      ? {
          ...capture,
          baseline: summarizeSnapshot(capture.baseline),
          finalRuntime: summarizeRuntime(capture.finalRuntime),
        }
      : null,
    captureError: captureError ? serializeError(captureError) : null,
    videoError: videoError ? serializeError(videoError) : null,
    wallTimeSeconds: (performance.now() - startedAt) / 1000,
  });
  throw captureError ?? new Error('No se pudo guardar o recortar el WebM', { cause: videoError });
}

async function createEvidenceContext(browser, recordVideoDir) {
  const context = await browser.newContext({
    viewport: CONTRACT.viewport,
    screen: CONTRACT.viewport,
    deviceScaleFactor: CONTRACT.deviceScaleFactor,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    ...(recordVideoDir
      ? {
          recordVideo: {
            dir: recordVideoDir,
            size: CONTRACT.viewport,
          },
        }
      : {}),
  });
  await context.addInitScript(installDeterministicBrowserContract, {
    seed: CONTRACT.browserSeed,
    epochMs: Date.parse(CONTRACT.epoch),
    subjectId: CONTRACT.subjectId,
  });
  return context;
}

async function openEvidencePage(context, baseURL, diagnostics) {
  const page = await context.newPage();
  attachDiagnostics(page, diagnostics);
  const targetURL = new URL(baseURL);
  targetURL.searchParams.set('level', CONTRACT.level);
  targetURL.searchParams.set('evidence', 'blob-v2');
  await page.goto(targetURL.href, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.addStyleTag({ content: EVIDENCE_OVERLAY_CSS });
  await waitForBlobRuntime(page, CONTRACT.subjectId, 60_000);
  await page.evaluate((subjectId) => {
    const debug = globalThis.__blobDebug;
    if (!debug) throw new Error('Blob V2 debug adapter disappeared during startup');
    debug.freeze(subjectId, true);
  }, CONTRACT.subjectId);
  await finishRuntimeStartup(page, CONTRACT.subjectId);
  await page.waitForLoadState('networkidle', { timeout: 30_000 });
  await page.evaluate(
    ({ subjectId, steps }) => {
      const debug = globalThis.__blobDebug;
      if (!debug) throw new Error('Blob V2 debug adapter disappeared before baseline settle');
      debug.resetEvidence(subjectId);
      debug.freeze(subjectId, false);
      debug.fixedStep(subjectId, steps);
      debug.freeze(subjectId, true);
    },
    { subjectId: CONTRACT.subjectId, steps: CONTRACT.baselineSettleSteps },
  );
  await pulseGameLoop(page, 12);
  await finishGpuWork(page);
  await page.evaluate((subjectId) => {
    const debug = globalThis.__blobDebug;
    if (!debug) throw new Error('Blob V2 debug adapter disappeared after baseline settle');
    debug.prepareEvidence(subjectId);
  }, CONTRACT.subjectId);
  return page;
}

async function finishRuntimeStartup(page, subjectId) {
  const deadline = performance.now() + 10_000;
  let lastState;
  while (performance.now() < deadline) {
    await pulseGameLoop(page, 2);
    lastState = await page.evaluate((id) => ({
      telemetry: globalThis.__blobDebug?.telemetry(id),
      snapshot: globalThis.__blobDebug?.snapshot(id),
      gate: globalThis.__blobEvidenceHarness?.status(),
    }), subjectId);
    if (
      lastState?.telemetry?.simulation?.samples > 0 &&
      lastState.snapshot?.overrideState === 'Frozen' &&
      lastState.gate?.queuedFrames > 0
    ) {
      return;
    }
  }
  throw new Error(`Timeout completing the Blob V2 runtime startup: ${JSON.stringify(lastState)}`);
}

async function prepareScreenshotScenario(page, scenario) {
  return page.evaluate(
    ({ subjectId, command, camera }) => {
      const debug = globalThis.__blobDebug;
      const player = globalThis.__player;
      if (!debug || !player) throw new Error('Blob V2 evidence adapters are incomplete');
      debug.freeze(subjectId, true);
      const before = debug.snapshot(subjectId);
      const beforeTelemetry = debug.telemetry(subjectId);
      const beforeDiagnostics = debug.diagnostics(subjectId);
      player.teleport(...camera.position);
      player.look(camera.yaw, camera.pitch);
      debug.freeze(subjectId, false);
      const actionResult = debug.scenario(subjectId, command);
      return {
        before,
        beforeTelemetry,
        beforeDiagnostics,
        actionResult,
        afterScenario: debug.snapshot(subjectId),
        afterTelemetry: debug.telemetry(subjectId),
        afterDiagnostics: debug.diagnostics(subjectId),
        events: debug.events(subjectId),
        playerPosition: player.position(),
      };
    },
    {
      subjectId: CONTRACT.subjectId,
      command: scenario.command,
      camera: scenario.camera,
    },
  );
}

async function advanceScreenshotScenario(page, scenario) {
  const samples = [];
  let remaining = scenario.steps;
  while (remaining > 0) {
    const steps = Math.min(scenario.chunkSteps, remaining);
    const snapshot = await page.evaluate(
      ({ subjectId, steps }) => {
        const debug = globalThis.__blobDebug;
        if (!debug) throw new Error('Blob V2 debug adapter disappeared');
        const before = debug.snapshot(subjectId);
        if (before.overrideState === 'Frozen' || before.overrideState === 'Dead') {
          throw new Error(`Cannot advance screenshot from override ${before.overrideState}`);
        }
        debug.fixedStep(subjectId, steps);
        return {
          snapshot: debug.snapshot(subjectId),
          telemetry: debug.telemetry(subjectId),
          diagnostics: debug.diagnostics(subjectId),
        };
      },
      { subjectId: CONTRACT.subjectId, steps },
    );
    samples.push({
      fixedSteps: scenario.steps - remaining + steps,
      snapshot: summarizeSnapshot(snapshot.snapshot),
      telemetry: snapshot.telemetry,
      diagnostics: snapshot.diagnostics,
    });
    remaining -= steps;
  }
  return samples;
}

async function applyVideoStage(page, sequence, stageDefinition, elapsedSeconds) {
  return page.evaluate(
    ({ subjectId, command, camera, elapsedSeconds }) => {
      const debug = globalThis.__blobDebug;
      const player = globalThis.__player;
      if (!debug || !player) throw new Error('Blob V2 evidence adapters disappeared');
      const current = debug.snapshot(subjectId);
      if (current.overrideState === 'Frozen') debug.freeze(subjectId, false);
      if (current.overrideState === 'Dead') throw new Error('Cannot start a video stage from Dead');
      const actionResult = debug.scenario(subjectId, command);
      player.teleport(...camera.position);
      player.look(camera.yaw, camera.pitch);
      return {
        command,
        wallTimeSeconds: elapsedSeconds,
        actionResult: compactSnapshot(actionResult),
        snapshot: compactSnapshot(debug.snapshot(subjectId)),
        telemetry: debug.telemetry(subjectId),
        diagnostics: debug.diagnostics(subjectId),
      };

      function compactSnapshot(snapshot) {
        if (!snapshot || typeof snapshot !== 'object' || !snapshot.core) return snapshot;
        return {
          version: snapshot.version,
          simulationTime: snapshot.simulationTime,
          organismState: snapshot.organismState,
          traversalState: snapshot.traversalState,
          overrideState: snapshot.overrideState,
          biomass: snapshot.biomass,
          core: snapshot.core,
          wounds: snapshot.wounds,
          fragments: snapshot.fragments,
        };
      }
    },
    {
      subjectId: CONTRACT.subjectId,
      command: stageDefinition.command,
      camera: sequence.camera,
      elapsedSeconds,
    },
  );
}

function summarizeScenarioResult(result) {
  if (!result || typeof result !== 'object' || !result.core) return result;
  return summarizeSnapshot(result);
}

async function advanceVideoTick(page, sequence, tickCount = 1) {
  return page.evaluate(
    ({ subjectId, steps, camera }) => {
      const debug = globalThis.__blobDebug;
      const player = globalThis.__player;
      if (!debug || !player) throw new Error('Blob V2 evidence adapters disappeared');
      let current = debug.snapshot(subjectId);
      if (current.overrideState === 'Frozen') {
        debug.freeze(subjectId, false);
        current = debug.snapshot(subjectId);
      }
      if (current.overrideState !== 'Dead') debug.fixedStep(subjectId, steps);
      const semantic = debug.snapshot(subjectId);
      if (semantic.overrideState !== 'Dead') debug.freeze(subjectId, true);
      player.teleport(...camera.position);
      player.look(camera.yaw, camera.pitch);
      return {
        snapshot: compactSnapshot(semantic),
        telemetry: debug.telemetry(subjectId),
        diagnostics: debug.diagnostics(subjectId),
      };

      function compactSnapshot(snapshot) {
        return {
          version: snapshot.version,
          simulationTime: snapshot.simulationTime,
          organismState: snapshot.organismState,
          traversalState: snapshot.traversalState,
          overrideState: snapshot.overrideState,
          biomass: snapshot.biomass,
          core: snapshot.core,
          wounds: snapshot.wounds,
          fragments: snapshot.fragments,
        };
      }
    },
    {
      subjectId: CONTRACT.subjectId,
      steps: CONTRACT.video.stepsPerTick * tickCount,
      camera: sequence.camera,
    },
  );
}

async function stabilizeRuntime(page, camera) {
  await page.evaluate(
    ({ subjectId, camera }) => {
      const debug = globalThis.__blobDebug;
      const player = globalThis.__player;
      if (!debug || !player) throw new Error('Blob V2 evidence adapters disappeared');
      const snapshot = debug.snapshot(subjectId);
      if (snapshot.overrideState !== 'Frozen' && snapshot.overrideState !== 'Dead') {
        debug.freeze(subjectId, true);
      }
      debug.prepareEvidence(subjectId);
      player.teleport(...camera.position);
      player.look(camera.yaw, camera.pitch);
      return debug.snapshot(subjectId);
    },
    { subjectId: CONTRACT.subjectId, camera },
  );
}

async function pulseGameLoop(page, frames) {
  const target = await page.evaluate(
    (count) => globalThis.__blobEvidenceHarness?.runFrames(count),
    frames,
  );
  if (!Number.isFinite(target)) throw new Error('Evidence frame gate is unavailable');
  await page.waitForTimeout(Math.max(32, Math.ceil(frames * (1000 / 60))));
  await page.evaluate(
    (pulseTarget) => globalThis.__blobEvidenceHarness?.closeFrames(pulseTarget),
    target,
  );
  const deadline = performance.now() + 5_000;
  let lastStatus;
  while (performance.now() < deadline) {
    lastStatus = await page.evaluate(() => globalThis.__blobEvidenceHarness?.status());
    if (
      lastStatus?.completedPulses >= target &&
      lastStatus.gateOpen === false &&
      lastStatus.queuedFrames > 0
    ) {
      await page.waitForTimeout(25);
      return;
    }
    await delay(10);
  }
  throw new Error(`Timeout pulsando ${frames} frame(s): ${JSON.stringify(lastStatus)}`);
}

async function finishGpuWork(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    gl?.finish();
  });
}

async function collectRuntime(page) {
  return page.evaluate((subjectId) => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    const rendererInfo = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      href: location.href,
      sourceIds: globalThis.__blobDebug?.list() ?? [],
      snapshot: globalThis.__blobDebug?.snapshot(subjectId),
      telemetry: globalThis.__blobDebug?.telemetry(subjectId),
      blobDiagnostics: globalThis.__blobDebug?.diagnostics(subjectId),
      events: globalThis.__blobDebug?.events(subjectId) ?? [],
      playerPosition: globalThis.__player?.position(),
      viewport: { width: innerWidth, height: innerHeight },
      deviceScaleFactor: devicePixelRatio,
      browserClock: {
        dateNow: Date.now(),
        dateIso: new Date().toISOString(),
        performanceNow: performance.now(),
      },
      evidenceOverlays: {
        hud: getComputedStyle(document.querySelector('.hud') ?? document.body).display,
        subtitles: getComputedStyle(
          document.querySelector('.hev-subtitles') ?? document.body,
        ).display,
      },
      gate: globalThis.__blobEvidenceHarness?.status(),
      canvas: canvas
        ? {
            width: canvas.width,
            height: canvas.height,
            cssWidth: canvas.getBoundingClientRect().width,
            cssHeight: canvas.getBoundingClientRect().height,
          }
        : null,
      webgl: gl
        ? {
            version: gl.getParameter(gl.VERSION),
            renderer: rendererInfo
              ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)
              : gl.getParameter(gl.RENDERER),
          }
        : null,
    };
  }, CONTRACT.subjectId);
}

function installDeterministicBrowserContract({ seed, epochMs, subjectId }) {
  let randomState = seed >>> 0;
  Math.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x1_0000_0000;
  };

  const NativeDate = Date;
  function EvidenceDate(...args) {
    if (!new.target) return new NativeDate(epochMs).toString();
    return args.length === 0 ? new NativeDate(epochMs) : new NativeDate(...args);
  }
  Object.setPrototypeOf(EvidenceDate, NativeDate);
  EvidenceDate.prototype = NativeDate.prototype;
  Object.defineProperty(EvidenceDate, 'now', {
    configurable: true,
    value: () => epochMs,
  });
  globalThis.Date = EvidenceDate;

  const nativeRequestAnimationFrame = requestAnimationFrame.bind(globalThis);
  const nativeCancelAnimationFrame = cancelAnimationFrame.bind(globalThis);
  const queuedFrames = new Map();
  let nextQueuedId = -1;
  let gateOpen = false;
  let executedCallbacks = 0;
  let pulses = 0;
  let completedPulses = 0;

  const runtimeIsReady = () => {
    try {
      return globalThis.__blobDebug?.list().includes(subjectId) === true;
    } catch {
      return false;
    }
  };

  const scheduleNative = (callback) => nativeRequestAnimationFrame((timestamp) => {
    executedCallbacks += 1;
    callback(timestamp);
  });

  const flush = () => {
    if (!gateOpen) return;
    while (queuedFrames.size > 0) {
      const [id, queued] = queuedFrames.entries().next().value;
      queuedFrames.delete(id);
      scheduleNative(queued.callback);
    }
  };

  globalThis.requestAnimationFrame = (callback) => {
    if (!runtimeIsReady()) return nativeRequestAnimationFrame(callback);
    if (gateOpen) return scheduleNative(callback);
    const id = nextQueuedId--;
    queuedFrames.set(id, {
      callback,
      name: callback.name || '(anonymous)',
      stack: new Error('queued requestAnimationFrame').stack,
    });
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    if (queuedFrames.delete(id)) return;
    nativeCancelAnimationFrame(id);
  };

  Object.defineProperty(globalThis, '__blobEvidenceHarness', {
    configurable: false,
    enumerable: false,
    value: Object.freeze({
      runFrames(count) {
        if (!Number.isInteger(count) || count < 1) throw new RangeError('runFrames count');
        if (gateOpen) throw new Error('A frame pulse is already running');
        gateOpen = true;
        pulses += 1;
        const target = pulses;
        flush();
        return target;
      },
      closeFrames(target) {
        if (!Number.isInteger(target) || target !== pulses) {
          throw new Error(`Invalid frame pulse target ${target}; current pulse is ${pulses}`);
        }
        gateOpen = false;
        completedPulses = target;
        return completedPulses;
      },
      status() {
        return {
          seed,
          epochMs,
          subjectId,
          queuedFrames: queuedFrames.size,
          gateOpen,
          executedCallbacks,
          pulses,
          completedPulses,
          queuedCallbacks: [...queuedFrames.values()].slice(0, 4).map((queued) => ({
            name: queued.name,
            stack: queued.stack,
          })),
          randomState,
        };
      },
    }),
  });
}

async function waitForBlobRuntime(page, subjectId, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  let lastState = null;
  while (performance.now() < deadline) {
    lastState = await page.evaluate((id) => {
      const gate = globalThis.__blobEvidenceHarness?.status();
      const menuState = document.querySelector('.hl2-menu')?.dataset.state;
      return {
        ready:
          Boolean(globalThis.__player) &&
          Boolean(gate) &&
          menuState === 'playing' &&
          gate.queuedFrames > 0 &&
          globalThis.__blobDebug?.list().includes(id) === true,
        sources: globalThis.__blobDebug?.list() ?? [],
        hasPlayer: Boolean(globalThis.__player),
        menuState,
        gate,
        bodyText: document.body?.innerText.slice(0, 300) ?? '',
      };
    }, subjectId);
    if (lastState.ready) return;
    await delay(100);
  }
  throw new Error(
    `Timeout esperando Blob V2 '${subjectId}'. Último estado: ${JSON.stringify(lastState)}`,
  );
}

function validateBrowserContract(runtime) {
  if (!runtime.sourceIds.includes(CONTRACT.subjectId)) {
    throw new Error(`El runtime no expone ${CONTRACT.subjectId}`);
  }
  if (!runtime.canvas || !runtime.webgl) {
    throw new Error('La evidencia no produjo un canvas WebGL utilizable');
  }
  if (!String(runtime.webgl.renderer).toLowerCase().includes('swiftshader')) {
    throw new Error(`Renderer no determinista: ${runtime.webgl.renderer}`);
  }
  if (
    runtime.viewport.width !== CONTRACT.viewport.width ||
    runtime.viewport.height !== CONTRACT.viewport.height
  ) {
    throw new Error(
      `Viewport observado ${runtime.viewport.width}x${runtime.viewport.height}, esperado ${CONTRACT.viewport.width}x${CONTRACT.viewport.height}`,
    );
  }
  if (runtime.deviceScaleFactor !== CONTRACT.deviceScaleFactor) {
    throw new Error(
      `DPR observado ${runtime.deviceScaleFactor}, esperado ${CONTRACT.deviceScaleFactor}`,
    );
  }
  if (
    runtime.browserClock.dateNow !== Date.parse(CONTRACT.epoch) ||
    runtime.browserClock.dateIso !== CONTRACT.epoch
  ) {
    throw new Error(
      `Reloj browser observado ${JSON.stringify(runtime.browserClock)}, esperado ${CONTRACT.epoch}`,
    );
  }
}

async function trimAndProbeVideo(rawPath, outputPath, preferredStartSeconds) {
  const ffmpeg = await resolvePlaywrightFfmpeg();
  const rawDurationSeconds = await probeVideoDuration(ffmpeg, rawPath);
  let trimStartSeconds = Math.min(
    Math.max(0, preferredStartSeconds),
    Math.max(0, rawDurationSeconds - CONTRACT.video.trimWindowSeconds),
  );
  let durationSeconds = 0;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await rm(outputPath, { force: true });
    const result = await runProcess(ffmpeg, [
      '-y',
      '-i', rawPath,
      '-ss', trimStartSeconds.toFixed(3),
      '-t', CONTRACT.video.trimWindowSeconds.toFixed(3),
      '-map', '0:v:0',
      '-c', 'copy',
      '-avoid_negative_ts', 'make_zero',
      outputPath,
    ]);
    if (result.code !== 0) {
      throw new Error(`FFmpeg no pudo recortar el WebM: ${tail(result.stderr, 30)}`);
    }
    durationSeconds = await probeVideoDuration(ffmpeg, outputPath);
    if (
      durationSeconds >= CONTRACT.video.minimumSeconds &&
      durationSeconds <= CONTRACT.video.maximumSeconds
    ) {
      return {
        durationSeconds,
        rawDurationSeconds,
        trimStartSeconds,
        preferredStartSeconds,
        trimWindowSeconds: CONTRACT.video.trimWindowSeconds,
        ffmpeg: path.basename(ffmpeg),
      };
    }
    if (durationSeconds < CONTRACT.video.minimumSeconds) {
      trimStartSeconds = Math.max(
        0,
        trimStartSeconds - (CONTRACT.video.minimumSeconds + 0.5 - durationSeconds),
      );
    } else {
      trimStartSeconds += durationSeconds - CONTRACT.video.maximumSeconds + 0.5;
    }
  }
  throw new Error(
    `Duración WebM fuera de contrato tras recorte: ${durationSeconds.toFixed(3)} s`,
  );
}

async function resolvePlaywrightFfmpeg() {
  if (playwrightFfmpeg) return playwrightFfmpeg;
  const coreBundle = await import('playwright-core/lib/coreBundle');
  const executable = coreBundle.registry.registry.findExecutable('ffmpeg');
  const executablePath = executable?.executablePath();
  if (!executablePath) {
    throw new Error(
      'Playwright no informó FFmpeg. Ejecutá `npm run evidence:blob-v2:install`.',
    );
  }
  await access(executablePath);
  playwrightFfmpeg = executablePath;
  return playwrightFfmpeg;
}

async function probeVideoDuration(ffmpeg, filePath) {
  const result = await runProcess(ffmpeg, ['-i', filePath]);
  const match = result.stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) {
    throw new Error(`FFmpeg no informó duración para ${filePath}: ${tail(result.stderr, 20)}`);
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function runProcess(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function resolveServer(runOptions) {
  if (runOptions.baseURL) {
    const baseURL = normalizeBaseURL(runOptions.baseURL);
    await waitForHttp(baseURL, 15_000);
    return { baseURL, close: async () => {} };
  }

  const port = Number(process.env.BLOB_V2_PORT ?? 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`BLOB_V2_PORT inválido: ${process.env.BLOB_V2_PORT}`);
  }
  const { createServer } = await import('vite');
  const server = await createServer({
    root: ROOT,
    clearScreen: false,
    logLevel: 'warn',
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      hmr: false,
    },
  });
  await server.listen();
  const baseURL = `http://127.0.0.1:${port}/`;
  await waitForHttp(baseURL, 15_000);
  return { baseURL, close: () => server.close() };
}

async function waitForHttp(baseURL, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  let lastError;
  while (performance.now() < deadline) {
    try {
      const response = await fetch(baseURL);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(`El servidor Vite no respondió en ${baseURL}`, { cause: lastError });
}

function attachDiagnostics(page, diagnostics) {
  page.on('console', (message) => {
    if (diagnostics.console.length >= 250) return;
    diagnostics.console.push({
      type: message.type(),
      text: message.text(),
      location: message.location(),
    });
  });
  page.on('pageerror', (error) => {
    diagnostics.pageErrors.push(serializeError(error));
  });
  page.on('requestfailed', (request) => {
    if (diagnostics.requestFailures.length >= 100) return;
    diagnostics.requestFailures.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText ?? 'unknown',
    });
  });
}

function freshDiagnostics() {
  return { console: [], pageErrors: [], requestFailures: [] };
}

function summarizeRuntime(runtime) {
  return {
    ...runtime,
    snapshot: summarizeSnapshot(runtime.snapshot),
  };
}

async function artifactInfo(filePath, relativeRoot) {
  await access(filePath);
  const [contents, details] = await Promise.all([readFile(filePath), stat(filePath)]);
  if (details.size === 0) throw new Error(`Artefacto vacío: ${filePath}`);
  return {
    file: path.relative(relativeRoot, filePath).replaceAll('\\', '/'),
    bytes: details.size,
    sha256: createHash('sha256').update(contents).digest('hex'),
  };
}

async function packageVersion(name) {
  try {
    const packageJson = JSON.parse(
      await readFile(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8'),
    );
    return packageJson.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function publicContract() {
  return {
    level: CONTRACT.level,
    subjectId: CONTRACT.subjectId,
    viewport: CONTRACT.viewport,
    deviceScaleFactor: CONTRACT.deviceScaleFactor,
    browserSeed: `0x${CONTRACT.browserSeed.toString(16)}`,
    organismSeed: `0x${CONTRACT.organismSeed.toString(16)}`,
    epoch: CONTRACT.epoch,
    simulationStepSeconds: CONTRACT.simulationStepSeconds,
    baselineSettleSteps: CONTRACT.baselineSettleSteps,
    cameras: CONTRACT.cameras,
    video: CONTRACT.video,
    golden: {
      root: path.relative(ROOT, GOLDEN_ROOT).replaceAll('\\', '/'),
      maximumChangedPixelRatio: GOLDEN_MAX_CHANGED_PIXEL_RATIO,
      changedPixelChannelDelta: GOLDEN_CHANNEL_DELTA,
    },
  };
}

function summarizeRun(screenshots, videos) {
  return {
    screenshots: {
      total: screenshots.length,
      passed: screenshots.filter((item) => item.status === 'passed').length,
      failed: screenshots.filter((item) => item.status !== 'passed').length,
    },
    videos: {
      total: videos.length,
      passed: videos.filter((item) => item.status === 'passed').length,
      failed: videos.filter((item) => item.status !== 'passed').length,
    },
  };
}

function failedResult(id, error) {
  return { id, status: 'failed', error: serializeError(error) };
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assertionError(kind, id, assertions) {
  const failures = assertions.filter((assertion) => !assertion.passed);
  return new Error(
    `${kind} ${id}: ${failures.length} assertion(s) fallaron: ${failures
      .map((failure) => failure.name)
      .join(', ')}`,
  );
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeRunFailure(stage, error) {
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  await writeJson(path.join(ARTIFACT_ROOT, 'run-failure.json'), {
    schemaVersion: CONTRACT.schemaVersion,
    status: 'failed',
    stage,
    generatedAt: new Date().toISOString(),
    error: serializeError(error),
  });
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause ? serializeError(error.cause) : undefined,
    };
  }
  return { name: 'NonError', message: String(error) };
}

function formatError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause ? `\nCausa: ${formatError(error.cause)}` : '';
  return `${error.message}${cause}`;
}

function normalizeBaseURL(value) {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

function selectEvidence(runOptions) {
  if (runOptions.screenshot) {
    const scenario = SCREENSHOT_SCENARIOS.find(
      (candidate) => candidate.id === runOptions.screenshot,
    );
    if (!scenario) throw unknownId('screenshot', runOptions.screenshot, SCREENSHOT_SCENARIOS);
    return { screenshots: [scenario], videos: [] };
  }
  if (runOptions.video) {
    const sequence = VIDEO_SEQUENCES.find(
      (candidate) => candidate.id === runOptions.video,
    );
    if (!sequence) throw unknownId('video', runOptions.video, VIDEO_SEQUENCES);
    return { screenshots: [], videos: [sequence] };
  }
  if (runOptions.screenshotsOnly) return { screenshots: [...SCREENSHOT_SCENARIOS], videos: [] };
  if (runOptions.videosOnly) return { screenshots: [], videos: [...VIDEO_SEQUENCES] };
  return { screenshots: [...SCREENSHOT_SCENARIOS], videos: [...VIDEO_SEQUENCES] };
}

function unknownId(kind, id, values) {
  return new Error(
    `${kind} desconocido '${id}'. Opciones: ${values.map((value) => value.id).join(', ')}`,
  );
}

function parseArgs(args) {
  const parsed = {
    screenshot: null,
    video: null,
    screenshotsOnly: false,
    videosOnly: false,
    updateGoldens: false,
    headed: process.env.BLOB_V2_HEADED === '1',
    baseURL: process.env.BLOB_V2_BASE_URL ?? null,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--headed') parsed.headed = true;
    else if (argument === '--help' || argument === '-h') parsed.help = true;
    else if (argument === '--screenshots-only') parsed.screenshotsOnly = true;
    else if (argument === '--videos-only') parsed.videosOnly = true;
    else if (argument === '--update-goldens') parsed.updateGoldens = true;
    else if (argument === '--screenshot' || argument === '--scenario') {
      parsed.screenshot = args[++index] ?? null;
      if (!parsed.screenshot) throw new Error(`${argument} requiere un id`);
    } else if (argument.startsWith('--screenshot=')) {
      parsed.screenshot = argument.slice('--screenshot='.length);
    } else if (argument.startsWith('--scenario=')) {
      parsed.screenshot = argument.slice('--scenario='.length);
    } else if (argument === '--video') {
      parsed.video = args[++index] ?? null;
      if (!parsed.video) throw new Error('--video requiere un id');
    } else if (argument.startsWith('--video=')) {
      parsed.video = argument.slice('--video='.length);
    } else if (argument === '--base-url') {
      parsed.baseURL = args[++index] ?? null;
      if (!parsed.baseURL) throw new Error('--base-url requiere una URL');
    } else if (argument.startsWith('--base-url=')) {
      parsed.baseURL = argument.slice('--base-url='.length);
    } else {
      throw new Error(`Argumento desconocido: ${argument}`);
    }
  }
  const modes = [
    Boolean(parsed.screenshot),
    Boolean(parsed.video),
    parsed.screenshotsOnly,
    parsed.videosOnly,
  ].filter(Boolean).length;
  if (modes > 1) throw new Error('Elegí un único selector de screenshots/videos');
  return parsed;
}

function printHelp() {
  console.log(`Uso: node scripts/blob-v2-evidence.mjs [opciones]

Sin selector genera 15 screenshots verificables y exactamente cuatro videos.

Opciones:
  --screenshot <id>  Captura un screenshot y su sidecar.
  --video <id>       Captura una secuencia WebM y su sidecar.
  --screenshots-only Genera la matriz completa de screenshots.
  --videos-only      Genera exactamente las cuatro secuencias principales.
  --update-goldens   Actualiza explicitamente tests/golden/blob-v2/*.png.
  --base-url <url>   Usa un Vite externo en lugar del server embebido.
  --headed           Ejecuta Chromium con ventana visible.
  --help             Muestra esta ayuda.

Variables: BLOB_V2_BASE_URL, BLOB_V2_PORT, BLOB_V2_HEADED,
           BLOB_V2_ARTIFACT_DIR.`);
}

function tail(value, lines) {
  return value.split(/\r?\n/).slice(-lines).join('\n');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
