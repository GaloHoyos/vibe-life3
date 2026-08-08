# Props — inventario y hoja de ruta

Documento de trabajo de la rama de props. Registra qué hay, qué falta y con qué
criterio se decide. No es documentación de arquitectura: eso vive en `CLAUDE.md`
y en los comentarios del código.

**Estado:** 73 de ~90 arquetipos objetivo. Prioridades 1 a 4 completas.

---

## Cómo se decide qué entra

El set no es un port de Half-Life 2. HL2 es la referencia de *vocabulario* —qué
categorías de objeto hacen falta para que un espacio se lea como habitado— pero
el objetivo es un catálogo para un supuesto HL3 más un kit de autoría para mapas
custom. Tres filtros, en orden:

1. **¿Cambia el juego cuando lo tocás?** Un prop que sólo decora es una textura
   cara. Si no se rompe, no se agarra, no tapa, no bloquea, no suena distinto ni
   estorba, no entra. HL2 tenía cientos de modelos y sólo decenas eran físicos.
2. **¿Se genera proceduralmente sin sufrir?** El pipeline arma geometría desde
   primitivas (ver *Presupuestos*). Una silla, un bidón o un radiador salen
   bien; una estatua tallada no. Si no sale, se reformula o se descarta.
3. **¿Llena un hueco de tamaño/peso/material?** El catálogo tiene que cubrir el
   rango completo, no acumular objetos medianos de madera. Ver *Cobertura*.

Lo que **no** entra como prop: arquitectura. Muros, columnas, contenedores de
carga, torres, rampas y parapetos fijos siguen siendo `staticBoxes`. Es la misma
línea que traza Source entre brushwork y `prop_physics`, y acá además hay una
razón dura: la geometría estática es la que hornea el navmesh y la que ancla
escalones.

---

## Qué había en Half-Life 2

Estructura real del árbol de modelos de HL2 + Episodios, para saber qué
vocabulario cubrió Valve. La mayoría de estas carpetas son props **estáticos**;
las marcadas son las que concentran objetos físicos.

| Carpeta | Contenido | Físicos |
| --- | --- | --- |
| `props_junk` | Basura, botellas, bidones, cajones, latas, baldes, cubos | ★★★ |
| `props_c17` | Mobiliario urbano, muebles de departamento, cañerías, faroles | ★★ |
| `props_interiors` | Sillas, sillones, heladeras, bañeras, lámparas, expendedoras | ★★ |
| `props_lab` | Monitores, servidores, cajas de energía, carpetas, frascos | ★★ |
| `props_wasteland` | Cocina, lavadero, sala de control, muelles, cercos, prisión | ★★ |
| `props_debris` | Escombros: vigas, hierros, losas, placas, pilas de yeso | ★ |
| `props_combine` | Barricadas, monitores, emisores, pods, torres | ★ |
| `props_vehicles`, `props_docks`, `props_canal`, `props_trainstation` | Ambientación por bioma | · |
| `props_foliage`, `props_rooftop`, `props_pipes`, `props_vents`, `props_doors` | Detalle arquitectónico | · |
| `props_buildings`, `props_building_details`, `props_skybox` | Fachadas y fondo | · |
| `props_borealis`, `props_citizen_tech`, `props_animated_breakable` | Específicos de guion | · |

Detalle de las tres carpetas más relevantes, con los nombres reales:

- **`props_junk`** — `wood_crate001a` (con `_damaged` y `_damagedmax`),
  `wood_pallet001a`, `cardboard_box001a..004a`, `plasticcrate01a`,
  `metalbucket01a/02a`, `plasticbucket001a`, `metal_paintcan001a/b`,
  `gascan001a`, `metalgascan`, `propane_tank001a`, `propanecanister001a`,
  `trashbin01a`, `trashdumpster01a/02`, `garbage_bag001a`, `popcan01a`,
  `garbage_metalcan001a/002a`, `garbage_glassbottle001a..003a`, `glassjug01`,
  `garbage_plasticbottle001a..003a`, `garbage_milkcarton001a/002a`,
  `garbage_coffeemug001a`, `garbage_takeoutcarton001a`, `garbage_newspaper001a`,
  `terracotta01`, `watermelon01`, `bicycle01a`, `pushcart01a`, `wheebarrow01a`,
  `shovel01a`, `sawblade001a`, `harpoon002a`, `meathook001a`, `ibeam01a`,
  `cinderblock01a`, `rock001a`, `trafficcone001a`, `vent001`, `shoe001a`.
