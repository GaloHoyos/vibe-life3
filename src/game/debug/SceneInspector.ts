import type { Object3D, Scene } from "three";
import { Mesh, SkinnedMesh } from "three";

declare global {
  interface Window {
    /**
     * Recorre la escena y reporta los meshes que mÃ¡s triangulos aportan.
     * Llamado desde la consola del browser para diagnosticar bottlenecks
     * de geometrÃ­a (modelos GLB no decimados, primitives gigantes, etc.).
     */
    __inspectScene?: (topN?: number) => void;
  }
}

interface MeshStats {
  name: string;
  type: string;
  triangles: number;
  vertices: number;
  visible: boolean;
  castShadow: boolean;
  ancestry: string;
}

/**
 * Instala `window.__inspectScene(topN=20)` con un resumen de geometrÃ­a por
 * mesh. No corre nada en el game loop â€” solo se activa al invocarlo desde
 * consola, asÃ­ que es seguro dejarlo siempre.
 */
export function installSceneInspector(scene: Scene): () => void {
  const inspect = (topN = 20): void => {
    const stats: MeshStats[] = [];
    let totalTris = 0;
    let totalVerts = 0;
    let meshCount = 0;
    let skinnedCount = 0;

    scene.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      meshCount += 1;
      if (obj instanceof SkinnedMesh) skinnedCount += 1;

      const geo = obj.geometry;
      if (!geo) return;
      const index = geo.index;
      const pos = geo.attributes.position;
      const vertices = pos?.count ?? 0;
      const triangles = index ? index.count / 3 : vertices / 3;
      totalTris += triangles;
      totalVerts += vertices;
      if (!obj.visible) return;
      stats.push({
        name: obj.name || "(unnamed)",
        type: obj.type,
        triangles,
        vertices,
        visible: obj.visible,
        castShadow: obj.castShadow,
        ancestry: buildAncestry(obj),
      });
    });

    stats.sort((a, b) => b.triangles - a.triangles);
    const top = stats.slice(0, topN);

    console.group(`[SceneInspector] ${meshCount} meshes, ${skinnedCount} skinned, ${Math.round(totalTris).toLocaleString()} tris, ${totalVerts.toLocaleString()} verts`);
    console.table(
      top.map((s) => ({
        name: s.name.slice(0, 40),
        tris: Math.round(s.triangles),
        verts: s.vertices,
        shadow: s.castShadow ? "Y" : "n",
        ancestry: s.ancestry.slice(-60),
      })),
    );
    const otherTris = stats
      .slice(topN)
      .reduce((sum, s) => sum + s.triangles, 0);
    if (otherTris > 0) {
      console.info(
        `(otros ${stats.length - topN} meshes suman ${Math.round(otherTris).toLocaleString()} tris)`,
      );
    }
    console.groupEnd();
  };

  window.__inspectScene = inspect;
  return () => {
    if (window.__inspectScene === inspect) {
      delete window.__inspectScene;
    }
  };
}

function buildAncestry(obj: Object3D): string {
  const parts: string[] = [];
  let cur: Object3D | null = obj;
  while (cur) {
    parts.unshift(cur.name || cur.type);
    cur = cur.parent;
  }
  return parts.join(" > ");
}
