# Testing

## Checks automaticos

Usar estos comandos antes de cerrar cambios de gameplay, editor o engine:

- `npm run typecheck`: valida TypeScript estricto sin emitir archivos.
- `npm run test`: corre la suite automatizada de Vitest.
- `npm run test:coverage`: corre Vitest con reporte en `coverage/`.
- `npm run test:ci`: comando local para CI, ejecuta build/typecheck + tests.

La cobertura todavia no tiene umbral bloqueante; por ahora sirve como linea base
para detectar zonas sin tests y revisar regresiones.

## Jerarquia automatizada

Los tests viven fuera de `src`:

```text
tests/
  setup/        # setup Vitest node/dom
  support/      # fixtures, fakes y assertions compartidas
  unit/         # unit tests espejando src/
  integration/  # integracion liviana sin browser real
  contracts/    # integridad de configs, registries y manifests
```

Reglas:

- No agregar `.test.ts` ni `.spec.ts` dentro de `src`.
- Espejar el path productivo: `src/game/levels/Foo.ts` -> `tests/unit/game/levels/Foo.test.ts`.
- Importar codigo productivo con `@game`, `@engine` y `@shared`.
- Importar helpers con `@tests`.
- Los tests DOM usan el proyecto `happy-dom`; no son E2E. La evidencia de
  browser real se ejecuta por separado con el harness Playwright de Blob V2.

## Evidencia Chromium de Blob V2

`scripts/blob-v2-evidence.mjs` es el harness Playwright reproducible de
`?level=blob-test`. Levanta Vite en `127.0.0.1:4173` y separa la entrega en dos
clases de artefacto:

- 15 screenshots verificables: `idle`, `movement`, `climb`, `grate-flow`,
  `digest`, `growth`, `breach`, `core-exposed`, `return`, `reattach`, `wither`,
  `death`, `freeze`, `portal` y `poses`;
- exactamente cuatro videos principales: `locomotion-climb`, `grate-flow`,
  `split-return-reattach` y `split-wither`.

Preparacion y ejecucion:

```bash
npm install
npm run evidence:blob-v2:install
npm run evidence:blob-v2:gpu-smoke
npm run evidence:blob-v2:screenshots
npm run evidence:blob-v2:videos
npm run evidence:blob-v2
```

`evidence:blob-v2:smoke` y `evidence:blob-v2:gpu-smoke` ejecutan solo `idle`; el
segundo nombre explicita que también valida WebGL2 sobre SwiftShader. Los PNG y
sidecars quedan en `.artifacts/blob-v2/screenshots/`; los cuatro WebM reales y
sus sidecars, en `.artifacts/blob-v2/videos/`. `manifest.json` mantiene arrays
independientes `screenshots` y `videos`, con hashes SHA-256, telemetry y estado
de cada evidencia. La carpeta `.artifacts/blob-v2/` está ignorada por Git.

Los goldens PNG sí se versionan en `tests/golden/blob-v2/`. Una corrida normal
decodifica golden y captura en Chromium y exige dimensiones idénticas y no más
de 1% de píxeles cambiados (un píxel cambia si algún canal RGBA difiere más de
8). Actualizarlos requiere una acción explícita:

```bash
npm run evidence:blob-v2:update-goldens
```

Ese modo queda registrado como `updated` en sidecar y manifest; nunca se
actualiza un golden implícitamente durante una comparación.

Contrato reproducible:

- viewport `1280x720`, DPR `1`, locale `en-US`, zona `UTC` y reduced motion;
- `Math.random` con seed `0xb10b2026` y seed del organismo `0x51f15e`;
- fecha browser fija `2026-07-14T12:00:00.000Z`;
- Chromium se lanza con ANGLE/SwiftShader y el harness falla si el renderer no
  contiene `SwiftShader`; cada captura usa un proceso Chromium limpio para que
  caches WebGL de una toma no alteren la siguiente;
- el game loop queda detrás de un gate de RAF; primero se ejecutan 75 pasos
  fijos (`2.5 s`) para asentar físicamente el organismo y luego cada escenario
  avanza exclusivamente su delta declarado en pasos de `1/30 s`;
- toda teleportación aplica también `__player.look(yaw, pitch)`: la cámara
  turntable usa `[0, 1, -2.5]`, yaw/pitch `0/0`, y la toma de wither usa
  `[26.5, 1.2, -8.5]`;