- **`props_c17`** — `oildrum001` y `oildrum001_explosive`, `canister01a/02a`,
  `canister_propane01a`, `briefcase001a`, `bench01a`, `chair_office01a`,
  `chair_stool01a`, `chair02a`, `furniturecouch001a/002a`,
  `furniturearmchair001a`, `furnituretable001a..003a`,
  `furnitureshelf001a/001b/002a`, `furnituredrawer001a..003a`,
  `furnituredresser001a`, `furniturefridge001a`, `furniturestove001a`,
  `furniturewashingmachine001a`, `furnituresink001a`, `furnituretoilet001a`,
  `furniturebathtub001a`, `furniturebed001a`, `furnituremattress001a`,
  `furnitureradiator001a`, `furnitureboiler001a`, `lockers001a`,
  `cashregister001a`, `metalpot001a/002a`, `clock01`, `doll01`, `paper01`,
  `gravestone001a..004a`, `metalladder001..003`, `concrete_barrier001a`.
- **`props_lab`** — `monitor01a/01b/02`, `harddrive01/02`, `servers`,
  `powerbox01a..03a`, `partsbin01`, `filecabinet02`, `box01a/01b`,
  `jar01a/01b`, `binder*` (seis variantes), `clipboard`, `corkboard001/002`,
  `desklamp01`, `keypad`, `citizenradio`, `kennel`, `chess`, `huladoll`,
  `cactus`, `cleaver`, `ladel`, `workspace001..004`.

**Lectura:** la mitad del catálogo físico de HL2 son *contenedores* (cajones,
cajas, bidones, baldes, latas) y *basura chica*. Eso no es casualidad: son los
objetos que la gravity gun vuelve interesantes y los que llenan un espacio sin
que el jugador los mire. El mobiliario es la otra mitad. Los objetos "de guion"
(pods, teleports, torres) son poquísimos y casi todos estáticos.

---

## Lo que ya existe

73 arquetipos en 7 packs GLB. La tabla lista los de las prioridades 1 y 2; el
escombro y la electrónica están más abajo, en sus etapas.

| # | id | Nombre | Pack | Superficie | Bounds (m) | Rotura | Abolla |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `woodenCrate` | Cajón de madera | Wood | wood | 0.89 × 0.86 × 0.89 | astillas | — |
| 2 | `pallet` | Pallet | Wood | wood | 1.20 × 0.14 × 0.80 | astillas | — |
| 3 | `chair` | Silla | Wood | wood | 0.42 × 0.92 × 0.44 | astillas | — |
| 4 | `table` | Mesa | Wood | wood | 1.40 × 0.74 × 0.80 | astillas | — |
| 5 | `metalBarrel` | Barril metálico | Metal | metal | 0.59 × 0.96 × 0.59 | astillas | ✅ |
| 6 | `explosiveBarrel` | Barril explosivo | Metal | metal | 0.59 × 1.07 × 0.59 | explota | — |
| 7 | `filingCabinet` | Archivero | Metal | metal | 0.50 × 1.32 × 0.66 | astillas | ✅ |
| 8 | `radiator` | Radiador | Metal | metal | 0.92 × 0.60 × 0.14 | astillas | ✅ |
| 9 | `concreteBlock` | Bloque de hormigón | Metal | concrete | 0.40 × 0.20 × 0.20 | **indestructible** | — |
| 10 | `plasticDrum` | Bidón plástico | Synthetic | plastic | 0.61 × 0.89 × 0.62 | astillas | — |
| 11 | `crtTelevision` | Televisor | Synthetic | plastic | 0.52 × 0.44 × 0.49 | astillas | ✅ |
| 12 | `glassBottle` | Botella | Synthetic | glass | 0.08 × 0.29 × 0.08 | astillas | — |
| 13 | `trafficCone` | Cono de tránsito | Synthetic | **rubber** | 0.36 × 0.72 × 0.36 | **indestructible** | — |
| 14 | `cardboardBox` | Caja de cartón | Wood | cardboard | 0.45 × 0.40 × 0.35 | astillas | — |
| 15 | `milkCarton` | Cartón de leche | Wood | cardboard | 0.09 × 0.25 × 0.09 | astillas | — |
| 16 | `woodPlank` | Tabla | Wood | wood | 1.60 × 0.07 × 0.19 | astillas | — |
| 17 | `metalBucket` | Balde | Metal | metal | 0.28 × 0.39 × 0.28 | indestructible | ✅ |
| 18 | `paintCan` | Lata de pintura | Metal | metal | 0.19 × 0.26 × 0.20 | astillas | — |
| 19 | `soupCan` | Lata de conserva | Metal | metal | 0.08 × 0.11 × 0.08 | indestructible | — |
| 20 | `trashBin` | Tacho de basura | Metal | metal | 0.45 × 0.62 × 0.45 | indestructible | ✅ |
| 21 | `gasCan` | Bidón de nafta | Metal | metal | 0.19 × 0.43 × 0.32 | **explota** | — |
| 22 | `propaneTank` | Garrafa de propano | Metal | metal | 0.31 × 0.58 × 0.31 | **explota** | — |
| 23 | `concreteChunk` | Trozo de losa | Metal | concrete | 0.45 × 0.22 × 0.42 | astillas | — |
| 24 | `metalPipe` | Caño | Metal | metal | 1.40 × 0.12 × 0.12 | indestructible | — |
| 25 | `plasticBottle` | Botella de plástico | Synthetic | plastic | 0.08 × 0.24 × 0.08 | astillas | — |
| 26 | `glassJar` | Frasco | Synthetic | glass | 0.11 × 0.16 × 0.11 | astillas | — |
| 27 | `plasticCrate` | Cajón plástico | Synthetic | plastic | 0.60 × 0.33 × 0.40 | astillas | — |
| 28 | `tire` | Neumático | Synthetic | rubber | 0.66 × 0.20 × 0.66 | indestructible | — |

