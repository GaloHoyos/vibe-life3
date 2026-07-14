import { chromium } from "playwright";
import { createServer } from "vite";
import { describe, expect, it } from "vitest";

interface BrowserResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly stack?: string;
  readonly context?: string;
  readonly driver?: string;
  readonly shaderErrors?: readonly unknown[];
  readonly compile?: {
    readonly marchingVertices: number;
    readonly triangles: number;
    readonly coloredPixels: number;
    readonly immediateWound: {
      readonly closedCenter: readonly number[];
      readonly openedCenter: readonly number[];
      readonly centerDifference: number;
      readonly tendons: number;
      readonly shedDroplets: number;
    };
    readonly glError: number;
    readonly programsCompiled: number;
    readonly afterDispose: ResourceCounts;
  };
  readonly soak?: {
    readonly cycles: number;
    readonly maxSurfaces: number;
    readonly maxPendingJobs: number;
    readonly maxGeometries: number;
    readonly maxBuffers: number;
    readonly maxPrograms: number;
    readonly afterDispose: ResourceCounts;
  };
  readonly baseline?: ResourceCounts;
  readonly finalResources?: ResourceCounts;
}

interface ResourceCounts {
  readonly geometries: number;
  readonly buffers: number;
  readonly programs: number;
  readonly vertexArrays: number;
}

describe("Blob V2 real WebGL backend", () => {
  it("compiles and renders MarchingCubes, then survives 100 cleanup cycles", async () => {
    const server = await createServer({
      root: process.cwd(),
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, strictPort: false },
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") {
      await server.close();
      throw new Error("Vite did not expose a browser-test port");
    }

    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          "--ignore-gpu-blocklist",
          "--enable-webgl",
          "--enable-unsafe-swiftshader",
          "--use-angle=swiftshader",
          "--use-gl=angle",
        ],
      });
      const url = `http://127.0.0.1:${address.port}/tests/browser/blob-v2-webgl.html`;
      const page = await browser.newPage({ viewport: { width: 128, height: 128 } });
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
      page.on("console", (message) => {
        if (message.type() === "error") pageErrors.push(message.text());
      });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 110_000 });
      await page.waitForFunction(
        () => document.documentElement.hasAttribute("data-blob-v2-result"),
        undefined,
        { timeout: 110_000 },
      );
      const encoded = await page.getAttribute("html", "data-blob-v2-result");
      if (!encoded) {
        throw new Error(
          `Blob WebGL harness returned no result marker.\n${pageErrors.join("\n")}`,
        );
      }
      const result = JSON.parse(
        Buffer.from(encoded, "base64").toString("utf8"),
      ) as BrowserResult;
      if (!result.ok) {
        throw new Error(
          `${result.error ?? "WebGL harness failed"}\n${result.stack ?? ""}\n${pageErrors.join("\n")}`,
        );
      }

      expect(result.context).toBe("webgl2");
      expect(result.driver).toBeTruthy();
      expect(result.shaderErrors).toEqual([]);
      expect(result.compile).toMatchObject({
        glError: 0,
        afterDispose: result.baseline,
      });
      expect(result.compile?.marchingVertices).toBeGreaterThan(0);
      expect(result.compile?.triangles).toBeGreaterThan(0);
      expect(result.compile?.coloredPixels).toBeGreaterThan(20);
      expect(result.compile?.immediateWound.centerDifference).toBeGreaterThan(30);
      expect(result.compile?.immediateWound.openedCenter[0]).toBeGreaterThan(
        result.compile!.immediateWound.openedCenter[1] + 20,
      );
      expect(result.compile?.immediateWound.tendons).toBe(3);
      expect(result.compile?.immediateWound.shedDroplets).toBe(2);
      expect(result.compile?.programsCompiled).toBeGreaterThan(0);
      expect(result.soak).toMatchObject({
        cycles: 100,
        maxSurfaces: 7,
        afterDispose: result.baseline,
      });
      expect(result.soak?.maxPendingJobs).toBeGreaterThan(0);
      expect(result.soak?.maxBuffers).toBeGreaterThan(result.baseline!.buffers);
      expect(result.soak?.maxPrograms).toBeGreaterThan(result.baseline!.programs);
      expect(result.finalResources).toEqual(result.baseline);
    } finally {
      await browser?.close();
      await server.close();
    }
  }, 120_000);
});
