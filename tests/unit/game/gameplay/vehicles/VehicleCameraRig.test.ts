import { describe, expect, it, vi } from "vitest";
import { Object3D, PerspectiveCamera, Quaternion, Vector3 } from "three";
import type { Input } from "@engine/input/Input";
import type { CameraSystem } from "@engine/render/CameraSystem";
import type { VehiclePresetDefinition } from "@game/config/vehicles.config";
import { VehicleCameraRig } from "@game/gameplay/vehicles/VehicleCameraRig";

const HZ_60 = 1 / 60;

const config: VehiclePresetDefinition["camera"] = {
  enterBlendSeconds: 0.35,
  exitBlendSeconds: 0.25,
  maxYaw: 1.75,
  minPitch: -0.95,
  maxPitch: 0.8,
  speedFovGain: 8,
  positionDamping: 12,
  rotationDamping: 10,
};

describe("VehicleCameraRig", () => {
  it("no se queda atrás con el vehículo a velocidad constante", () => {
    const { rig, anchor, camera } = mount();

    // 3 s a 25 m/s. Un resorte en world-space arrastraría ~2·v/ω ≈ 4 m.
    for (let frame = 0; frame < Math.round(3 / HZ_60); frame += 1) {
      anchor.position.z += 25 * HZ_60;
      rig.update(HZ_60, idleInput(), camera, 25);
    }

    const anchorWorld = anchor.getWorldPosition(new Vector3());
    expect(camera.camera.position.distanceTo(anchorWorld)).toBeLessThan(0.05);
  });

  it("no se queda atrás acelerando", () => {
    const { rig, anchor, camera } = mount();

    let speed = 0;
    for (let frame = 0; frame < Math.round(3 / HZ_60); frame += 1) {
      speed = Math.min(30, speed + 12 * HZ_60);
      anchor.position.z += speed * HZ_60;
      rig.update(HZ_60, idleInput(), camera, speed);
    }

    const anchorWorld = anchor.getWorldPosition(new Vector3());
    expect(camera.camera.position.distanceTo(anchorWorld)).toBeLessThan(0.15);
  });

  it("no arrastra la orientación en un giro sostenido", () => {
    const { rig, anchor, camera } = mount();

    for (let frame = 0; frame < Math.round(3 / HZ_60); frame += 1) {
      anchor.rotation.y += 1.2 * HZ_60;
      rig.update(HZ_60, idleInput(), camera, 12);
    }

    // La cámara mira hacia el +Z del anchor (fix de 180° sobre el -Z de Three).
    const anchorForward = new Vector3(0, 0, 1).applyQuaternion(
      anchor.getWorldQuaternion(new Quaternion()),
    );
    const cameraForward = camera.camera.getWorldDirection(new Vector3());
    expect(cameraForward.angleTo(anchorForward)).toBeLessThan(0.05);
  });

  it("sigue al anchor cuando el vehículo lo lleva en rotación", () => {
    const { rig, anchor, camera, vehicle } = mount();
    // Asiento desplazado del centro: girar el chasis lo mueve en un arco.
    anchor.position.set(0.42, 1.42, 0.15);

    for (let frame = 0; frame < Math.round(3 / HZ_60); frame += 1) {
      vehicle.rotation.y += 1.5 * HZ_60;
      rig.update(HZ_60, idleInput(), camera, 8);
    }

    const anchorWorld = anchor.getWorldPosition(new Vector3());
    expect(camera.camera.position.distanceTo(anchorWorld)).toBeLessThan(0.05);
  });

  it("mira hacia adelante del vehículo, no hacia la cola", () => {
    const { rig, anchor, vehicle, camera } = mount();
    vehicle.rotation.y = 0.7;
    rig.update(HZ_60, idleInput(), camera, 0);

    // El ancla es un marcador de posición sin rotación propia: el rig es el que
    // resuelve que el -Z de la cámara de Three mire al +Z del vehículo.
    const vehicleForward = new Vector3(0, 0, 1).applyQuaternion(
      anchor.getWorldQuaternion(new Quaternion()),
    );
    const cameraForward = camera.camera.getWorldDirection(new Vector3());

    expect(cameraForward.dot(vehicleForward)).toBeGreaterThan(0.9);
  });

  it("el impacto sacude y se disipa solo", () => {
    const { rig, anchor, camera } = mount();
    const anchorWorld = anchor.getWorldPosition(new Vector3());

    rig.addImpact(1);
    rig.update(HZ_60, idleInput(), camera, 0);
    expect(camera.camera.position.distanceTo(anchorWorld)).toBeGreaterThan(0);

    for (let frame = 0; frame < Math.round(2 / HZ_60); frame += 1) {
      rig.update(HZ_60, idleInput(), camera, 0);
    }
    expect(camera.camera.position.distanceTo(anchorWorld)).toBeLessThan(0.01);
  });
});

function mount(): {
  rig: VehicleCameraRig;
  anchor: Object3D;
  vehicle: Object3D;
  camera: CameraSystem;
} {
  const vehicle = new Object3D();
  const anchor = new Object3D();
  vehicle.add(anchor);

  const perspective = new PerspectiveCamera();
  perspective.position.set(0, 1.6, -3);
  const camera = {
    camera: perspective,
    defaultFov: 75,
    applyZoom: vi.fn(),
    setLook: vi.fn(),
  } as unknown as CameraSystem;

  const rig = new VehicleCameraRig();
  rig.begin(anchor, config, camera);
  // Consumir el blend de entrada para medir el régimen permanente.
  for (let frame = 0; frame < Math.round(1 / HZ_60); frame += 1) {
    rig.update(HZ_60, idleInput(), camera, 0);
  }
  return { rig, anchor, vehicle, camera };
}

function idleInput(): Input {
  return { getMouseDelta: () => ({ x: 0, y: 0 }) } as unknown as Input;
}
