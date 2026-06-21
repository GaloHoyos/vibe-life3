---
description: Code review estructurado del branch actual contra main.
argument-hint: "[base] (default: main) — branch/commit base, o ruta para acotar scope"
---

Sos un revisor experto en código TypeScript / three.js para vibe-life 3, un FPS 3D singleplayer en navegador. Hacé un review exhaustivo del branch actual.

**Base de comparación:** `$ARGUMENTS` si se pasó algo; si está vacío, usá `main`. Si el argumento parece una ruta (`engine/`, `src/...`), usá `main` como base y acotá el review a esa ruta.

## Pasos

1. `git rev-parse --abbrev-ref HEAD` — nombre del branch actual.
2. `git merge-base <base> HEAD` — punto de divergencia. Llamalo `BASE` de acá en más.
3. `git diff BASE --stat` y `git status --short` — resumen de archivos cambiados, **incluyendo los que están sin commitear**. El working tree es parte del review; no lo ignores.
4. `git diff BASE` — diff completo (committeado + working tree contra el merge-base).
5. Para cualquier archivo donde necesites juzgar lifecycle/dispose/acoplamiento, **leé el archivo entero**, no solo el hunk: el diff no muestra suficiente contexto para saber si un `dispose()` limpia todo o si un import cruza capas.
6. **Verificá tipos de verdad, no a ojo.** Corré `npx tsc --noEmit` (o invocá `/check` para tsc + build). El veredicto de tipos/compilación se basa en este resultado, no en leer el diff. Si tsc falla, los errores son hallazgos bloqueantes con su mensaje exacto.
7. Analizar los cambios y producir un review estructurado.

## Qué revisar

### Overview
- Qué hace este branch (2-3 oraciones).
- Archivos cambiados (conteo y los más relevantes).
- Capas tocadas: `engine/`, `game/`, `shared/`.

### Reglas del proyecto (bloqueantes — ver `CLAUDE.md`)

- **Separación de capas:** ningún archivo en `engine/` puede importar de `game/`. Si la dependencia es real, el tipo va a `shared/` o se invierte vía interface.
- **TypeScript estricto:** cero `any`, cero `@ts-ignore`. Flagear toda ocurrencia.
- **Comentarios:** cero comentarios redundantes. Solo JSDoc o inline cuando explican el *por qué* (constraint oculto, workaround, comportamiento sorprendente). Nunca el *qué*.
- **Idioma:** strings visibles al jugador (UI, subtítulos, mensajes) en español. Identificadores y comentarios técnicos en inglés.
- **Binarios intocables:** cambios en `src/models/` o `src/engine/assets/sounds/` requieren confirmación explícita. Mismo criterio para `src/engine/assets/textures/` y `src/engine/assets/hdri/`.

### Patrones de la arquitectura

- **ServiceContainer / tokens:** servicios nuevos declarados en `engine/core/ServiceTokens.ts` o `game/ServiceTokens.ts` según capa. Resueltos por token tipado, no instanciados a mano.
- **EventBus tipado:** eventos nuevos extendiendo `GameEventMap` en `src/game/GameEvents.ts`. Naming: `dominio.acción` minúsculas (`weapon.fired`, `npc.killed`). Sin camelCase ni mezclar tiempos verbales.
- **Suscriptores:** todo `bus.on(...)` debe guardar el disposer y llamarlo en `dispose()`. Flagear leaks.
- **Lifecycle:** widgets/sistemas con `setTimeout`, listeners DOM, o recursos Three.js (geometries/materials/textures) deben implementar `Disposable` y limpiar.
- **Component + View en UI:** paneles no triviales viven en dos archivos (`X.ts` con lifecycle + suscripciones, `XView.ts` con render puro). El View no toca el bus.
- **Data-driven:** contenido nuevo debería entrar como entrada en tabla (`weapons.config.ts`, `audio.config.ts`, `AudioManifest.ts`, `TextureSets`, `Materials`, `SkyboxManifest`, `LevelRegistry`) — no clases nuevas salvo que el comportamiento sea genuinamente distinto.
- **Path aliases:** `@engine/*`, `@game/*`, `@shared/*` en archivos nuevos. Las rutas relativas existentes conviven, pero código nuevo usa alias.
- **shared/ sin Three.js:** nada de imports de three fuera de tipos estructurales (`Vector3`, `Object3D`).

### Modularidad y escalabilidad

Que el código nuevo no se convierta en un cuello de botella cuando el juego crezca (más armas, niveles, NPCs, sistemas).

