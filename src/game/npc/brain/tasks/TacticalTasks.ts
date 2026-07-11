import { Vector3 } from 'three';
import type { Task, TaskStatus } from '@engine/ai/brain/Task';
import type { NpcBrainContext, NpcNavigationQueries } from '@game/npc/brain/NpcBrainContext';
import type { NavAgentProfile } from '@engine/ai/navigation/NavigationTypes';

type NpcTask = Task<NpcBrainContext>;

const tmpDir = new Vector3();
const tmpCandidate = new Vector3();

/**
 * Devuelve el primer candidato que cae sobre una celda navegable, con el `y`
 * ajustado al de la celda. Null si ninguno es valido.
 */
function snapToNav(
  navigation: NpcNavigationQueries,
  profile: NavAgentProfile,
  candidates: Vector3[],
): Vector3 | null {
  for (const candidate of candidates) {
    const projected = navigation.projectPoint(candidate, profile);
    if (projected) return projected;
  }
  return null;
}

/** Punto a `distance` metros de `from` en direccion `angle` (radianes, plano XZ). */
function pointAt(from: Vector3, angle: number, distance: number): Vector3 {
  return new Vector3(from.x + Math.sin(angle) * distance, from.y, from.z + Math.cos(angle) * distance);
}

/**
 * Patrulla la ruta del nivel en loop. Nunca devuelve success: corre hasta que
 * un interrupt (SeeEnemy, HeardX) tumba el schedule. El indice persiste entre
 * re-entradas para retomar donde quedo. Failure inmediato si no hay ruta —
 * los presets solo incluyen el schedule cuando el NPC tiene patrol asignado.
 */
