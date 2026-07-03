import { Color, ShaderMaterial, type Texture, Vector2 } from "three";

export const PortalSurfaceMode = {
  /** Animated swirl — the portal exists but the pair is not linked. */
  idle: 0,
  /** Screen-space sample of the rendered view through the paired portal. */
  linked: 1,
  /** Cheap fill used while rendering portal passes (recursion depth 1). */
  fallback: 2,
} as const;

export type PortalSurfaceModeValue =
  (typeof PortalSurfaceMode)[keyof typeof PortalSurfaceMode];

// The logdepthbuf chunks are mandatory: the renderer runs with a logarithmic
// depth buffer, so a ShaderMaterial without them writes incompatible depth
// and the disc loses occlusion against the rest of the scene.
const VERTEX_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uMode;
  uniform vec3 uColor;
  uniform float uTime;
  uniform sampler2D uView;
  uniform vec2 uResolution;
  varying vec2 vUv;

  vec3 swirl(vec2 centered, float r, float dim) {
    float angle = atan(centered.y, centered.x);
    float band = sin(angle * 3.0 + uTime * 2.4 - r * 10.0);
    float depthFade = smoothstep(1.0, 0.05, r);
    vec3 core = uColor * (0.16 + 0.22 * band) * depthFade * dim;
    float rim = pow(smoothstep(0.55, 1.0, r), 3.0);
    return core + uColor * rim * 1.4;
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec2 centered = vUv * 2.0 - 1.0;
    float r = length(centered);

    if (uMode < 0.5) {
      gl_FragColor = vec4(swirl(centered, r, 1.0), 1.0);
    } else if (uMode < 1.5) {
      vec2 screenUv = gl_FragCoord.xy / uResolution;
      vec3 view = texture2D(uView, screenUv).rgb;
      float rim = pow(smoothstep(0.78, 1.0, r), 2.0);
      gl_FragColor = vec4(mix(view, uColor, rim * 0.6), 1.0);
    } else {
      gl_FragColor = vec4(swirl(centered, r, 0.6), 1.0);
    }
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Surface material of a portal ellipse. `linked` mode samples the paired
 * portal's render target with screen-space UVs, which yields the correct
 * parallax because the virtual camera shares the main camera's projection.
 */
export class PortalSurfaceMaterial extends ShaderMaterial {
  constructor(color: number) {
    super({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uMode: { value: PortalSurfaceMode.idle },
        uColor: { value: new Color(color) },
        uTime: { value: 0 },
        uView: { value: null },
        uResolution: { value: new Vector2(1, 1) },
      },
      // three skips tone mapping when rendering into a render target, so the
      // portal view texture holds linear values; this material applies the
      // renderer's tone mapping itself so the view matches the main pass.
      toneMapped: true,
    });
  }

  setMode(mode: PortalSurfaceModeValue): void {
    this.uniforms.uMode.value = mode;
  }

  getMode(): PortalSurfaceModeValue {
    return this.uniforms.uMode.value as PortalSurfaceModeValue;
  }

  setTime(elapsed: number): void {
    this.uniforms.uTime.value = elapsed;
  }

  setView(texture: Texture | null, width: number, height: number): void {
    this.uniforms.uView.value = texture;
    (this.uniforms.uResolution.value as Vector2).set(width, height);
  }
}