- HUD y subtítulos se ocultan sólo en evidence; canvas, escena y Blob reales se
  conservan;
- cada screenshot exige superficie marching-cubes terminada, cero fallback,
  estado/eventos esperados, telemetry y diagnostics de motion/traversal/pose;
- cada video apunta a `15.2 s` de pared y recupera pasos fijos si SwiftShader
  tarda mas que el tick nominal, de modo que el reloj simulado no dependa del
  runner; se recorta con FFmpeg de Playwright y se rechaza fuera del rango
  real de `10-15 s`.

Opciones utiles:

```bash
node scripts/blob-v2-evidence.mjs --screenshot breach
node scripts/blob-v2-evidence.mjs --video split-wither
node scripts/blob-v2-evidence.mjs --screenshots-only
node scripts/blob-v2-evidence.mjs --videos-only
node scripts/blob-v2-evidence.mjs --headed
node scripts/blob-v2-evidence.mjs --base-url http://127.0.0.1:5173/
```

`--scenario` se conserva como alias de `--screenshot`. También acepta
`BLOB_V2_BASE_URL`, `BLOB_V2_PORT`, `BLOB_V2_HEADED=1` y
`BLOB_V2_ARTIFACT_DIR`. Si falta el browser, el harness corta con la etapa
`chromium-launch` en `run-failure.json` y la recuperacion exacta es
`npm run evidence:blob-v2:install`. Un fallo de captura o encoder queda en el
sidecar correspondiente; no se aprueba ninguna evidencia sin artefacto no
vacío, assertions semánticas y contrato de browser cumplidos.

## Benchmark Blob V2

El runner determinista mantiene dos organismos en 250 de biomasa y doce
fragmentos simultáneos. La corrida de aceptación dura 60 segundos; mide
simulación, frame combinado, scheduler/mallado, espera de jobs, memoria y
conservación de biomasa, y falla con exit code distinto de cero si no cumple
algún presupuesto:

```bash
npm run benchmark:blob-v2
```

El resultado reproducible queda en `.artifacts/blob-v2/benchmark.json` e
incluye plataforma, versión de Node, percentiles, máximos y cada criterio. Para
iterar sin declarar aceptación se puede ejecutar un smoke corto:

```bash
npm run benchmark:blob-v2 -- --smoke --seconds=12
```

Presupuestos bloqueantes: frame p95 `<=16.7 ms`, simulación combinada p95
`<=7 ms` a biomasa máxima, frame global de mallado p95 `<=3.5 ms`, ningún job
individual `>8 ms`, espera visual `<250 ms`, menos de 12 MB CPU y 8 MB GPU por
Blob totalmente dividido, y cero jobs huérfanos al finalizar.

## Smoke manual

Despues de cambios estructurales o visuales, correr `npm run dev` y verificar:

- [ ] Menu principal carga sin errores en consola.
- [ ] "Nueva Partida" -> Demo: el nivel se carga, el pointer-lock activa al click.
- [ ] WASD + mouse mueven al jugador; salto con espacio.
- [ ] Cambiar de arma con 1-5 y rueda del mouse.
- [ ] Disparar cada arma (pistol/SMG/AR3/crowbar/gravity gun) con sonido, recoil visible, tracer/decals.
- [ ] Recoger un weapon pickup duplicado suma ammo.
- [ ] E sobre el boton de la puerta: abre/cierra con dialogo.
- [ ] Recibir dano del NPC zombie: HUD parpadea, vida baja.
- [ ] Matar al NPC: ragdoll cae y aparece el feedback esperado.
- [ ] Audio de pasos suena al caminar.
- [ ] F3 toggle del debug overlay.
- [ ] Esc pausa el juego; reanudar lo destraba.

## Controles

| Tecla             | Accion                              |
| ----------------- | ----------------------------------- |
| `Click`           | Capturar mouse (pointer-lock)       |
| `WASD`            | Mover                               |
| `Mouse`           | Mirar                               |
| `Espacio`         | Saltar                              |
| `Click izquierdo` | Disparar / golpear                  |
| `1`-`5`, rueda    | Cambiar de arma                     |
| `R`               | Recargar                            |
| `E`               | Interactuar                         |
| `F3`              | Debug overlay                       |
| `Esc`             | Pausar / liberar mouse              |
