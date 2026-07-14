/// <reference lib="webworker" />
import { exportTileCache, init as initRecast } from "recast-navigation";
import { generateTileCache } from "recast-navigation/generators";
import type { NavAgentProfile } from "./NavigationTypes";
import { navigationBuildConfig } from "./NavigationBuildConfig";

interface BakeRequest {
  positions: ArrayBuffer;
  indices: ArrayBuffer;
  profiles: NavAgentProfile[];
}

self.onmessage = async (event: MessageEvent<BakeRequest>) => {
  try {
    await initRecast();
    const positions = new Float32Array(event.data.positions);
    const indices = new Uint32Array(event.data.indices);
    const domains: Array<{ profileId: string; data: ArrayBuffer }> = [];
    const transfer: Transferable[] = [];
    for (const profile of event.data.profiles) {
      const generated = generateTileCache(positions, indices, navigationBuildConfig(profile));
      if (!generated.success) throw new Error(`${profile.id}: ${generated.error}`);
      const bytes = exportTileCache(generated.navMesh, generated.tileCache);
      const data = new Uint8Array(bytes).buffer;
      domains.push({ profileId: profile.id, data });
      transfer.push(data);
      generated.tileCache.destroy();
      generated.navMesh.destroy();
    }
    self.postMessage({ success: true, domains }, { transfer });
  } catch (error) {
    self.postMessage({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
