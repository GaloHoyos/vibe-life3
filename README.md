# Browser FPS Engine Base

Base modular para un FPS 3D singleplayer de navegador con TypeScript, Vite, Three.js y Rapier.js.

## Requisitos

- Node.js 18 o superior.
- npm.

## Instalacion

```bash
npm install
```

## Ejecucion local

```bash
npm run dev
```

Abrir la URL que muestre Vite, normalmente `http://127.0.0.1:5173`.

## Build

```bash
npm run build
```

## Controles

- `Click`: capturar mouse.
- `WASD`: mover.
- `Mouse`: mirar.
- `Espacio`: saltar.
- `Click izquierdo`: disparar.
- `E`: interactuar.
- `F3`: debug overlay.
- `Esc`: liberar mouse.

## Estructura

```text
src/
  engine/      nucleo, loop, input, eventos y escenas
  render/      renderer, camara, luces y materiales
  physics/     mundo Rapier, colliders, raycasts y character controller
  animation/   animacion procedural runtime y ragdoll basico
  characters/  presets y factory de personajes/NPCs
  gameplay/    player, vida, interaccion, inventario y armas
  ai/          NPC, estados, percepcion y combate base
  levels/      definicion y carga de niveles
  narrative/   dialogos, eventos y secuencias
  ui/          HUD, menu, pausa y subtitulos
  debug/       overlay y gizmos
```

## Preparado para extender

La base deja puntos claros para sumar GLB/glTF, mapas externos, puzzles fisicos, mas armas, NPCs, ragdolls, checkpoints, postprocessing y audio espacial sin concentrar la logica en `main.ts`.
