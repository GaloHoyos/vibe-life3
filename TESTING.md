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
- Los tests DOM usan el proyecto `happy-dom`; no son E2E y no levantan Playwright.

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