---

## Cobertura: dónde están los huecos

No mirar sólo la lista, mirar el **rango**. El catálogo actual está concentrado
en objetos medianos, de 10–45 kg, agarrables, de un solo material.

### Por peso

| Banda | Rol de juego | Hoy |
| --- | --- | --- |
| < 1 kg | Se vuela de un tiro, ruido ambiental, munición de gravity gun | 5 |
| 1–10 kg | Se patea al caminar, llena el piso | 11 |
| 10–50 kg | El grueso: se agarra, se apila, se usa de cobertura | 19 |
| 50–150 kg | Se empuja pero no se levanta; cobertura seria | 10 |
| > 150 kg | Sólo se mueve con gravity gun, vehículo o explosión | 3 |

Rango cubierto de punta a punta: de 0.2 kg (botella de plástico) a 210 kg
(bañera), que es el techo práctico contra `GravityGunConfig.grabMaxMass` (250).

### Por material

| Superficie | Hoy | Nota |
| --- | --- | --- |
| `metal` | 25 | Bien cubierto |
| `wood` | 12 | Bien cubierto |
| `plastic` | 8 | Bien cubierto |
| `cardboard` | 2 | Estrenado en la prioridad 1 |
| `glass` | 3 | Falta vidrio plano |
| `fabric` | 3 | Sillón, sillón individual y colchón |
| `concrete` | 5 | Ladrillo, trozo, losa, columna y pila |
| `rubber` | 2 | Cono y neumático; falta manguera, cinta |
| `tile`, `dirt`, `sand`, `gravel`, `snow`, `mud`, `grass` | 0 | Son de terreno, no de prop |

### Por comportamiento

| Reacción | Hoy | Falta |
| --- | --- | --- |
| `shatter` | 18 | — |
| `explode` | 3 | Barril, bidón de nafta (chico) y garrafa (grande) |
| `none` | 7 | Cono, bloque, balde, lata, tacho, caño, neumático |
| `collapse` | **0** | Estantería, andamio, torre (los builders existen, sin arquetipo propio) |
| `spawnItem` | **0** | Cajón de munición, botiquín roto, caja de suministros |

---

## Objetivo

~90 arquetipos en 6 packs. Los tres packs nuevos existen para no reventar el
presupuesto de atlas: cada pack comparte 4 tiles PBR.

