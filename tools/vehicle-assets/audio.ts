import type { GeneratedAudioStats } from "./types.js";

const SAMPLE_RATE = 22_050;

interface AudioLayerSpec {
  readonly fileName: string;
  readonly durationSeconds: number;
  readonly loop: boolean;
  readonly synth: (
    time: number,
    phase: number,
    sampleIndex: number,
    sampleCount: number,
  ) => number;
}

export interface GeneratedAudioAsset {
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly durationSeconds: number;
}

function hashNoise(index: number, seed: number): number {
  let value = Math.imul(index ^ seed, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return ((value >>> 0) / 0xffffffff) * 2 - 1;
}

function periodicNoise(phase: number, seed: number): number {
  let value = 0;
  for (let harmonic = 1; harmonic <= 12; harmonic += 1) {
    const amplitude = 1 / Math.pow(harmonic, 0.72);
    const offset = hashNoise(harmonic, seed) * Math.PI;
    value += Math.sin(Math.PI * 2 * phase * harmonic + offset) * amplitude;
  }
  return value / 4.2;
}

function softClip(value: number): number {
  return Math.tanh(value * 1.25) * 0.78;
}

function impactEnvelope(phase: number, sharpness: number): number {
  return Math.exp(-phase * sharpness);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function encodeWav(samples: Float32Array): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * bytesPerSample, Math.round(sample * 32767), true);
  }

  return new Uint8Array(buffer);
}

