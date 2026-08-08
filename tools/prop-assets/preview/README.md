# Preview de props

Auditoría visual del catálogo. Un asset no se juzga leyendo su builder: hay que
mirarlo. Estos scripts existen porque se generaron 87 props sin que nadie los
viera nunca, y así se descubrió que el 55% de las caras tenía UVs degeneradas.

Necesitan Blender. Se busca solo en las rutas habituales; `BLENDER` en el
entorno las saltea.

```sh
BLENDER=/ruta/a/blender

# Un render por prop del pack, vista de tres cuartos.
"$BLENDER" --background --python render-props.py -- \
    src/game/assets/props/models/propsWood.glb /tmp/shots 320

# Salud de las UVs: `degeneradas` tiene que dar 0.
"$BLENDER" --background --python probe-uv.py -- \
    src/game/assets/props/models/propsWood.glb woodenCrate

# Vuelca los tres atlas del pack a PNG y reporta el color medio por casilla.
"$BLENDER" --background --python dump-atlas.py -- \
    src/game/assets/props/models/propsWood.glb /tmp/atlas
```

Qué mirar:

- **`degeneradas` distinto de 0** en la sonda de UVs: hay caras muestreando una
  línea de téxeles. Es el defecto que hacía ver los props como plástico liso.
- **`area_uv_total`** debe crecer con el tamaño del prop. Si no, la densidad de
  téxel dejó de ser proporcional al mundo.
- **Atlas que parece una nube teñida**: el horneado de Blender no corrió y se
  cayó al generador procedural de reserva.