export function createPatrolTask(dwell = 1.5): NpcTask {
  let index = 0;
  let waiting = 0;
  return {
    id: 'patrol',
    init: () => {
      waiting = 0;
    },
    tick: (ctx): TaskStatus => {
      const route = ctx.patrolRoute;
      if (!route || route.length === 0) return 'failure';
      if (index >= route.length) index = 0;
      const target = route[index];
      if (waiting > 0) {
        waiting -= ctx.delta;
        if (waiting <= 0) index = (index + 1) % route.length;
        return 'running';
      }
      ctx.locomotion.moveTo(target, { gait: 'walk' });
      if (ctx.locomotion.distanceToTarget() <= 1.2) {
        ctx.locomotion.stop();
        waiting = dwell;
      } else if (ctx.locomotion.isStuck()) {
        // Saltea el waypoint inalcanzable en vez de abortar la patrulla.
        index = (index + 1) % route.length;
      }
      return 'running';
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

/**
 * Deambula sin rumbo (zombies): elige un punto navegable aleatorio alrededor
 * de la posicion actual, camina hasta el y se queda un beat. Un ciclo por
 * schedule — al completar, el brain re-elige y el proximo wander toma otro
 * punto. Si no hay punto navegable degrada a esperar (equivale a idle).
 */
export function createWanderTask(radius = 8, dwellMin = 1.5, dwellMax = 3.5): NpcTask {
  let target: Vector3 | null = null;
  let phase: 'move' | 'dwell' = 'move';
  let dwell = 0;
  return {
    id: 'wander',
    init: (ctx) => {
      dwell = dwellMin + Math.random() * (dwellMax - dwellMin);
      const angle = Math.random() * Math.PI * 2;
      const distance = radius * (0.4 + Math.random() * 0.6);
      target = snapToNav(ctx.navigation, ctx.navigationProfile, [
        pointAt(ctx.self.position, angle, distance),
        pointAt(ctx.self.position, angle + 1.3, distance * 0.7),
        pointAt(ctx.self.position, angle - 1.3, distance * 0.5),
      ]);
      phase = target ? 'move' : 'dwell';
    },
    tick: (ctx): TaskStatus => {
      if (phase === 'move' && target) {
        ctx.locomotion.moveTo(target, { gait: 'walk' });
        if (ctx.locomotion.distanceToTarget() <= 1.2) {
          ctx.locomotion.stop();
          phase = 'dwell';
        } else if (ctx.locomotion.isStuck()) {
          ctx.locomotion.stop();
          phase = 'dwell';
        }
        return 'running';
      }
      dwell -= ctx.delta;
      return dwell <= 0 ? 'success' : 'running';
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

/**
 * Camina al ultimo ruido oido (combate > sospechoso) y barre la zona girando
 * a ambos lados. Al terminar limpia el ruido para no re-investigar lo mismo.
 */
export function createInvestigateTask(): NpcTask {
  let target: Vector3 | null = null;
  let phase: 'move' | 'sweep' = 'move';
  let sweepTimer = 0;
  let sweepStep = 0;
  return {
    id: 'investigate',
    init: (ctx) => {
      const noise = ctx.noise.combat ?? ctx.noise.suspicious;
      target = noise ? noise.clone() : null;
      phase = 'move';
      sweepTimer = 0;
      sweepStep = 0;
    },
    tick: (ctx): TaskStatus => {
      if (!target) return 'failure';
      if (phase === 'move') {
        ctx.locomotion.moveTo(target, { gait: 'walk' });
        if (ctx.locomotion.distanceToTarget() <= 2.0) {
          ctx.locomotion.stop();
          phase = 'sweep';
          sweepTimer = 0.9;
        } else if (ctx.locomotion.isStuck()) {
          return 'failure';
        }
        return 'running';
      }
      sweepTimer -= ctx.delta;
      if (sweepTimer <= 0) {
        sweepStep += 1;
        if (sweepStep >= 3) return 'success';
        // Barrido: mira a ±100 grados alternados alrededor del punto del ruido.
        const baseAngle = Math.atan2(target.x - ctx.self.position.x, target.z - ctx.self.position.z);
        const side = sweepStep === 1 ? 1 : -1;
        const lookAngle = baseAngle + side * (100 * Math.PI) / 180;
        ctx.locomotion.face(pointAt(ctx.self.position, lookAngle, 6));
        sweepTimer = 0.9;
      }
      return 'running';
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

/**
 * Busqueda de la ultima posicion conocida: va a la LKP y revisa 2 puntos
 * laterales navegables alrededor. Si la memoria expira a mitad de camino el
 * schedule completa igual (HL2-style: el NPC "se rinde" tras revisar).
 */
export function createSearchSweepTask(): NpcTask {
  let waypoints: Vector3[] = [];
  let index = 0;
  let dwell = 0;
  return {
    id: 'searchLastKnown',
    init: (ctx) => {
      waypoints = [];
      index = 0;
      dwell = 0;
      const lkp = ctx.threatLastKnown;
      if (!lkp) return;
      waypoints.push(lkp.clone());
      // Dos puntos de revision alrededor de la LKP, en angulos aleatorios
      // opuestos para que dos NPCs buscando no converjan exactamente igual.
      const baseAngle = Math.random() * Math.PI * 2;
      for (const offset of [0, Math.PI]) {
        const candidate = snapToNav(ctx.navigation, ctx.navigationProfile, [
          pointAt(lkp, baseAngle + offset, 4),
          pointAt(lkp, baseAngle + offset + 0.6, 6),
        ]);
        if (candidate) waypoints.push(candidate);
      }
    },
    tick: (ctx): TaskStatus => {
      if (waypoints.length === 0) return 'failure';
      if (index >= waypoints.length) return 'success';
      if (dwell > 0) {
        dwell -= ctx.delta;
        if (dwell <= 0) index += 1;
        return 'running';
      }
      const target = waypoints[index];
      ctx.locomotion.moveTo(target, { gait: index === 0 ? 'sprint' : 'walk' });
      if (ctx.locomotion.distanceToTarget() <= 1.5) {
        ctx.locomotion.stop();
        dwell = 0.8;
      } else if (ctx.locomotion.isStuck()) {
        index += 1;
      }
      return 'running';
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

/**
 * Retirada: corre a un punto navegable alejado del threat, encarandolo
 * (retrocede disparando si el schedule lo combina con bursts). Success al
 * llegar o al superar `safeDistance`.
 */
export function createRetreatTask(retreatDistance = 10, safeDistance = 18): NpcTask {
  let target: Vector3 | null = null;
  return {
    id: 'retreat',
    init: (ctx) => {
      target = null;
      const threatPos = ctx.threat?.position ?? ctx.threatLastKnown;
      if (!threatPos) return;
      // El tactical map conoce posiciones que ademas alejan del threat con
      // ruta valida; el abanico geometrico es el fallback sin tactica.
      target = ctx.tactical?.findRetreat() ?? null;
      if (target) return;
      const self = ctx.self.position;
      const awayAngle = Math.atan2(self.x - threatPos.x, self.z - threatPos.z);
      const spread = (35 * Math.PI) / 180;
      target = snapToNav(ctx.navigation, ctx.navigationProfile, [
        pointAt(self, awayAngle, retreatDistance),
        pointAt(self, awayAngle + spread, retreatDistance),
        pointAt(self, awayAngle - spread, retreatDistance),
        pointAt(self, awayAngle, retreatDistance * 0.5),
      ]);
    },
    tick: (ctx): TaskStatus => {
      if (!target) return 'failure';
      const threatPos = ctx.threat?.position ?? ctx.threatLastKnown;
      if (threatPos) {
        tmpDir.copy(ctx.self.position).sub(threatPos);
        if (tmpDir.length() >= safeDistance) {
          ctx.locomotion.stop();
          return 'success';
        }
      }
      ctx.locomotion.moveTo(target, {
        gait: 'sprint',
        facing: threatPos ?? undefined,
      });
      if (ctx.locomotion.distanceToTarget() <= 1.5) {
        ctx.locomotion.stop();
        return 'success';
      }
      if (ctx.locomotion.isStuck()) return 'failure';
      return 'running';
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

/**
 * Sigue al anchor manteniendose a `followDistance`. El anchor efectivo lo
 * resuelve el `Npc` (player, u orden ir-a-punto del squad del jugador); con
 * `anchorOffset` cada miembro apunta a su lugar de la formacion — asi varios
 * rebeldes no convergen al mismo punto. Nunca termina: corre hasta que un
 * interrupt lo tumbe. Histeresis de arranque/parada para no hacer ping-pong.
 */
export function createFollowAnchorTask(followDistance = 6): NpcTask {
  let moving = false;
  const formationTarget = new Vector3();
  return {
    id: 'followAnchor',
    init: () => {
      moving = false;
    },
    tick: (ctx): TaskStatus => {
      const anchor = ctx.anchorPosition ?? (ctx.player.isAlive ? ctx.player.position : null);
      if (!anchor) return 'failure';
      const target = ctx.anchorOffset
        ? formationTarget.copy(anchor).add(ctx.anchorOffset)
        : anchor;
      const dx = target.x - ctx.self.position.x;
      const dz = target.z - ctx.self.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      // Con lugar de formacion asignado, el destino es exacto (radio corto).
      const arrive = ctx.anchorOffset ? 1.2 : followDistance;
      if (!moving && dist > arrive + 2) moving = true;
      if (moving) {
        ctx.locomotion.moveTo(target, {
          gait: dist > followDistance * 2 ? 'sprint' : 'walk',
        });
        if (dist <= arrive) {
          ctx.locomotion.stop();
          moving = false;
        }
      } else {
        ctx.locomotion.face(anchor);
      }
      return 'running';
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

/**
 * Regroup: sprint hacia el anchor hasta quedar a `arriveDistance`. Pensado
 * para `AnchorFar` — el ally quedo descolgado y vuelve aunque este en combate.
 */
export function createRegroupTask(arriveDistance = 5): NpcTask {
  const formationTarget = new Vector3();
  return {
    id: 'regroup',
    init: () => {},
    tick: (ctx): TaskStatus => {
      const anchor = ctx.anchorPosition ?? (ctx.player.isAlive ? ctx.player.position : null);
      if (!anchor) return 'failure';
      const target = ctx.anchorOffset
        ? formationTarget.copy(anchor).add(ctx.anchorOffset)
        : anchor;
      const dx = target.x - ctx.self.position.x;
      const dz = target.z - ctx.self.position.z;
      if (Math.sqrt(dx * dx + dz * dz) <= arriveDistance) {
        ctx.locomotion.stop();
        return 'success';
      }
      ctx.locomotion.moveTo(target, { gait: 'sprint' });
      if (ctx.locomotion.isStuck()) return 'failure';
      return 'running';
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

/**
 * Flanqueo: corre a una posicion lateral amplia respecto del threat (el lado
 * lo asigna el SquadDirector para que dos flankers no se crucen). Al llegar,
 * el engage normal toma el control via `SeeEnemy`. Fallback geometrico si el
 * tactical map no tiene posiciones utiles.
 */
export function createFlankTask(flankDistance = 12): NpcTask {
  let target: Vector3 | null = null;
  return {
    id: 'flank',
    init: (ctx) => {
      target = null;
      const threatPos = ctx.threat?.position ?? ctx.threatLastKnown;
      if (!threatPos) return;
      const side = ctx.squad?.flankSide ?? (Math.random() < 0.5 ? 1 : -1);
      target = ctx.tactical?.findFlank(side) ?? null;
      if (target) return;
      const self = ctx.self.position;
      const toThreatAngle = Math.atan2(threatPos.x - self.x, threatPos.z - self.z);
      const lateralAngle = toThreatAngle + side * Math.PI * 0.45;
      target = snapToNav(ctx.navigation, ctx.navigationProfile, [
        pointAt(self, lateralAngle, flankDistance),
        pointAt(self, lateralAngle, flankDistance * 0.6),
        pointAt(self, toThreatAngle + side * Math.PI * 0.3, flankDistance),
      ]);
    },
    tick: (ctx): TaskStatus => {
      if (!target) return 'failure';
      const threatPos = ctx.threat?.position ?? ctx.threatLastKnown;
      ctx.locomotion.moveTo(target, {
        gait: 'sprint',
        facing: threatPos ?? undefined,
      });
      if (ctx.locomotion.distanceToTarget() <= 1.2) {
        ctx.locomotion.stop();
        return 'success';
      }
      if (ctx.locomotion.isStuck()) return 'failure';
      return 'running';
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

/**
 * Reclama el mejor cover contra el threat y corre hacia el (sprint,
 * encarando al threat). Success al llegar; failure si no hay cover o el
 * camino se traba (libera el claim para no bloquear el punto).
 */
export function createMoveToCoverTask(): NpcTask {
  let target: Vector3 | null = null;
  return {
    id: 'moveToCover',
    init: (ctx) => {
      target = null;
      const claimed = ctx.tactical?.claimBestCover() ?? null;
      if (claimed) target = claimed.position;
    },
    tick: (ctx): TaskStatus => {
      if (!target || !ctx.tactical) return 'failure';
      const threatPos = ctx.threat?.position ?? ctx.threatLastKnown;
      ctx.locomotion.moveTo(target, {
        gait: 'sprint',
        facing: threatPos ?? undefined,
      });
      if (ctx.locomotion.distanceToTarget() <= 0.8) {
        ctx.locomotion.stop();
        return 'success';
      }
      if (ctx.locomotion.isStuck()) {
        ctx.tactical.releaseCover();
        ctx.locomotion.stop();
        return 'failure';
      }
      return 'running';
    },
    abort: (ctx) => {
      ctx.tactical?.releaseCover();
      ctx.locomotion.stop();
    },
  };
}

/**
 * Ciclo hide/peek desde el cover reclamado: se esconde un beat, se asoma al
 * peek point con mejor angulo, dispara una rafaga y vuelve. `cycles` vueltas
 * y libera el cover. Es el ritmo asomarse-disparar-cubrirse de los soldados
 * de HL2.
 */
export function createPeekFireCycleTask(cycles = 3): NpcTask {
  let phase: 'hide' | 'peek' = 'hide';
  let timer = 0;
  let cyclesLeft = cycles;
  let peekPoint: Vector3 | null = null;
  return {
    id: 'peekFire',
    init: () => {
      phase = 'hide';
      timer = 0.6 + Math.random() * 0.6;
      cyclesLeft = cycles;
      peekPoint = null;
    },
    tick: (ctx): TaskStatus => {
      const cover = ctx.tactical?.currentCover() ?? null;
      if (!cover || !ctx.tactical) return 'failure';
      const threatPos = ctx.threat?.position ?? ctx.threatLastKnown;
      if (!threatPos) {
        ctx.tactical.releaseCover();
        return 'success';
      }

      if (phase === 'hide') {
        ctx.locomotion.moveTo(cover.position, { gait: 'walk', facing: threatPos });
        timer -= ctx.delta;
        if (timer <= 0) {
          const peeks = ctx.tactical.peekPositions();
          if (!peeks) return 'failure';
          // Asoma por el lado que mas se acerca al threat (mejor angulo de tiro).
          peekPoint =
            peeks.left.distanceToSquared(threatPos) <= peeks.right.distanceToSquared(threatPos)
              ? peeks.left
              : peeks.right;
          phase = 'peek';
          timer = 1.0 + Math.random() * 0.4;
        }
        return 'running';
      }

      if (!peekPoint) return 'failure';
      ctx.locomotion.moveTo(peekPoint, { gait: 'walk', facing: threatPos });
      ctx.combat.aim(threatPos);
      if (ctx.locomotion.distanceToTarget() <= 0.5) {
        ctx.combat.tryFire();
      }
      timer -= ctx.delta;
      if (timer <= 0 || ctx.combat.magazineEmpty()) {
        cyclesLeft -= 1;
        if (cyclesLeft <= 0 || ctx.combat.magazineEmpty()) {
          ctx.tactical.releaseCover();
          ctx.locomotion.stop();
          return 'success';
        }
        phase = 'hide';
        timer = 0.6 + Math.random() * 0.6;
      }
      return 'running';
    },
    abort: (ctx) => {
      ctx.tactical?.releaseCover();
      ctx.locomotion.stop();
    },
  };
}

/**
 * Reposicionamiento lateral durante el engage: 2-3 m perpendiculares al
 * threat, sin dejar de apuntarle. Es lo que hace que los soldados "bailen"
 * en vez de plantarse como torretas. Alterna el lado entre invocaciones.
 */
export function createRepositionTask(lateralDistance = 2.5, timeout = 1.8): NpcTask {
  let target: Vector3 | null = null;
  let side = Math.random() < 0.5 ? 1 : -1;
  let elapsed = 0;
  return {
    id: 'reposition',
    init: (ctx) => {
      target = null;
      elapsed = 0;
      side = -side;
      const threatPos = ctx.threat?.position;
      if (!threatPos) return;
      const self = ctx.self.position;
      const toThreatAngle = Math.atan2(threatPos.x - self.x, threatPos.z - self.z);
      const lateralAngle = toThreatAngle + side * Math.PI * 0.5;
      tmpCandidate.copy(pointAt(self, lateralAngle, lateralDistance));
      target = snapToNav(ctx.navigation, ctx.navigationProfile, [
        tmpCandidate.clone(),
        pointAt(self, lateralAngle + side * 0.5, lateralDistance),
      ]);
    },
    tick: (ctx): TaskStatus => {
      const threatPos = ctx.threat?.position;
      if (!target || !threatPos) return 'success';
      elapsed += ctx.delta;
      // Sigue apuntando mientras se mueve: la rafaga pendiente del combat
      // handle necesita aim continuo para no abortarse.
      ctx.combat.aim(threatPos);
      ctx.locomotion.moveTo(target, { gait: 'walk', facing: threatPos });
      if (ctx.locomotion.distanceToTarget() <= 0.6 || elapsed >= timeout) {
        ctx.locomotion.stop();
        return 'success';
      }
      if (ctx.locomotion.isStuck()) {
        ctx.locomotion.stop();
        return 'success';
      }
      return 'running';
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}
