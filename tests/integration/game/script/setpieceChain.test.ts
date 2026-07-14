import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import type { INpc } from "@game/npc/core/INpc";
import { SetpieceTestLevel } from "@game/levels/maps/custom/SetpieceTestLevel";
import { TriggerSystem } from "@game/levels/TriggerSystem";
import { EntityIOSystem } from "@game/script/EntityIOSystem";
import { EntityEventBridge } from "@game/script/EntityEventBridge";
import { bindWorldEntities, type WorldEntityHooks } from "@game/script/WorldEntityBinder";
import { bindNpcEntity, type NpcBinderDeps } from "@game/script/NpcEntityBinder";
import { NpcDirectory } from "@game/script/NpcDirectory";
import { ScriptedSequenceSystem } from "@game/script/ScriptedSequenceSystem";
import { CompanionSystem } from "@game/script/CompanionSystem";
import { effectiveName } from "@game/script/EntityIOTypes";
import type { NPCDefinition } from "@game/levels/LevelDefinition";

function fakeNpc(id: string, position: Vector3): INpc {
  return { id, position, isAlive: () => true } as unknown as INpc;
}

/**
 * Cablea el grafo de I/O completo sobre los datos reales de `SetpieceTestLevel`
 * y expone los efectos observados, para validar la cadena setpiece de punta a
 * punta sin el runtime de física/IA.
 */
function harness() {
  const level = SetpieceTestLevel;
  const bus = new EventBus<GameEventMap>();
  const io = new EntityIOSystem();
  const triggers = new TriggerSystem(bus);
  const directory = new NpcDirectory();

  const calls = {
    dialogue: [] as string[],
    spawned: [] as string[],
    doorsOpened: [] as string[],
    objectives: [] as string[],
    endLevel: 0,
  };
  const triggerEnabled = new Map<string, boolean>();
  let npcBinderDeps: NpcBinderDeps | null = null;

  const hooks: WorldEntityHooks = {
    showDialogue: (text) => calls.dialogue.push(text),
    spawnNpcs: (npcs, spawner) => {
      calls.spawned.push(spawner);
      npcs.forEach((def: NPCDefinition) => {
        const npc = fakeNpc(`${spawner}-${def.id}`, new Vector3());
        if (npcBinderDeps) bindNpcEntity(npcBinderDeps, def, npc);
      });
    },
    setDoorOpen: (doorId, open) => {
      if (open) calls.doorsOpened.push(doorId);
      bus.emit("door.opened", { id: doorId, open });
    },
    toggleDoor: () => {},
    runLevelAction: () => {},
    updateObjective: (text) => calls.objectives.push(text),
    activateSoundscape: () => {},
    endLevel: () => {
      calls.endLevel += 1;
    },
    setTriggerEnabled: (id, enabled) => {
      triggerEnabled.set(id, enabled);
      triggers.setEnabled(id, enabled);
    },
    toggleTrigger: (id) => triggers.toggleEnabled(id),
    killPlayer: () => {},
    teleportPlayer: () => {},
  };

  const markers = bindWorldEntities(
    io,
    { logic: level.logicEntities ?? [], doors: level.doors, triggers: level.triggers },
    hooks,
  );

  const companion = new CompanionSystem(io, directory, bus);
  npcBinderDeps = {
    io,
    directory,
    markers,
    companion: {
      startFollowing: (id) => companion.setMode(id, "follow"),
      stopFollowing: (id) => companion.setMode(id, "wait"),
      escortTo: (id, point) => companion.setMode(id, "escort", point),
    },
  };

  const sequences = new ScriptedSequenceSystem(io, directory, markers, bus);
  (level.sequences ?? []).forEach((def) => sequences.register(def));

  level.triggers.forEach((t) => triggers.addTrigger(t));

  const triggerSources = new Map(level.triggers.map((t) => [t.id, { key: t.id, name: effectiveName(t) }]));
  const doorSources = new Map(level.doors.map((d) => [d.id, { key: d.id, name: effectiveName(d) }]));
  new EntityEventBridge(bus, io, {
    triggerSource: (id) => triggerSources.get(id) ?? null,
    doorSource: (id) => doorSources.get(id) ?? null,
    npcSource: (id) => directory.sourceOf(id),
  });

  // Alyx como compañera.
  const alyx = fakeNpc("alyx", new Vector3(3, 0, 15));
  const alyxDef = level.npcs.find((def) => def.id === "alyx");
  if (alyxDef && npcBinderDeps) bindNpcEntity(npcBinderDeps, alyxDef, alyx);
  companion.registerCompanion(alyx, "Alyx");

  return { level, bus, io, triggers, sequences, companion, directory, calls, triggerEnabled, alyx };
}

describe("setpiece chain (SetpieceTestLevel)", () => {
  it("recorre secuencia → spawn → counter → escolta → salida de punta a punta", () => {
    const h = harness();

    // 1. OnMapSpawn (auto) en el primer update: bienvenida + objetivo inicial.
    h.io.update(0.016);
    expect(h.calls.dialogue).toContain("Prueba de setpiece. Avanzá con Alyx hacia la consola.");
    expect(h.calls.objectives).toContain("Acercate a la consola con Alyx");

    // 2. El jugador cruza el trigger de entrada → relay → Start de la secuencia.
    h.triggers.update(new Vector3(0, 1.2, 10), 0.016);
    h.io.update(0.016);
    const order = h.sequences.orderFor("alyx");
    expect(order).not.toBeNull();
    expect(order?.overrideAi).toBe(true);

    // 3. La secuencia termina → dispara el spawner de la oleada.
    order?.notifyDone("completed");
    expect(h.calls.spawned).toContain("spawn-wave");

    // 4. Las 3 muertes de la oleada suman al counter → OnHitMax.
    for (let i = 1; i <= 3; i += 1) {
      h.bus.emit("npc.killed", { id: `spawn-wave-w${i}`, characterId: "combine" });
    }
    expect(h.calls.doorsOpened).toContain("gate");
    expect(h.calls.objectives).toContain("Seguí a Alyx a la extracción");
    // Alyx recibió la orden de escolta al marker de extracción.
    expect(h.companion.anchorOverrideFor("alyx")).toEqual(new Vector3(0, 1, -18));

    // 5. Simula el avance frame a frame hacia el anchor de escort. La suite de
    // CompanionSystem cubre este mismo tramo con Brain + locomoción reales.
    for (let frame = 0; frame < 120 && !h.triggerEnabled.get("exit-trigger"); frame += 1) {
      const anchor = h.companion.anchorOverrideFor("alyx");
      if (!anchor) break;
      const delta = anchor.clone().sub(h.alyx.position);
      const distance = Math.hypot(delta.x, delta.z);
      if (distance > 0) h.alyx.position.addScaledVector(delta.normalize(), Math.min(0.5, distance));
      h.companion.update(frame * 0.1);
    }
    expect(h.triggerEnabled.get("exit-trigger")).toBe(true);
    expect(h.calls.dialogue).toContain("Extracción lista. Cruzá la esclusa.");

    // 6. El jugador cruza la salida (ya habilitada) → changelevel.
    h.triggers.update(new Vector3(0, 1.2, -20), 0.016);
    h.io.update(0.016);
    expect(h.calls.endLevel).toBe(1);
  });

  it("la salida no dispara antes de que Alyx complete la escolta", () => {
    const h = harness();
    h.io.update(0.016);

    // El jugador intenta salir antes de tiempo: el trigger arranca deshabilitado.
    h.triggers.update(new Vector3(0, 1.2, -20), 0.016);
    h.io.update(0.016);
    expect(h.calls.endLevel).toBe(0);
  });
});
