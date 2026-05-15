---
description: Arranca la siguiente fase pendiente del refactor (plan de 12 fases en CLAUDE.md).
argument-hint: [n]  (opcional, número de fase específica)
---

Trabajo en el refactor estructurado de vibe-life 3 — plan de 12 fases descrito en `CLAUDE.md`.

Si el usuario pasó un número como argumento ($ARGUMENTS), atacar esa fase. Si no, identificar la siguiente fase pendiente (primer ⬜ en CLAUDE.md) y proponerla.

Antes de tocar código:

1. Releer la fase correspondiente en el plan original (está en `CLAUDE.md` resumida; el plan completo vino en el primer prompt del usuario, no está versionado, así que asumir solo lo que CLAUDE.md describe).
2. Hacer un mini-diagnóstico del estado actual del repo en los archivos que toca esa fase.
3. Proponer al usuario un desglose en sub-fases atómicas (cada una verificable con `tsc --noEmit`).
4. Esperar confirmación antes de modificar nada.

Durante la ejecución:

- Sub-fase por sub-fase, con `tsc --noEmit` verde al final de cada una.
- Si una sub-fase rompe el árbol, parar y reportar antes de seguir.
- Al cerrar la fase: actualizar el checklist de fases en `CLAUDE.md` (cambiar ⬜ → ✅).
- Resumen final breve: qué cambió, archivos clave, qué queda para la siguiente fase.
