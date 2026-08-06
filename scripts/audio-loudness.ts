/**
 * Mide la sonoridad de cada asset de audio y genera la tabla que el runtime
 * usa para normalizar ganancias (`npm run audio:levels`).
 *
 * Métrica: loudness K-weighted de ITU-R BS.1770 sobre la ventana de 400 ms más
 * fuerte ("momentary max"), no la integrada con gating. El gating de BS.1770
 * descarta bloques por debajo del umbral relativo y devuelve -70 LUFS para
 * cualquier clip de menos de 400 ms — o sea, para la mitad del catálogo (pasos,
 * clicks, impactos). En clips más cortos que la ventana se mide sobre su
 * duración real en vez de rellenar con silencio: interesa el golpe percibido,
 * no cuánto dura.
 *
 * Requiere ffmpeg/ffprobe en el PATH. El resultado se commitea, así que ni el
 * build ni el deploy dependen de tenerlos.
 */

import { spawn } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const SampleRate = 48_000;
/** Ventana momentánea de BS.1770. */
const WindowSeconds = 0.4;
/** Solapamiento del 75%: la ventana avanza de a un bloque. */
const BlocksPerWindow = 4;
const BlockSamples = (SampleRate * WindowSeconds) / BlocksPerWindow;
/** Piso de silencio digital: por debajo el clip no se normaliza. */
const SilenceFloorLufs = -70;
/**
 * Los lechos de ambiente duran minutos; medir más no cambia el máximo y
 * multiplica la memoria del decode.
 */
const MaxAnalysisSeconds = 180;

const AudioExtensions = [".wav", ".mp3"];

/** Ganancias de canal de BS.1770 (L, R, C, Ls, Rs). */
const ChannelWeights = [1, 1, 1, 1.41, 1.41];

interface BiquadCoefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/** Filtro de cabeza (shelving) del K-weighting, a 48 kHz. */
const HeadShelf: BiquadCoefficients = {
  b0: 1.53512485958697,
  b1: -2.69169618940638,
  b2: 1.19839281085285,
  a1: -1.69065929318241,
  a2: 0.73248077421585,
};

/** Filtro RLB (paso altos) del K-weighting, a 48 kHz. */
const RlbHighPass: BiquadCoefficients = {
  b0: 1,
  b1: -2,
  b2: 1,
  a1: -1.99004745483398,
  a2: 0.99007225036621,
};

class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(private readonly c: BiquadCoefficients) {}

  process(x: number): number {
    const y =
      this.c.b0 * x +
      this.c.b1 * this.x1 +
      this.c.b2 * this.x2 -
      this.c.a1 * this.y1 -
      this.c.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

interface LoudnessResult {
  readonly lufs: number;
  readonly peak: number;
}

/**
 * Acumula energía K-weighted por bloques de 100 ms y sostiene la suma de los
 * últimos 4 para obtener la ventana de 400 ms sin guardar las muestras.
 */
class LoudnessMeter {
  private readonly filters: Array<[Biquad, Biquad]>;
  private readonly blockSums: number[];
  private readonly history: number[][];
  private blockCursor = 0;
  private totalSamples = 0;
  private maxWindowEnergy = 0;
  private peak = 0;

  constructor(private readonly channels: number) {
    this.filters = Array.from({ length: channels }, () => [
      new Biquad(HeadShelf),
      new Biquad(RlbHighPass),
    ]);
    this.blockSums = new Array<number>(channels).fill(0);
    this.history = Array.from({ length: channels }, () => []);
  }

  pushFrame(frame: Float32Array): void {
    for (let channel = 0; channel < this.channels; channel += 1) {
      const sample = frame[channel] ?? 0;
      const magnitude = Math.abs(sample);
      if (magnitude > this.peak) {
        this.peak = magnitude;
      }
      const stages = this.filters[channel];
      if (!stages) {
        continue;
      }
      const filtered = stages[1].process(stages[0].process(sample));
      const energy = filtered * filtered;
      this.blockSums[channel] = (this.blockSums[channel] ?? 0) + energy;
    }

    this.totalSamples += 1;
    this.blockCursor += 1;
    if (this.blockCursor >= BlockSamples) {
      this.closeBlock();
    }
  }

  finish(): LoudnessResult {
    // Sin una ventana completa (clip más corto que 400 ms) se mide sobre la
    // duración real: rellenar con silencio subestimaría el golpe percibido.
    if (this.maxWindowEnergy === 0) {
      const energy = this.weightedEnergy(
        this.blockSums.map((sum, channel) => sum + sumOf(this.history[channel])),
      );
      const samples = this.totalSamples;
      return {
        lufs: toLufs(samples > 0 ? energy / samples : 0),
        peak: this.peak,
      };
    }

    return { lufs: toLufs(this.maxWindowEnergy), peak: this.peak };
  }

  private closeBlock(): void {
    for (let channel = 0; channel < this.channels; channel += 1) {
      const entries = this.history[channel];
      if (!entries) {
        continue;
      }
      entries.push(this.blockSums[channel] ?? 0);
      if (entries.length > BlocksPerWindow) {
        entries.shift();
      }
      this.blockSums[channel] = 0;
    }

    const first = this.history[0];
    if (first && first.length === BlocksPerWindow) {
      const energy = this.weightedEnergy(
        this.history.map((entries) => sumOf(entries)),
      );
      const meanSquare = energy / (BlockSamples * BlocksPerWindow);
      if (meanSquare > this.maxWindowEnergy) {
        this.maxWindowEnergy = meanSquare;
      }
    }

    this.blockCursor = 0;
  }

  private weightedEnergy(perChannel: readonly number[]): number {
    return perChannel.reduce(
      (total, value, channel) => total + (ChannelWeights[channel] ?? 1) * value,
      0,
    );
  }
}

function sumOf(values: readonly number[] | undefined): number {
  return (values ?? []).reduce((total, value) => total + value, 0);
}

function toLufs(meanSquare: number): number {
  if (meanSquare <= 0) {
    return SilenceFloorLufs;
  }
  const lufs = -0.691 + 10 * Math.log10(meanSquare);
  return Math.max(SilenceFloorLufs, lufs);
}

async function run(command: string, args: string[]): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(command, args);
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on("error", fail);
    child.on("close", (code) => {
      if (code === 0) {
        done(out);
      } else {
        fail(new Error(`${command} salió con código ${code}: ${err}`));
      }
    });
  });
}

