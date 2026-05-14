import { BufferGeometry, Line, LineBasicMaterial, Scene, Vector3 } from 'three';

interface TimedLine {
  line: Line;
  remaining: number;
}

export class Gizmos {
  private readonly lines: TimedLine[] = [];
  private readonly material = new LineBasicMaterial({ color: 0x89e9ff });

  constructor(private readonly scene: Scene) {}

  addRay(origin: Vector3, direction: Vector3, length: number, duration = 0.08): void {
    const geometry = new BufferGeometry().setFromPoints([
      origin.clone(),
      origin.clone().addScaledVector(direction, length),
    ]);
    const line = new Line(geometry, this.material);
    this.scene.add(line);
    this.lines.push({ line, remaining: duration });
  }

  update(delta: number): void {
    for (let index = this.lines.length - 1; index >= 0; index -= 1) {
      const item = this.lines[index];
      item.remaining -= delta;

      if (item.remaining > 0) {
        continue;
      }

      this.scene.remove(item.line);
      item.line.geometry.dispose();
      this.lines.splice(index, 1);
    }
  }
}