| Pack | Tema | Hoy | Objetivo | Peso |
| --- | --- | --- | --- | --- |
| `propsWood` | Madera, embalaje, cartón | 7 | 12 | 554 KB |
| `propsMetal` | Metal industrial, hormigón | 13 | 18 | 603 KB |
| `propsSynthetic` | Plástico, vidrio, goma | 8 | 16 | 534 KB |
| `propsInterior` | Mobiliario y tapizado | 12 | 14 | 713 KB |
| `propsAppliance` | Electrodomésticos, baño, lockers | 8 | 10 | 413 KB |
| `propsDebris` | Escombro, chatarra, yeso | 11 | 12 | 658 KB |
| `propsTech` | Electrónica, laboratorio, Combine | 14 | 14 | 703 KB |

### ~~Prioridad 1 — lo que más cambia el juego~~ ✅ HECHA

15 props livianos y contenedores. Los tres packs existentes absorbieron todo sin
romper el techo de 700 KB (Wood 554, Metal 603, Synthetic 534).

Se sustituyó `cinderBlock` por **`concreteChunk`**: `concreteBlock` ya era un
ladrillo, así que el hueco real no era otro bloque entero sino escombro — un
trozo de losa fracturada con hierros salidos, rompible sólo con explosivos.

Notas de calibración:

- Casi ninguno hace daño por impacto. Un tarro a 20 m/s asusta, no mata. Los que
  sí: tabla, caño, tacho, bidón, garrafa y trozo de losa.
- **Indestructibles a propósito** el balde, la lata de conserva, el tacho, el
  caño y el neumático. La gracia de una lata es que sobreviva para volver a
  tirarla, y un caño de 1.4 m girando es de lo mejor que da la gravity gun.
- Balde y tacho **se abollan** en vez de romperse (perfil metálico).
- Dos escalas de explosión: el bidón es carga de mano (55 de daño, 3 m) y la
  garrafa es el evento grande (100, 5 m). El barril queda en el medio.

### ~~Prioridad 2 — mobiliario~~ ✅ HECHA

20 props en **dos** packs nuevos, no uno. El corte es por atlas, no por tema: el
tapizado y la madera barnizada no comparten paleta con el esmalte blanco y el
acero, y meterlos en el mismo set de 4 tiles deja todo del mismo color.

- `propsInterior` (12): sillón, sillón individual, colchón, cama, cómoda,
  ropero, biblioteca, escritorio, mesa de luz, banqueta, banco, silla de oficina.
- `propsAppliance` (8): heladera, lavarropas, cocina, mesada, bañera, inodoro,
  lavatorio, lockers.

Notas de calibración:

- **La banda pesada quedó cubierta.** Bañera 210 kg, lavarropas 180, heladera
  160: por encima de los 35 kg de `CarryConfig` no se levantan con las manos, y
  sólo se mueven con la gravity gun, un vehículo o una explosión.
- **Los de chapa se abollan y no se rompen.** Una heladera baleada queda hecha
  un colador, no astillas. La porcelana es al revés: bañera, inodoro y lavatorio
  estallan con el impacto (×2.5 melee, ×3 explosivo) y se ríen de las balas (×0.4).
- El **colchón** es el primer prop que amortigua: restitución 0, fricción 0.95.
- La **silla de oficina** es la única que rueda: fricción 0.35 y poco freno
  angular, contra el 0.8 del resto del mobiliario.

`propsInterior` lleva un techo de peso más alto (768 KB contra 700). Los 700 se
fijaron para packs de objetos chicos y un sillón de 2 m tiene diez veces el
volumen de una botella. Antes de subirlo se bajaron variantes donde menos
aportaban: sillón, cama y biblioteca van con una sola.

**Gap pendiente: no hay superficie `fabric`.** El colchón y los tapizados usan
`cardboard` y `wood`, que es lo más parecido en sonido de lo que hay. Agregarla
toca tres `Record` totales (`SurfaceAbsorption`, `SurfaceImpactMaterial`,
`SurfaceFootsteps`) más `audio.config.ts`.

### ~~Prioridad 3 — escombro y estructura~~ ✅ HECHA

11 props en `propsDebris`. Es lo que convierte un pasillo en un pasillo
*derrumbado*.

