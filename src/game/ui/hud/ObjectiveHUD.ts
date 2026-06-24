import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';

const NDC = new Vector3();

/**
 * Panel de objetivo (arriba-centro) + brújula: una marca world-space que el
 * `update(camera)` proyecta a pantalla cada frame, clamped a los bordes cuando
 * el waypoint queda fuera de cuadro (apunta hacia dónde girar). Sin lógica de
 * negocio: el `HUD` lo alimenta desde `objective.updated`.
 */
export class ObjectiveHUD {
  readonly element = document.createElement('div');
  private readonly label = document.createElement('span');
  private readonly text = document.createElement('p');
  private readonly marker = document.createElement('div');
  private readonly markerDistance = document.createElement('span');

  private worldMarker: Vector3 | null = null;
  private clearTimer: number | null = null;

  constructor(private readonly markerLayer: HTMLElement) {
    this.element.className = 'hev-objective';
    this.label.className = 'hev-objective__label';
    this.label.textContent = 'Objetivo';
    this.text.className = 'hev-objective__text';
    this.element.append(this.label, this.text);

    this.marker.className = 'hev-objective__marker';
    this.markerDistance.className = 'hev-objective__marker-distance';
    this.marker.append(this.markerDistance);
    this.markerLayer.append(this.marker);

    this.setObjective('', false);
  }

  setObjective(text: string, completed: boolean): void {
    if (this.clearTimer !== null) {
      window.clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    this.text.textContent = text.toUpperCase();
    this.element.classList.toggle('is-visible', text.length > 0);
    this.element.classList.toggle('is-completed', completed && text.length > 0);
    if (completed && text.length > 0) {
      // Mantener el tilde de "cumplido" un instante y luego desvanecer.
      this.clearTimer = window.setTimeout(() => {
        this.element.classList.remove('is-visible', 'is-completed');
        this.clearTimer = null;
      }, 2600);
    }
  }

  setMarker(world: Vector3 | null): void {
    this.worldMarker = world ? world.clone() : null;
    if (!this.worldMarker) {
      this.marker.classList.remove('is-visible');
    }
  }

  /** Reproyecta el waypoint a pantalla. Llamar cada frame con la cámara activa. */
  update(camera: PerspectiveCamera): void {
    if (!this.worldMarker) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    NDC.copy(this.worldMarker).project(camera);
    const behind = NDC.z > 1;
    let x = NDC.x;
    let y = NDC.y;
    if (behind) {
      // Detrás de la cámara: invertir para que apunte hacia atrás por el borde.
      x = -x;
      y = -y;
    }

    const offScreen = behind || Math.abs(x) > 1 || Math.abs(y) > 1;
    const margin = 48;
    let px: number;
    let py: number;
    if (offScreen) {
      const len = Math.hypot(x, y) || 1;
      const cx = (x / len);
      const cy = (y / len);
      px = (w / 2) + cx * (w / 2 - margin);
      py = (h / 2) - cy * (h / 2 - margin);
    } else {
      px = (x * 0.5 + 0.5) * w;
      py = (-y * 0.5 + 0.5) * h;
    }

    this.marker.style.left = `${px}px`;
    this.marker.style.top = `${py}px`;
    this.marker.classList.toggle('is-edge', offScreen);
    this.marker.classList.add('is-visible');

    const distance = camera.position.distanceTo(this.worldMarker);
    this.markerDistance.textContent = `${Math.round(distance)} m`;
  }

  dispose(): void {
    if (this.clearTimer !== null) window.clearTimeout(this.clearTimer);
    this.marker.remove();
  }
}
