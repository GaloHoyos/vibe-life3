# Smoke test manual

Para verificar regresiones después de cambios estructurales, correr `npm run dev` y ejecutar:

- [ ] Menú principal carga sin errores en consola.
- [ ] "Nueva Partida" → Demo: el nivel se carga, el pointer-lock activa al click.
- [ ] WASD + mouse mueven al jugador; salto con espacio.
- [ ] Cambiar de arma con 1-5 y rueda del mouse.
- [ ] Disparar cada arma (pistol/SMG/AR3/crowbar/gravity gun) — todas suenan, recoil visible, tracer/decals.
- [ ] Recoger un weapon pickup duplicado suma ammo.
- [ ] E sobre el botón de la puerta: abre/cierra con diálogo.
- [ ] Recibir daño del NPC zombie: HUD parpadea, vida baja.
- [ ] Matar al NPC: ragdoll cae, subtítulo "Entidad hostil neutralizada".
- [ ] Audio de pasos suena al caminar (snow).
- [ ] F3 toggle del debug overlay (FPS, posición, NPCs).
- [ ] Esc pausa el juego; reanudar lo destraba.

## Controles

| Tecla             | Acción                              |
| ----------------- | ----------------------------------- |
| `Click`           | Capturar mouse (pointer-lock)       |
| `WASD`            | Mover                               |
| `Mouse`           | Mirar                               |
| `Espacio`         | Saltar                              |
| `Click izquierdo` | Disparar / golpear                  |
| `1`–`5`, rueda    | Cambiar de arma                     |
| `R`               | Recargar                            |
| `E`               | Interactuar                         |
| `F3`              | Debug overlay (FPS, posición, NPCs) |
| `Esc`             | Pausar / liberar mouse              |