| id | Superficie | Masa | Rotura |
| --- | --- | --- | --- |
| `concreteSlab` | concrete | 190 kg | astillas |
| `brokenPillar` | concrete | 170 kg | astillas |
| `brickPile` | concrete | 65 kg | astillas |
| `rebarBundle` | metal | 48 kg | indestructible, se abolla |
| `iBeam` | metal | 230 kg | indestructible, se abolla |
| `metalPanel` | metal | 22 kg | indestructible, se abolla |
| `scrapHeap` | metal | 70 kg | astillas + se abolla |
| `scaffoldPipe` | metal | 11 kg | indestructible, se abolla |
| `plasterSlab` | tile | 14 kg | astillas |
| `sandbag` | sand | 22 kg | indestructible |
| `barricadeWood` | wood | 26 kg | astillas |

Dos reglas de la familia:

- **El hormigón se ríe de las balas** (×0.15) y sólo cede a explosivos (×3). Es
  lo que lo vuelve cobertura de verdad y no decorado rompible.
- **El acero estructural no se rompe: se dobla.** Viga, tubo de andamio, atado
  de hierros y chapa son indestructibles y deformables. La chapa además es
  liviana (22 kg para 1.1 m): se va al aire con cualquier explosión.

`iBeam` y `scaffoldPipe` son los miembros naturales de `scaffoldTowerStructure`,
que hoy arma la torre con `concreteBlock` —un ladrillo de 40 cm, indestructible—
por falta de algo mejor. **Cambiar el preset a estos queda pendiente**: es un
cambio de gameplay en los mapas que ya la usan.

Se descartó `barrelRusted` (redundante con `metalBarrel`) y `concreteChunk` en
tres tamaños: el que ya existía cubre el chico y `concreteSlab` el grande.

### ~~Prioridad 4 — electrónica y Combine~~ ✅ HECHA

14 props en `propsTech`, y con ellos **la primera capacidad nueva del pipeline
desde que arrancó el catálogo**: piezas emisivas.

| id | Superficie | Masa | Vida | Emite |
| --- | --- | --- | --- | --- |
| `monitor` | plastic | 12 kg | 24 | pantalla |
| `serverRack` | metal | 145 kg | 200 | testigos por bahía |
| `harddrive` | metal | 0.7 kg | ∞ | — |
| `powerBox` | metal | 16 kg | 45 | testigo |
| `keypad` | metal | 2.5 kg | 45 | display |
| `radio` | plastic | 3.5 kg | 16 | dial |
| `vendingMachine` | metal | 195 kg | 240 | cartel |
| `waterCooler` | plastic | 28 kg | 40 | — |
| `labJar` | glass | 1.4 kg | 3 | el líquido |
| `partsBin` | metal | 5 kg | 55 | — |
| `combineCrate` | metal | 55 kg | 180 | sellos |
| `combineBarrier` | metal | 95 kg | ∞ | franja |
| `combineEmitter` | metal | 42 kg | 90 | cabezal |
| `combineLamp` | metal | 9 kg | 50 | tubo |

**Emisivos.** `PropGeometry` ganó un tercer bucket, `emissive`, que sale a su
propio material igual que el vidrio. Un emisor pintado en el atlas sería apenas
una mancha clara; con `emissiveFactor` la pieza se lee encendida en un cuarto a
oscuras. El color viene del pack (`emissiveColor`), en cian Combine.

**No agregan luces a la escena, y no es un olvido.** Sumar o esconder una luz
recompila todos los materiales y cuesta segundos de freeze — es el mismo motivo
por el que la luz del muzzle flash nace con intensidad 0 y nunca se togglea. Un
emisor que ilumine el ambiente es trabajo del sistema de VFX, no del asset.

**Lo frágil y lo Combine.** Casi todo el pack cede a un par de tiros porque son
carcasas finas alrededor de tubos y vidrio (el frasco tiene 3 de vida, el menos
resistente del catálogo). Lo Combine es la excepción: chapa de verdad, con vida
alta y deformación, y la barricada directamente no se rompe — se abolla, que es
lo que hace un parapeto.

Los dos props de casi 1.9 m —rack y expendedora— son además pesos pesados de
145 y 195 kg.

### Prioridad 5 — utilería de mapa custom

No son de campaña; son para el editor. Objetos que un autor quiere tener a mano.

`ladder`, `handrail`, `fenceSection`, `sandbagWall`, `ammoCrate` (`spawnItem`),
`medCrate` (`spawnItem`), `toolCart`, `wheelbarrow`, `shoppingCart`, `bicycle`,
`streetSign`, `mailbox`, `flowerPot`, `crateLong`, `crateHuge`.

---

## Presupuestos y restricciones