- **Acoplamiento:** módulos nuevos no deberían conocer detalles internos de otros. Comunicación entre sistemas vía `EventBus` o servicios resueltos por token, no imports directos a clases concretas que vivan en otro dominio.
- **Responsabilidad única:** cada clase / archivo hace una cosa. Si un archivo mezcla render + lógica + estado de UI, separarlo (Component+View, o extraer servicio).
- **Extensibilidad sin tocar el core:** agregar una nueva variante (arma, NPC, material, nivel, evento) no debería requerir editar lógica genérica del motor. Si la única forma de sumar contenido es modificando `Engine.ts`, `Player.ts` o un factory con un `switch` que crece, hay un problema de diseño — flagearlo y sugerir tabla / strategy / registry.
- **No hardcodes que escalan mal:** valores que dependen del nivel/arma/NPC deberían vivir en `config/` o en la `LevelDefinition`, no como literales adentro de clases.
- **Reuso transversal:** lógica que un nivel podría compartir con otro debería extraerse a un builder en `levels/builders/` o a un helper en `shared/`, no inlinearse.
- **APIs estables:** servicios registrados en el container exponen una superficie clara. Métodos públicos nuevos tienen tipos explícitos, no devuelven internals mutables.
- **Sin dependencias circulares:** chequear que los cambios no introduzcan ciclos `engine ↔ game`, ni dentro de `game/` entre módulos pares (ej. `weapons` ↔ `npc`).
- **Tamaño de archivo:** un archivo que supera ~400 líneas y mezcla concerns probablemente debería partirse. No es regla dura, pero vale revisar.

### Calidad de código

- Bugs de lógica, edge cases no manejados.
- Memory leaks: refs a `Object3D`/`Geometry`/`Material`/`Texture` que no se disponen.
- Suscripciones al bus sin disposer.
- Race conditions en carga de assets / cambio de nivel.
- Cálculos en hot path (per-frame) que deberían cachearse.

### Three.js / Rapier específico

- Geometrías/materiales/texturas creados en hot path sin reuso.
- `dispose()` faltante al destruir meshes/escenas.
- Colliders Rapier huérfanos al remover entidades.
- Uniformes/materiales compartidos que se mutan en lugar de clonarse.
- `MeshStandardMaterial` con `aoMap` sin asegurar segundo canal de UV (`uv1`).
- Llamadas `scene.add` sin contrapartida `scene.remove` en cleanup.

### Performance

- Allocs en el loop (`new Vector3()` por frame).
- Materiales o geometrías duplicados que deberían compartirse.
- Raycasts excesivos por frame.
- Texturas sin tiling apropiado o cargadas en tamaño innecesario.

### Seguridad / robustez

- Input del jugador (formularios, save data) validado.
- Sin secretos hardcodeados (poco probable en este stack, pero chequear).
- Manejo de assets faltantes (GLB / textura no carga) no rompe el juego.

## Reglas del review

- **Solo lo que cambió.** Comentá únicamente código tocado por el diff. Si una mejora afecta código preexistente no tocado, marcala explícitamente como `(preexistente)` y dejala al final, no la mezcles con lo del branch.
- **No rellenes.** Si una sección no tiene hallazgos, omitila. No inventes problemas para que el review se vea completo. Mejor un review corto y certero que uno largo y especulativo.
- **Severidad explícita.** Cada hallazgo arranca con un tag: `[BLOCKER]`, `[MAJOR]`, `[MINOR]` o `[NIT]`. Ordená cada sección de mayor a menor severidad.
- **Falsos positivos típicos a evitar:** materiales/geometrías *compartidos* (cacheados, reusados entre entidades) NO deben disponerse por entidad — no los flaguees como leak. Rutas relativas `./` entre vecinos del mismo directorio son válidas (no exijas alias ahí). Un `any` en `.d.ts` de terceros no es violación del proyecto.

## Output

Empezá con un **Summary** (2-4 oraciones: qué hace el branch, calidad general, y el resultado de `tsc`/build).

Luego organizá los hallazgos en secciones (omití las vacías):

- **Bugs / Errores de lógica** — comportamiento incorrecto.
- **Violaciones de tipo** — `any`, `@ts-ignore`, return types implícitos.
- **Violaciones de patrón** — capas cruzadas (`engine/` → `game/`), eventos mal nombrados, disposers faltantes, contenido hardcodeado en lugar de tabla.
- **Modularidad / escalabilidad** — acoplamientos fuertes, responsabilidades mezcladas, `switch`/factories que crecen con cada feature, ciclos de imports, archivos demasiado grandes.
- **Memory leaks / lifecycle** — Three.js, Rapier, listeners.
- **Performance** — allocs per-frame, recursos duplicados.
- **Comentarios redundantes** — comentarios que explican el *qué* o que rotan rápido.
- **Idioma** — strings de jugador en inglés o identificadores en español.
- **Sugerencias** — mejoras no bloqueantes (marcar como opcional).

Por cada hallazgo:
- Tag de severidad (`[BLOCKER]`/`[MAJOR]`/`[MINOR]`/`[NIT]`) + path del archivo y línea.
- Qué está mal.
- Cómo arreglarlo (idealmente con el snippet corregido).

Cerrá con un **Verdict**: `APPROVE`, `REQUEST CHANGES`, o `NEEDS DISCUSSION` con una línea de justificación. Si `tsc` falla o hay algún `[BLOCKER]`, el verdict no puede ser `APPROVE`.

Si el branch incluye contenido nuevo (arma, nivel, NPC, material PBR, HDRI, sonido), verificar que se siguió la receta correspondiente de la sección "Cómo extender" del `CLAUDE.md`.