const AUDIO_LAYERS: readonly AudioLayerSpec[] = [
  {
    fileName: "buggy-engine-loop.wav",
    durationSeconds: 4,
    loop: true,
    synth: (time, phase) => {
      const firing = Math.sin(Math.PI * 2 * 27 * time);
      const exhaust = Math.sin(Math.PI * 2 * 54 * time + 0.3);
      return softClip(firing * 0.48 + exhaust * 0.2 + periodicNoise(phase, 11) * 0.22);
    },
  },
  {
    fileName: "buggy-transmission-loop.wav",
    durationSeconds: 3,
    loop: true,
    synth: (time, phase) =>
      softClip(
        Math.sin(Math.PI * 2 * 186 * time) * 0.18 +
          Math.sin(Math.PI * 2 * 372 * time) * 0.08 +
          periodicNoise(phase, 13) * 0.05,
      ),
  },
  {
    fileName: "buggy-skid-loop.wav",
    durationSeconds: 2,
    loop: true,
    synth: (_time, phase) =>
      softClip(
        periodicNoise(phase, 17) * 0.48 +
          Math.sin(Math.PI * 2 * phase * 79) * 0.08,
      ),
  },
  {
    fileName: "airboat-engine-loop.wav",
    durationSeconds: 4,
    loop: true,
    synth: (time, phase) =>
      softClip(
        Math.sin(Math.PI * 2 * 42 * time) * 0.28 +
          Math.sin(Math.PI * 2 * 84 * time + 0.5) * 0.12 +
          periodicNoise(phase, 23) * 0.14,
      ),
  },
  {
    fileName: "airboat-fan-loop.wav",
    durationSeconds: 4,
    loop: true,
    synth: (time, phase) =>
      softClip(
        Math.sin(Math.PI * 2 * 116 * time) * 0.19 +
          Math.sin(Math.PI * 2 * 232 * time) * 0.09 +
          periodicNoise(phase, 29) * 0.31,
      ),
  },
  {
    fileName: "airboat-water-loop.wav",
    durationSeconds: 3,
    loop: true,
    synth: (_time, phase) =>
      softClip(
        periodicNoise(phase, 31) * 0.42 +
          Math.sin(Math.PI * 2 * phase * 11) * 0.09,
      ),
  },
  {
    fileName: "helicopter-rotor-loop.wav",
    durationSeconds: 4,
    loop: true,
    synth: (time, phase) => {
      const bladePass = Math.sin(Math.PI * 2 * 19 * time);
      const turbine = Math.sin(Math.PI * 2 * 152 * time + 0.4);
      return softClip(
        bladePass * 0.38 +
          turbine * 0.1 +
          periodicNoise(phase, 37) * 0.22,
      );
    },
  },
  {
    fileName: "helicopter-cabin-loop.wav",
    durationSeconds: 4,
    loop: true,
    synth: (time, phase) =>
      softClip(
        Math.sin(Math.PI * 2 * 38 * time) * 0.2 +
          periodicNoise(phase, 41) * 0.16,
      ),
  },
  {
    fileName: "combine-glider-engine-loop.wav",
    durationSeconds: 4,
    loop: true,
    synth: (time, phase) =>
      softClip(
        Math.sin(Math.PI * 2 * 73 * time) * 0.2 +
          Math.sin(Math.PI * 2 * 146 * time + Math.sin(phase * Math.PI * 2) * 0.22) * 0.13 +
          periodicNoise(phase, 43) * 0.09,
      ),
  },
  {
    fileName: "combine-glider-hover-loop.wav",
    durationSeconds: 3,
    loop: true,
    synth: (time, phase) =>
      softClip(
        Math.sin(Math.PI * 2 * 214 * time + Math.sin(phase * Math.PI * 4) * 0.7) * 0.11 +
          Math.sin(Math.PI * 2 * 428 * time) * 0.045 +
          periodicNoise(phase, 67) * 0.06,
      ),
  },
  {
    fileName: "vehicle-alarm-loop.wav",
    durationSeconds: 2,
    loop: true,
    synth: (time) => {
      const pulse = Math.sin(Math.PI * 2 * 2 * time) > -0.2 ? 1 : 0;
      return Math.sin(Math.PI * 2 * 880 * time) * 0.32 * pulse;
    },
  },
  {
    fileName: "vehicle-damage-hit.wav",
    durationSeconds: 1.25,
    loop: false,
    synth: (time, phase, index) => {
      const body = Math.sin(Math.PI * 2 * (94 - 40 * phase) * time);
      const debris = hashNoise(index, 47);
      return softClip((body * 0.55 + debris * 0.34) * impactEnvelope(phase, 5));
    },
  },
  {
    fileName: "vehicle-crash.wav",
    durationSeconds: 3.5,
    loop: false,
    synth: (time, phase, index) => {
      const lowBody = Math.sin(Math.PI * 2 * (42 - 18 * phase) * time);
      const tearing =
        hashNoise(index, 53) * 0.43 +
        Math.sin(Math.PI * 2 * 137 * time) * 0.11;
      const secondary = Math.exp(-Math.pow((phase - 0.47) * 15, 2)) * 0.45;
      return softClip(
        (lowBody * 0.62 + tearing) * impactEnvelope(phase, 1.65) +
          secondary * hashNoise(index, 59),
      );
    },
  },
] as const;

function synthesizeLayer(layer: AudioLayerSpec): GeneratedAudioAsset {
  const sampleCount = Math.round(layer.durationSeconds * SAMPLE_RATE);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const phase = index / sampleCount;
    const time = index / SAMPLE_RATE;
    const edgeEnvelope = layer.loop
      ? 1
      : Math.min(1, index / 96, (sampleCount - index - 1) / 96);
    samples[index] =
      layer.synth(time, phase, index, sampleCount) * Math.max(0, edgeEnvelope);
  }
  return {
    fileName: layer.fileName,
    bytes: encodeWav(samples),
    durationSeconds: layer.durationSeconds,
  };
}

export function createAudioAssets(): readonly GeneratedAudioAsset[] {
  return AUDIO_LAYERS.map(synthesizeLayer);
}

export function createAudioStats(
  assets: readonly GeneratedAudioAsset[],
): GeneratedAudioStats {
  const files = assets.map((asset) => ({
    path: `audio/${asset.fileName}`,
    bytes: asset.bytes.byteLength,
    durationSeconds: asset.durationSeconds,
  }));
  return {
    files,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
}