Salen del pipeline actual; romperlos hace fallar `props:validate` o el contract
test.

- **LOD0** ≤ 3500 tris, **LOD1** ≤ 900. Dos LODs, no tres.
- ≤ 3 draws por LOD. **Pack ≤ `maxGlbBytes` de su spec** (700 KB salvo
  `propsInterior`, que lleva 768 por el tamaño de los muebles). El contract test
  lee el spec, no un número fijo.
- Casco de colisión ≤ 48 vértices, con `signedVolume > 0`.
- Fragmentos: 6–12 por arquetipo rompible.
- Atlas de 512², 4 tiles por pack.
- La malla va **centrada en su AABB** y todas las variantes miden **igual**: el
  collider es uno solo para todas. Las variantes cambian el detalle interior,
  nunca el envoltorio.
- `bounds` se declara en tres lugares (`props.config.ts`, `tools/prop-assets/types.ts`
  y el manifiesto generado) y hay validador que los ata.

Primitivas disponibles en `tools/shared/gltf/geometry.ts`: `chamferBox`,
`roundedBox`, `loftedBody`, `panel`, `wheel`, `rivetRow`, `chamferWedge`,
`bakeVertexOcclusion`. Lo que se pueda expresar con eso sale barato; lo que no,
hay que agregar primitiva (y ahí conviene que sirva para varios props).

---

## Cómo se agrega un prop

1. `tools/prop-assets/models.ts` — el builder, y registrarlo en `PROP_BUILDERS`.
2. `tools/prop-assets/types.ts` — id, pack y `bounds`.
3. `npm run props:generate` y `npm run props:validate`.
4. `src/game/config/props.config.ts` — el arquetipo: masa, vida,
   multiplicadores, reacción, superficie, `bounds`, `navBlocking` si es ancho.
5. Si se abolla, `deform` — sólo familia metálica.
6. Si es cobertura anclada, verificar que emita `navBlocker`.
7. `npm run typecheck` y `npm run test`.
8. Si toca geometría de mapas, `npm run nav:bake` **y borrar los `.navbin`
   huérfanos**: el bake no los purga.

Los builders se reparten por familia (`models.ts`, `modelsInterior.ts`) sobre el
kit común de `builderKit.ts`. Los tipos y `variantRandom` viven ahí y no en
`models.ts` justamente para que no haya ciclo de imports.

Trampas que ya costaron sangre y están documentadas en el código:

- **Nada que cambie el envolvente puede depender de la variante.** Una puerta
  que se abre al azar, una tapa opcional o un hierro de largo variable hacen que
  cada variante mida distinto, y todas comparten un solo casco de colisión. El
  validador lo agarra, pero cuesta una vuelta entera de generación.
- La malla **centrada en su AABB**, o el prop flota.
- `navBlocking` en el arquetipo *y* huella sobre `navBlockerMinFootprint`, o los
  NPCs lo atraviesan sin que falle ningún test.
- Un prop nuevo que sea cobertura tiene que llegar al `TacticalMapAnalyzer`.
- Sonido nuevo ⇒ `npm run audio:levels` (hay contract test que lo exige).

---

## Bitácora

| Fecha | Cambio |
| --- | --- |
| 2026-08-07 | Documento inicial. 13 arquetipos. Cajones migrados desde `staticBoxes`; pilas de 2+ capas se derrumban |
| 2026-08-07 | **Prioridad 1 completa: 13 → 28 arquetipos.** Estrenada la superficie `cardboard`; cubiertas las bandas de < 1 kg y 1–10 kg |
| 2026-08-07 | **Prioridad 2 completa: 28 → 48 arquetipos.** Packs `propsInterior` y `propsAppliance`; cubierta la banda de > 150 kg. Rango completo de 0.2 a 210 kg |
| 2026-08-07 | Superficie `fabric` agregada: absorción 0.88 (la más alta), impactos sobre `physics.hl2.body.soft*`, sin pool de rotura. Sillón, sillón individual y colchón migrados |
| 2026-08-07 | **Prioridad 3 completa: 48 → 59 arquetipos.** Pack `propsDebris` |
| 2026-08-07 | **Prioridad 4 completa: 59 → 73 arquetipos.** Pack `propsTech`; el pipeline aprendió piezas **emisivas** (tercer bucket de `PropGeometry`, material propio como el vidrio) |
