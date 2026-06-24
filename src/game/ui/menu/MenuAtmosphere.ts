interface Mote {
  x: number;
  y: number;
  depth: number;
  size: number;
  alpha: number;
  vy: number;
  sway: number;
  phase: number;
  twinkle: number;
}

const MAX_PARALLAX = 46; // px de desplazamiento de la mota mas cercana (depth 1)
const LERP = 0.1;

/**
 * Atmosfera del menu: campo de polvo/brasas en canvas con parallax por
 * profundidad, deriva lenta y bamboleo sutil, mas un valor de mouse suavizado
 * que tambien alimenta la deriva del resplandor (`--mx`/`--my`). Autocontenido:
 * gestiona su propio `requestAnimationFrame` y se apaga cuando el menu no esta
 * visible o esta en pausa.
 */
export class MenuAtmosphere {
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly sprite: HTMLCanvasElement;
  private readonly abort = new AbortController();
  private readonly observer: ResizeObserver;
  private readonly reduced: boolean;
  private motes: Mote[] = [];
  private raf = 0;
  private running = false;
  private lastTime = 0;
  private targetX = 0;
  private targetY = 0;
  private curX = 0;
  private curY = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(
    private readonly host: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.ctx = canvas.getContext("2d");
    this.sprite = buildSprite();
    this.reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.host.addEventListener(
      "pointermove",
      (event) => {
        const rect = this.host.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        this.targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
        this.targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
      },
      { passive: true, signal: this.abort.signal },
    );

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.host);
    this.resize();
  }

  setActive(active: boolean): void {
    if (active === this.running) return;
    this.running = active;
    if (!active) {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }
    if (this.reduced) {
      this.draw();
      return;
    }
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.abort.abort();
  }

  private resize(): void {
    const rect = this.host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.seed();
    if (this.reduced || !this.running) this.draw();
  }

  /**
   * Mezcla de polvo fino (muchas, nitidas) y algunas "bokeh" grandes y tenues
   * para dar sensacion de profundidad de campo.
   */
  private seed(): void {
    const count = Math.round(
      Math.min(150, Math.max(44, (this.width * this.height) / 17000)),
    );
    this.motes = [];
    for (let i = 0; i < count; i += 1) {
      const bokeh = Math.random() < 0.12;
      const depth = bokeh ? 0.7 + Math.random() * 0.3 : 0.2 + Math.random() * 0.8;
      this.motes.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        depth,
        size: bokeh ? 5 + Math.random() * 7 : 0.5 + depth * 1.9,
        alpha: bokeh ? 0.03 + Math.random() * 0.05 : 0.1 + depth * 0.34,
        vy: bokeh ? -(1 + depth * 4) : -(3 + depth * 12),
        sway: (4 + Math.random() * 10) * depth,
        phase: Math.random() * Math.PI * 2,
        twinkle: 0.4 + Math.random() * 1.1,
      });
    }
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    this.curX += (this.targetX - this.curX) * LERP;
    this.curY += (this.targetY - this.curY) * LERP;
    this.host.style.setProperty("--mx", this.curX.toFixed(3));
    this.host.style.setProperty("--my", this.curY.toFixed(3));

    for (const m of this.motes) {
      m.y += m.vy * dt;
      m.phase += m.twinkle * dt;
      if (m.y < -12) {
        m.y = this.height + 12;
        m.x = Math.random() * this.width;
      }
    }

    this.draw();
    this.raf = requestAnimationFrame(this.tick);
  };

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = "lighter";
    for (const m of this.motes) {
      // Parallax (mas cerca = mas movimiento) + bamboleo horizontal organico.
      const ox = this.curX * MAX_PARALLAX * m.depth + Math.sin(m.phase) * m.sway;
      const oy = this.curY * MAX_PARALLAX * m.depth;
      const tw = 0.62 + 0.38 * Math.sin(m.phase * 1.6);
      const r = m.size;
      ctx.globalAlpha = Math.max(0, Math.min(1, m.alpha * tw));
      ctx.drawImage(this.sprite, m.x + ox - r * 4, m.y + oy - r * 4, r * 8, r * 8);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}

/** Sprite radial cacheado (mota difusa color ambar) — barato de blitear. */
function buildSprite(): HTMLCanvasElement {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255, 218, 162, 0.95)");
    g.addColorStop(0.32, "rgba(255, 176, 102, 0.4)");
    g.addColorStop(1, "rgba(255, 150, 70, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return c;
}
