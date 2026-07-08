import {
  Frustum,
  Matrix4,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from "three";
import type { PortalFrame } from "./PortalFrame";
import {
  portalDeltaQuaternion,
  portalNormal,
  transformPointThroughPortal,
} from "./PortalMath";
import {
  PortalSurfaceMaterial,
  PortalSurfaceMode,
} from "./PortalSurfaceMaterial";

export interface PortalViewRendererOptions {
  /** Render-target size as a fraction of the drawing buffer. */
  renderScale: number;
  /** Portals farther than this from the camera skip their pass. */
  maxViewDistance: number;
}

export interface PortalViewTarget {
  /** Portal the viewer looks into. */
  entry: PortalFrame;
  /** Paired portal whose side of the world gets rendered. */
  exit: PortalFrame;
  /** Disc material of the entry portal, receives the rendered view. */
  material: PortalSurfaceMaterial;
  /**
   * Surface mesh of the EXIT portal. The virtual camera sits behind the exit
   * plane, INSIDE the exit portal's extruded plug; hiding it for this pass
   * stops the double-sided plug from wrapping the camera in swirl.
   */
  exitSurface: Object3D;
}

// Clip plane sits 1 cm behind the exit surface so the wall backing the exit
// portal still renders (no seam gap) while everything behind it is culled.
const CLIP_BIAS = 0.01;
// Keep rendering while the camera is slightly behind the entry plane: the
// disc can still be on screen for a frame while crossing.
const BEHIND_MARGIN = -0.2;

const TMP_NORMAL = new Vector3();
const TMP_DELTA_Q = new Quaternion();
const TMP_TO_CAMERA = new Vector3();
const TMP_SPHERE_CENTER = new Vector3();
const TMP_SPHERE = new Sphere();
const TMP_PROJ_VIEW = new Matrix4();
const TMP_SIZE = new Vector2();

/**
 * Render-to-texture pass of the world seen through each linked portal.
 * Recursion depth 1 by construction: while a pass renders, every portal disc
 * shows the cheap fallback fill, so a portal seen through a portal swirls.
 */
export class PortalViewRenderer {
  private readonly targets: [WebGLRenderTarget, WebGLRenderTarget];
  private readonly virtualCamera = new PerspectiveCamera();
  private readonly clipPlane = new Plane();
  private readonly frustum = new Frustum();

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly options: PortalViewRendererOptions,
  ) {
    this.targets = [this.createTarget(), this.createTarget()];
  }

  /**
   * Renders up to two portal views. Call once per frame before the main
   * render. `allMaterials` is every live portal disc (they swap to fallback
   * during passes); `hidden` objects (e.g. the first-person viewmodel) are
   * invisible inside the views; `revealed` objects (e.g. the player's body,
   * kept invisible in first person) are visible ONLY inside the views.
   */
  render(
    scene: Scene,
    camera: PerspectiveCamera,
    views: readonly PortalViewTarget[],
    allMaterials: readonly PortalSurfaceMaterial[],
    hidden: readonly Object3D[] = [],
    revealed: readonly Object3D[] = [],
  ): void {
    this.renderer.getDrawingBufferSize(TMP_SIZE);
    const width = Math.max(1, Math.floor(TMP_SIZE.x * this.options.renderScale));
    const height = Math.max(1, Math.floor(TMP_SIZE.y * this.options.renderScale));
    const screenWidth = TMP_SIZE.x;
    const screenHeight = TMP_SIZE.y;

    TMP_PROJ_VIEW.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(TMP_PROJ_VIEW);

    for (let i = 0; i < views.length && i < 2; i++) {
      const view = views[i];
      if (!this.shouldRender(view.entry, camera)) {
        view.material.setMode(PortalSurfaceMode.idle);
        continue;
      }

      const target = this.targets[i];
      if (target.width !== width || target.height !== height) {
        target.setSize(width, height);
      }

      this.renderView(scene, camera, view, target, allMaterials, hidden, revealed);
      view.material.setView(target.texture, screenWidth, screenHeight);
      view.material.setMode(PortalSurfaceMode.linked);
    }
  }

  dispose(): void {
    for (const target of this.targets) {
      target.dispose();
    }
  }

  private shouldRender(entry: PortalFrame, camera: PerspectiveCamera): boolean {
    TMP_TO_CAMERA.copy(camera.position).sub(entry.position);
    if (TMP_TO_CAMERA.length() > this.options.maxViewDistance) {
      return false;
    }
    portalNormal(entry, TMP_NORMAL);
    if (TMP_TO_CAMERA.dot(TMP_NORMAL) < BEHIND_MARGIN) {
      return false;
    }
    TMP_SPHERE.center.copy(entry.position);
    TMP_SPHERE.radius = Math.max(entry.halfWidth, entry.halfHeight) + 0.2;
    return this.frustum.intersectsSphere(TMP_SPHERE);
  }

  private renderView(
    scene: Scene,
    camera: PerspectiveCamera,
    view: PortalViewTarget,
    target: WebGLRenderTarget,
    allMaterials: readonly PortalSurfaceMaterial[],
    hidden: readonly Object3D[],
    revealed: readonly Object3D[],
  ): void {
    const vcam = this.virtualCamera;
    vcam.fov = camera.fov;
    vcam.aspect = camera.aspect;
    vcam.near = camera.near;
    vcam.far = camera.far;
    vcam.updateProjectionMatrix();

    transformPointThroughPortal(
      camera.position,
      view.entry,
      view.exit,
      vcam.position,
    );
    portalDeltaQuaternion(view.entry, view.exit, TMP_DELTA_Q);
    vcam.quaternion.copy(TMP_DELTA_Q).multiply(camera.quaternion);
    vcam.updateMatrixWorld(true);

    // Cull everything behind the exit wall so geometry between the virtual
    // camera and the exit portal does not occlude the view.
    portalNormal(view.exit, TMP_NORMAL);
    this.clipPlane.setFromNormalAndCoplanarPoint(
      TMP_NORMAL,
      TMP_SPHERE_CENTER.copy(view.exit.position).addScaledVector(
        TMP_NORMAL,
        -CLIP_BIAS,
      ),
    );

    const previousModes = allMaterials.map((material) => material.getMode());
    for (const material of allMaterials) {
      material.setMode(PortalSurfaceMode.fallback);
    }
    const previousVisibility = hidden.map((object) => object.visible);
    for (const object of hidden) {
      object.visible = false;
    }
    const previousRevealVisibility = revealed.map((object) => object.visible);
    for (const object of revealed) {
      object.visible = true;
    }
    const exitSurfaceWasVisible = view.exitSurface.visible;
    view.exitSurface.visible = false;

    const previousTarget = this.renderer.getRenderTarget();
    this.renderer.clippingPlanes = [this.clipPlane];
    this.renderer.setRenderTarget(target);
    this.renderer.render(scene, vcam);
    this.renderer.setRenderTarget(previousTarget);
    this.renderer.clippingPlanes = [];

    view.exitSurface.visible = exitSurfaceWasVisible;
    revealed.forEach((object, index) => {
      object.visible = previousRevealVisibility[index];
    });
    hidden.forEach((object, index) => {
      object.visible = previousVisibility[index];
    });
    allMaterials.forEach((material, index) => {
      material.setMode(previousModes[index]);
    });
  }

  private createTarget(): WebGLRenderTarget {
    return new WebGLRenderTarget(1, 1, { depthBuffer: true });
  }
}