async function readChannelCount(file: string): Promise<number> {
  const out = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=channels",
    "-of",
    "csv=p=0",
    file,
  ]);
  const channels = Number.parseInt(out.trim(), 10);
  if (!Number.isFinite(channels) || channels <= 0) {
    throw new Error(`No se pudo leer el número de canales de ${file}`);
  }
  return channels;
}

/**
 * Decodifica en streaming y alimenta el medidor por frames. Un lecho de
 * ambiente de tres minutos son ~140 MB de f32; bufferearlo entero por archivo
 * no escala.
 */
async function measure(file: string): Promise<LoudnessResult> {
  const channels = await readChannelCount(file);
  const meter = new LoudnessMeter(channels);
  const frameBytes = channels * 4;
  const frame = new Float32Array(channels);

  return new Promise((done, fail) => {
    const child = spawn("ffmpeg", [
      "-v",
      "error",
      "-t",
      String(MaxAnalysisSeconds),
      "-i",
      file,
      "-ar",
      String(SampleRate),
      "-f",
      "f32le",
      "-",
    ]);

    let leftover = Buffer.alloc(0);
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const data =
        leftover.length > 0 ? Buffer.concat([leftover, chunk]) : chunk;
      const frames = Math.floor(data.length / frameBytes);
      for (let i = 0; i < frames; i += 1) {
        const base = i * frameBytes;
        for (let channel = 0; channel < channels; channel += 1) {
          frame[channel] = data.readFloatLE(base + channel * 4);
        }
        meter.pushFrame(frame);
      }
      leftover = data.subarray(frames * frameBytes);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", fail);
    child.on("close", (code) => {
      if (code !== 0) {
        fail(new Error(`ffmpeg falló en ${file}: ${stderr}`));
        return;
      }
      done(meter.finish());
    });
  });
}

async function collectAudioFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectAudioFiles(path)));
    } else if (AudioExtensions.some((ext) => entry.name.endsWith(ext))) {
      files.push(path);
    }
  }

  return files;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        const item = items[index];
        if (item === undefined) {
          return;
        }
        results[index] = await task(item);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

const projectRoot = process.cwd();
/**
 * Los vehículos tienen su propia carpeta de assets (los genera
 * `npm run vehicles:generate`) y su propio prefijo de llave, porque no pasan
 * por el glob de `AudioManifest`.
 */
const analysisRoots = [
  { dir: "src/engine/assets/sounds", prefix: "" },
  { dir: "src/game/assets/vehicles/audio", prefix: "vehicles/" },
];
const outputFile = resolve(
  projectRoot,
  "src/engine/audio/generated/loudness.generated.ts",
);

const targets: Array<{ file: string; key: string }> = [];
for (const root of analysisRoots) {
  const dir = resolve(projectRoot, root.dir);
  const files = (await collectAudioFiles(dir)).sort();
  for (const file of files) {
    targets.push({
      file,
      key: root.prefix + relative(dir, file).split("\\").join("/"),
    });
  }
}

process.stdout.write(`Analizando ${targets.length} clips...\n`);

const measured = await mapWithConcurrency(targets, 8, async (target) => {
  const result = await measure(target.file);
  return {
    key: target.key,
    lufs: round(result.lufs, 2),
    peak: round(result.peak, 4),
  };
});

const entries = measured
  .slice()
  .sort((a, b) => a.key.localeCompare(b.key))
  .map(
    (entry) =>
      `  "${entry.key}": { lufs: ${entry.lufs}, peak: ${entry.peak} },`,
  )
  .join("\n");

const contents = `// GENERADO por \`npm run audio:levels\`. No editar a mano.
//
// Sonoridad K-weighted (BS.1770) de la ventana de 400 ms más fuerte de cada
// clip, y su pico de muestra. \`resolveClipGain\` los usa para nivelar el
// catálogo contra el objetivo de cada rol.
import type { ClipLoudness } from "@engine/audio/mix/MixProfile";

export const ClipLoudnessTable: Readonly<Record<string, ClipLoudness>> = {
${entries}
};
`;

await writeFile(outputFile, contents, "utf8");

const silent = measured.filter((entry) => entry.lufs <= SilenceFloorLufs);
process.stdout.write(
  `Escrito ${relative(projectRoot, outputFile)} (${measured.length} clips`,
);
process.stdout.write(silent.length > 0 ? `, ${silent.length} en silencio)\n` : ")\n");
for (const entry of silent) {
  process.stdout.write(`  silencio: ${entry.key}\n`);
}
