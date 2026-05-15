---
description: Corre tsc --noEmit y vite build; reporta resultados.
---

Verifica el estado del build en dos pasos:

1. Corre `npx tsc --noEmit` y reporta si hubo errores (cuántos y el primer puñado).
2. Si tsc pasa, corre `npx vite build` y reporta tamaño del bundle + warnings.
3. Resume el resultado en una sola línea al final: `✅ tsc + build OK` o `❌ tsc: N errors` / `❌ build failed`.

No modifiques nada — es solo verificación.
