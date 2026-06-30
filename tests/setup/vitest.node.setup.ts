import { beforeAll, afterEach, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";

beforeAll(async () => {
  await RAPIER.init();
});

afterEach(() => {
  vi.restoreAllMocks();
});
