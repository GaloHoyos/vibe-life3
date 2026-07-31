# Roadmap 2 — Campaña «Hacia el Ártico»

Evaluación y plan de producción para una campaña inspirada en *Epistle 3*,
estructurada en 14 capítulos y 65 mapas.

## Veredicto

La campaña es viable como objetivo de largo plazo, pero no puede producirse hoy
con la fidelidad narrativa, visual y mecánica planteada.

La base actual sí permite hacer inmediatamente un vertical slice o greybox con:

- combate FPS y arsenal completo;
- Alyx y rebeldes aliados;
- IA con percepción, sospecha, ruido, navegación, cobertura y squads;
- terreno y material de nieve;
- edificios e interiores procedurales;
- puertas, física, hazards, pickups y checkpoints runtime;
- Entity I/O, spawners, relays, timers, counters, objetivos y cambios de mapa;
- secuencias simples de NPC, gestos, diálogo subtitulado y follow/escort;
- transiciones entre mapas con continuidad del jugador.

Eso alcanza para prototipar partes de los capítulos 1 y 3–8. No alcanza para el
viaje en helicóptero, actuaciones de personajes, clima de supervivencia ni para
los capítulos 9–14 dentro del Borealis. Los bloqueos mayores son las mecánicas
vehiculares especiales, cinemáticas, personajes narrativos, pipeline de arte,
guardado persistente y el sistema de realidades/tiempo.

No se debe empezar la producción final de los 65 mapas antes de superar los
vertical slices definidos en este documento. De lo contrario, la introducción
posterior de savegames, branching, cinemáticas y estados temporales obligaría a
rehacer gran parte de los mapas.

### Leyenda

- **Listo:** se puede construir con los sistemas actuales.
- **Parcial:** admite greybox o una versión muy simplificada.
- **Bloqueado:** falta una capacidad estructural o contenido irremplazable.

## Inventario actual aprovechable

| Área | Estado | Disponible hoy | Límite principal |
| --- | --- | --- | --- |
| Arsenal | Listo | Crowbar, pistola, .357, SMG, AR3, ballesta, escopeta, RPG, granadas, Gravity Gun, Ice Gun y Portal Gun | La Ice Gun reutiliza arte; falta arma montada de vehículo |
| Enemigos | Parcial alto | Zombie, headcrab, tres Combine, manhack, torreta, gunship y strider | Poca variedad para 65 mapas; faltan Hunter, Scanner, Dropship, Advisor y fauna ártica |
| Aliados | Parcial alto | Alyx usa CompanionSystem con follow/wait/escort; seis rebeldes y el medic usan PlayerSquad/follow | Escort scriptable hoy es de Alyx y nadie persiste entre mapas; faltan Mossman y personajes narrativos |
| Setpieces | Parcial | Entity I/O, sequences, mensajes, objetivos, doors, spawners y changelevel | Sin cámaras, timeline, control del jugador, animaciones authored ni branching persistente |
| Sigilo | Parcial alto | LOS, cono de visión, awareness, sospecha, oído y ruido del jugador | Sin alarmas compartidas, cámaras, sensores ni outputs de percepción para mappers |
| Puzzles | Parcial | Física, cajas, Gravity/Portal/Ice Gun, puertas, botones, timers y counters | Sin movers genéricos, ascensores, motores, cables, constraints o props animados |
| Ártico | Parcial | Terreno/material/pasos de nieve, viento y mapas `snow-field`/`snow-factory` | Sin fog, nevada, whiteout, frío, refugio, agua o hielo quebradizo |
| Campaña multi-mapa | Parcial | `nextLevel`, landmarks y continuidad de vida/loadout | Sin manifiesto de campaña, múltiples destinos, saves durables o estado global |
| Vehículos | Parcial alto | Buggy, hidrodeslizador, helicóptero on-rails, transporte oruga rebelde y deslizador Combine; conducción, hover sólido/agua, asientos, cámara, daño, HUD, audio, IA y persistencia entre mapas | Faltan cabrestante, carga, clima/refugio móvil, hielo quebradizo, reparaciones de oruga, haz tractor y los vehículos especiales del Borealis |
| Editor | Parcial | Paleta, inspector, I/O tipado, builders, undo/redo, export y playtest | Sin proyectos multi-mapa, props GLB, luces, FX, cámaras, layers o checkpoints editables |
| Realidades/tiempo | Bloqueado | Teleport y portales dentro de la misma escena | Sin world layers, snapshots, loops, doble física/nav o render de otra realidad |
| Presentación narrativa | Bloqueado | Subtítulos y cuatro gestos procedurales | Sin voces por línea, facial/lip-sync, clips corporales o Cinematic Director |

### Contenido existente que no necesita rehacerse

- El núcleo de Entity I/O es suficiente como dispatcher; debe ampliarse su
  catálogo, no reemplazarse.
- El sistema único de NPC, percepción, brain/schedules, navegación y combate es
  una base válida para variantes nuevas.
- El arsenal convencional ya cubre toda la campaña.
- La física Rapier, los portales, la Gravity Gun y la Ice Gun son una buena base
  para puzzles de Aperture y del Borealis.
- `snow-factory`, `building-test`, `setpiece-test` y `ai-test` sirven como mapas
  de prueba para producción, navegación, escort y batallas.

## Viabilidad por capítulo

| Capítulo | Estado actual | Qué puede hacerse ahora | Qué falta para la versión propuesta |
| --- | --- | --- | --- |
| 1 — Aftermath | Parcial | White Forest en blockout, Alyx, rebeldes, subtítulos, arsenal y secuencias simples | Eli, Kleiner, Magnusson, funeral, props de base, voces, crowd y actuación/cámara multi-actor |
| 2 — Northbound | Bloqueado | Paisajes y ataques de gunship desde tierra | Helicóptero, asientos, ruta aérea, pasajeros, arma montada, damage/crash y wreckage |
| 3 — Whiteout | Parcial | Nieve, viento, refugios geométricos, Alyx, patrullas y fauna actual | Ventisca, visibilidad, temperatura, calor/refugio, hielo quebradizo, agua fría y fauna ártica |
| 4 — Dead Coordinates | Parcial | Instalación, túneles, Combine y setpieces I/O | Weather stations, kit Combine ártico y aparición/materialización del Borealis |
| 5 — Vanishing Point | Parcial | Infiltración básica, sospecha, puertas y sabotaje abstracto | Red de alarmas I/O, cámaras/sensores, hacking, maquinaria y geometría que fasea |
| 6 — A Familiar Voice | Bloqueado | Sala, subtítulos y decisión local por OnDeath/trigger | BreenGrub, voz, captura, actuación, branching claro y consecuencias persistentes |
| 7 — False Allegiance | Bloqueado | Escape con Alyx, combate y laboratorios en blockout | Mossman, segunda compañera narrativa, escenas coordinadas y kit médico/Aperture |
| 8 — Resonance | Parcial | Spawners, counters y timers ya permiten oleadas authored; también hay aliados, gunship, strider, manhacks y torretas | Para escala AAA: Wave Director, refuerzos, synths, torres animadas, resonancia y materialización |
| 9 — Between Worlds | Bloqueado | Corredores, teleport, portales y combate Combine | Kit Borealis, world layers, sectores sólidos/incompletos y ventanas a otras realidades |
| 10 — Bootstrap | Bloqueado | Puzzles físicos con Gravity/Portal/Ice Gun | Bootstrap Device, red de energía, maquinaria y estados destruido/reparado por época |
| 11 — Seven Hours | Bloqueado | Solo un blockout narrado | Presente/pasado jugables, persistencia entre eras, dry dock, científicos y escena de invasión |
| 12 — Nightmare Funhouse | Bloqueado | Algunos trucos de teleport o salas duplicadas | Snapshot/rewind, loops deterministas, realidades simultáneas, clones y geometría no euclidiana |
| 13 — The Final Choice | Bloqueado | Timer, objetivo y autodestrucción abstracta | Mossman, confrontación authored, puente, branching y estado seguro de actores narrativos |
| 14 — Infinite Finality | Bloqueado | Mensajes, changelevel, créditos básicos y Gordon post-humano | G-Man, vortigaunts, time-stop, nexo/Dyson, rescate, epílogo, carta y final cinematográfico |

## Decisiones de alcance necesarias

Estas decisiones deben cerrarse antes de producir contenido final:

1. **65 mapas o campaña consolidada.** Sesenta y cinco mapas es una producción
   completa, no una expansión pequeña. Debe decidirse si se mantiene esa cifra
   o si varios mapas se consolidan en niveles de 15–30 minutos.
2. **Helicóptero on-rails o vehículo libre.** Para esta historia alcanza un
   vehículo on-rails con asiento y arma montada. Un helicóptero libre multiplica
   mucho el costo de física, IA, controles y diseño de niveles.
3. **Portal Gun e Ice Gun en canon.** Ya son sistemas fuertes; hay que decidir
   cómo se obtienen y qué capítulos las usan para que no parezcan herramientas
   de debug desconectadas del relato.
4. **Alcance de las decisiones.** Definir si Breen/Mossman solo alteran escenas
   locales o si cambian mapas posteriores y el final. El segundo caso obliga a
   CampaignState, saves y testing de ramas.
5. **Modelo temporal.** Elegir entre salas duplicadas conectadas por teleport
   —más barato pero limitado— o world layers verdaderas con física, IA y estado
   independiente. Los capítulos 11–12 requieren la segunda opción.
6. **Fuente de verdad de mapas.** Elegir proyecto JSON versionado o TypeScript
   generado conservando smart objects. No mantener dos fuentes divergentes.

## Gate técnico — Tres vertical slices antes de producir 65 mapas

Este gate no es una fase cronológicamente anterior a P0/P1/P3. Cada slice se
construye mediante el siguiente ciclo:

1. implementar el mínimo habilitante de la fase correspondiente;
2. validarlo dentro del slice;
3. corregir y endurecer el sistema según el playtest;
4. congelar su schema/contrato antes de multiplicar mapas.

El Slice A valida P0, el Slice B valida P1 y el Slice C valida el núcleo temporal
de P3. Ninguno puede aprobarse antes de implementar esos mínimos.

### Slice A — White Forest narrativo

Una escena de 8–10 minutos con Gordon, Alyx y al menos cuatro actores, entrada
libre del jugador, diálogo, funeral, preparación de equipo y salida.

Debe demostrar:

- timeline multi-actor y cámaras;
- voces/subtítulos sincronizados;
- look-at, gestos y animación authored;
- bloqueo parcial y devolución segura del control;
- skip que deja el mundo en su estado final correcto;
- autosave antes y después de la escena.

### Slice B — Helicóptero y Whiteout

Un vuelo corto on-rails, ataque, accidente y diez minutos de supervivencia en
una ventisca hasta un refugio.

Debe demostrar:

- asiento/attachment de Gordon y Alyx;
- ruta aérea, arma montada, daño y crash;
- whiteout legible, temperatura, calor/refugio y feedback HEV;
- transición de wreckage a exploración terrestre;
- IA y navegación funcionales bajo clima intenso.

### Slice C — Borealis dual-era

Una misma sala jugable en presente y pasado, con un puzzle cuya acción en una
era modifica la otra.

Debe demostrar:

- cambio atómico de render, collider, física, audio, luces y nav;
- NPCs y props con estado independiente por era;
- ventanas o portales que muestran otra realidad;
- save/load dentro de cualquiera de las dos eras;
- transición visual sin duplicación accidental de runtime, listeners o I/O.

Si cualquiera de estos slices no cumple su gate, se corrige el sistema antes de
autorizar producción masiva de mapas.

## P0 — Fundaciones de campaña

### P0.1 — CampaignDefinition, progresión y guardado

- Crear un `CampaignDefinition` versionado con actos, capítulos, mapas
  ordenados, mapa inicial, destinos, desbloqueos y final.
- Permitir que `changelevel` declare destino explícito y que un mapa tenga más
  de una salida.
- Crear un `LevelResolver` común para campaña oficial, biblioteca y Workshop.
- Implementar `CampaignState` con flags, variables, elecciones y objetivos.
- Implementar slots, autosave, continuar partida y migración de saves.
- Persistir jugador, Alyx/compañeros y NPCs narrativos entre mapas.
- Definir `SaveableEntity` para puertas, triggers, counters, timers, relays,
  pickups, objetivos, secuencias y props relevantes.
- Definir qué física se restaura y qué encuentros se reinician.

**Criterios de aceptación**

- Cerrar el navegador y continuar en el mismo mapa con el mismo estado.
- Una decisión de Breen sigue disponible varios mapas después.
- Morir tras un checkpoint no repite una escena ya completada.
- Alyx conserva estado, salud y equipamiento entre transiciones.
- Un save antiguo se migra o se rechaza con un mensaje controlado.

### P0.2 — Entity I/O de producción

- Reemplazar `ActionButtonDefinition` por un `func_button` I/O genérico.
- Añadir `logic_branch`, `logic_compare`, `logic_case`, `logic_random` y
  variables locales/globales persistentes.
- Exponer checkpoints, hazards, barriles, pickups y props como entidades I/O.
- Añadir puertas lock/unlock, puertas sin botón obligatorio y outputs de estado
  completo.
- Añadir inputs de jugador: habilitar controles, holster, give/strip weapon,
  teleport, fade y HUD.
- Añadir inputs de NPC: equipar, relaciones/facción, invulnerable,
  incapacitar/revivir, activar IA y goals.
- Añadir `func_movelinear`, `func_rotating`, elevator/path mover, breakable,
  animated prop y parenting/attachments.
- Añadir entidades `env_fade`, camera, shake, light, particle, beam, explosion,
  weather, music y sonido posicional.
- Serializar estado I/O y eventos retrasados en el savegame.
- Añadir trace/debugger gráfico con caller, activator, delays y refire count.

**Criterio de aceptación**

Un mapper puede construir una escena ramificada con maquinaria, diálogo, clima,
combate y salida sin añadir casos especiales a `Game.ts`.

### P0.3 — Cinematic Director y diálogo

- Timeline serializable con pistas para varios actores.
- Camera cuts, rails, blends, FOV, look-at y cámaras parentadas.
- Tracks de movimiento, clips corporales, gestos, facial, props y armas.
- Importar/reproducir/blendear clips GLTF en vez de ignorarlos globalmente.
- Control del jugador: lock parcial/total, holster, HUD, fade y teleport.
- Voz por `lineId` y personaje, cola de subtítulos, audio ducking y música.
- Facial/lip-sync o un sistema de visemas suficientemente convincente.
- Conversaciones ramificadas, elecciones silenciosas y timeouts.
- Localización por `lineId` y fallback controlado por idioma.
- Accesibilidad narrativa: tamaño/fondo de subtítulos, speaker/color, closed
  captions para sonidos importantes y controles remapeables para skip/choice.
- Skip, recovery por actor muerto/path failure y estado final determinista.

**Criterios de aceptación**

- El funeral sincroniza cuatro o más actores y puede saltarse.
- La escena BreenGrub soporta matar, rechazar o abandonar sin softlock.
- Guardar antes/durante/después de una escena no duplica audio ni bloquea input.

### P0.4 — Proyecto de campaña y editor escalable

- Añadir `schemaVersion` y migraciones incrementales a `EditorDocument`.
- Crear proyectos multi-mapa con referencias, actos y capítulos.
- Añadir checkpoints al editor, builder, codegen y round-trip.
- Añadir entidad genérica de modelo/prop GLB y asset browser.
- Añadir luces, decals, VFX, sonidos, cámaras, splines y weather volumes.
- Añadir multi-selección, grupos, layers, prefabs instanciables y búsqueda.
- Añadir editor visual de grafo I/O y timeline cinematográfico con scrub.
- Conservar specs paramétricas al importar edificios/mapas TypeScript.
- Mover biblioteca de mapas grandes de `localStorage` a IndexedDB.
- Usar autosave debounced y undo por comandos/diffs para mapas grandes.
- Crear templates de White Forest, Ártico, Combine, Aperture y Borealis.
- Añadir paquetes Workshop de campaña: manifiesto + mapas, versionado,
  dependencias, publicación/revisión atómica y resolución estable de IDs entre
  documentos. Workshop no debe seguir limitado a publicaciones `type: map`.

**Criterios de aceptación**

- Un proyecto de 65 mapas abre, guarda y reabre sin pérdida de datos.
- El round-trip `EditorDocument → LevelDefinition → EditorDocument` conserva
  equivalencia semántica y las specs de smart objects.
- Un mapa de 2000 entidades sigue siendo editable sin pausas largas de autosave.

### P0.5 — Validador, nav y automatización

- Crear `campaign:validate` para schema, assets, IDs, referencias, destinos,
  landmarks, mapas inalcanzables y ramas sin salida.
- Detectar conexiones muertas, ciclos delay-0 peligrosos y secuencias sin
  NPC/marker.
- Mantener paridad de validación con el backend de Workshop mediante schemas
  versionados, fixtures y contract tests; los repositorios no comparten imports.
- Hacer `nav:bake` incremental, con manifiesto y limpieza de artefactos viejos.
- Hornea documentos JSON además de mapas TypeScript.
- Validar reachability desde spawns hacia objetivos, sequences, escort y exits.
- Añadir smoke test y critical-path test por mapa.
- Añadir E2E de transición, muerte, save/load y skip de cinemática.
- Stress test de múltiples cargas/teardowns y migraciones de save/schema.

**Criterios de aceptación de la fundación**

- Una campaña fixture de tres mapas puede recorrerse automáticamente de inicio
  a final, incluyendo una rama y save/load.
- Todo mapa incorporado al repositorio tiene schema, I/O, nav, smoke y critical
  path verdes; el recorrido de los 65 mapas pertenece al gate final.
- Sesenta y cinco transiciones repetidas sobre el fixture no dejan NPCs,
  bodies, timers o listeners.

### P0.6 — Carga y baseline de rendimiento

- Lazy-load de definiciones; no importar los otros 64 mapas al iniciar uno.
- Precargar assets, audio, skybox y navmesh del siguiente mapa.
- Descargar assets exclusivos del mapa anterior cuando sea seguro.
- Corregir culling/bounds, usar instancing y batching para kits repetidos.
- Definir presupuestos por mapa: agentes, triángulos, draw calls, VFX, audio,
  memoria, navmesh y tiempo de carga.
- Automatizar mediciones de frame time, long tasks, carga y memoria sobre
  hardware objetivo documentado.

**Criterios de aceptación**

- El boot de un mapa no descarga definiciones ni assets exclusivos de los otros
  64 mapas.
- Carga fría, carga precalentada y transición cumplen presupuestos registrados
  en CI/perf smoke; ningún stall excede el límite acordado del main thread.
- Tras diez transiciones, heap, bodies, listeners y audio quedan dentro de un
  10% del baseline posterior a la primera carga y no crecen monótonamente.
- El mapa representativo P0 cumple el target de frame P95 fijado para el
  hardware de referencia.

## P1 — Acto I: White Forest y Ártico

### P1.1 — Helicóptero acotado

- Vehículo on-rails con spline/path.
- Seats/attachments para Gordon, Alyx y equipo.
- Cámara jugable desde asiento y arma montada opcional.
- Damage zones, humo/fuego, fail state y secuencia de crash.
- Inputs/outputs I/O: Start, Stop, SetSpeed, Attach, Detach, Crash,
  OnWaypoint, OnDamaged y OnCrashed.
- Modelo del helicóptero, interior, rotor, armas y piezas de wreckage.

Un vehículo aéreo completamente libre queda fuera de alcance hasta que el
on-rails esté probado y la campaña realmente lo necesite.

### P1.2 — Flota ártica y vehículos adicionales

Los vehículos nuevos amplían el parque existente: no reemplazan el buggy, el
hidrodeslizador ni el helicóptero. La campaña necesita variedad visual y de
ritmo, pero cada vehículo conducible debe justificar un verbo de juego propio.

| Vehículo | Equivalente en HL2 | Función | Alcance |
| --- | --- | --- | --- |
| Transporte oruga rebelde | Buggy | Exploración, supervivencia, transporte y físicas | Vehículo principal durante Whiteout y los capítulos siguientes |
| Deslizador Combine de reconocimiento | Airboat | Velocidad, derrape, persecución y combate | Uno o dos capítulos después de perder el transporte rebelde |
| Remolcador de carga de Aperture | Vehículo secundario | Puzzles temporales y movimiento de carga dentro del Borealis | Setpiece de 15–25 minutos |
| Helicóptero rebelde | Secuencia introductoria | Viaje inicial, arma de puerta y accidente | On-rails; no sustituye a los vehículos terrestres |

#### Transporte oruga rebelde

Mezcla de snowcat, transporte militar y maquinaria industrial recuperada por
la Resistencia. Tiene orugas anchas, cabina parcialmente cerrada para Gordon y
Alyx, motor expuesto, cabrestante frontal y una pequeña plataforma de carga.
Aparece abandonado junto al refugio de `snow-field`, inmediatamente después del
accidente del helicóptero, y también queda disponible en `vehicle-sandbox`.

**Base conducible implementada**

- Modelo procedural original con tres LOD, materiales PBR, orugas, rodillos,
  cabina, dos plazas, motor, carga y cabrestante visual.
- Preset propio con chasis pesado, suspensión, tracción terrestre, cámara,
  luces, daño por componentes, HUD, audio y persistencia.
- Puestos de conductor y pasajero; Alyx puede ocupar la segunda plaza mediante
  el sistema de tripulación existente.
- Sin arma montada en esta etapa. Se conduce, frena, retrocede y puede recorrer
  pendientes con el mismo contrato de input que el resto del parque.

**Mecánicas posteriores**

- Atravesar nieve profunda y pendientes que Gordon no cruza a pie.
- Romper barricadas, paredes débiles y acumulaciones de hielo.
- Cabrestante para arrastrar objetos, abrir puertas, recuperar vehículos o
  improvisar un puente.
- Plataforma funcional para baterías, explosivos y equipamiento.
- Refugio móvil durante tormentas y coordinación con Alyx desde el asiento de
  pasajero.
- Daño y reparación de oruga, combustible/batería y defensa del vehículo
  mientras Alyx lo repara.
- Cruces de hielo quebradizo y mejora tardía opcional con torreta improvisada o
  cañón Combine recuperado.

Debe sostener entre 60 y 90 minutos acumulados durante dos o tres capítulos. Se
pierde o destruye cerca de las coordenadas del Borealis para que no acompañe al
jugador durante toda la campaña.

#### Deslizador Combine de reconocimiento

Vehículo antigravitatorio robado durante *Dead Coordinates* o *Vanishing
Point*: combina un hunter pequeño, una moto de nieve, una cápsula Combine
abierta y el motor de un APC. Cruza nieve, hielo, agua y terreno irregular.

**Base conducible implementada**

- Modelo procedural original con tres LOD, materiales PBR, cápsula abierta,
  núcleo Combine y tres estabilizadores antigravitatorios.
- Motor hover híbrido que mantiene altura sobre colisión sólida y agua, con
  empuje, reversa, frenado, guiñada y derrape.
- Cabina para Gordon, cámara, luces, daño por componentes, HUD, audio propio y
  persistencia. Disponible desarmado en `vehicle-sandbox`.

**Mecánicas posteriores**

- Alta velocidad, derrapes controlados, saltos, impulso breve y recarga al
  pasar por nodos de energía Combine.
- Inicialmente desarmado; luego admite un cañón de pulsos recuperado.
- Haz tractor corto para mover placas de hielo, minas y obstáculos, activar
  mecanismos, lanzar objetos o remolcar un módulo.
- Persecución sobre un lago congelado con hunters, dropships, minas y sectores
  de la instalación que aparecen durante la materialización del Borealis.

Su tramo ideal dura 40–60 minutos y termina al abordar el Borealis.

#### Remolcador de carga de Aperture Science

Máquina eléctrica de interior que combina montacargas, tractor de aeropuerto y
robot de mantenimiento. Lleva brazo hidráulico, plataforma, imán y anclaje al
suelo, con el acabado blanco y negro de Aperture degradado por décadas.

Su ancla temporal estabiliza durante unos segundos una versión de los objetos
que alternan entre presente, pasado y futuro. Permite transportar un reactor
entre épocas, sujetar contenedores que aparecen y desaparecen, crear cobertura,
embestir en pasillos o impedir que una sección se desmaterialice. Aparece sólo
en una parte de *Bootstrap* o *Seven Hours* y una anomalía lo destruye.

#### Vehículos ambientales no conducibles

- Transportes blindados y snowcats destruidos de la Resistencia.
- Dropships adaptados al clima y APC Combine de orugas o antigravedad.
- Drones meteorológicos.
- Grúas y plataformas móviles del Borealis.
- Botes salvavidas de Aperture atrapados entre épocas.

Una moto de nieve convencional queda reservada, como máximo, para una
persecución corta: ofrece menos posibilidades para Alyx, las físicas y los
puzzles. El helicóptero libre sigue fuera de alcance porque exigiría niveles y
combate aéreo de una escala distinta.

### P1.3 — Arctic Environment

- Weather volumes con nevada, ventisca, fog y control de visibilidad.
- Viento visual, sonoro y opcionalmente físico.
- Temperatura/exposición, protección HEV, refugio y fuentes de calor.
- HUD/feedback/audio del frío sin convertir el capítulo en una barra tediosa.
- Hielo resbaloso, hielo quebradizo, agua fría, caída y rescate.
- Terreno multi-material/splatmap y nieve acumulada o decals.
- Footprints/trails como mejora de orientación y storytelling.
- Skyboxes/HDRI árticos, amanecer, tormenta y noche.

### P1.4 — Contenido del Acto I

- Eli —incluido cuerpo para el funeral—, Kleiner y Magnusson.
- Pilotos, técnicos y líderes de Resistencia diferenciados.
- Kit modular de White Forest, hangar, laboratorio, memorial y radio.
- Kit ártico: refugios, estaciones meteorológicas, túneles, antenas,
  campamentos científicos y restos de expedición.
- Kit Combine ártico: barricadas, torres, sensores, energía y fortificación.
- Helicóptero, wreckage y props de supervivencia.
- Variantes de camuflaje ártico de Combine/zombie/headcrab.
- Al menos dos criaturas Xen/árticas nuevas si los playtests muestran fatiga.

## P2 — Acto II: instalación Combine

### P2.1 — Sigilo y alarmas

- Outputs NPC `OnSuspicious`, `OnSpotted`, `OnLostTarget` y `OnAlerted`.
- Red de alarma por grupos/zonas con estados normal, búsqueda y combate.
- Cámaras, sensores, terminales, alarmas, forcefields y refuerzos I/O.
- Feedback legible de detección y objetivos opcionales de no ser visto.
- Influencia de oscuridad, fog y clima sobre detección cuando corresponda.

### P2.2 — Maquinaria, sabotaje y resonancia

- Power network authorable con fuentes, cables, breakers y consumers.
- Movers, lentes, torres, rotores, beams y props animados.
- Hacking/repair interaction con inputs/outputs y posibilidad de interrupción.
- Materialización/desmaterialización gradual de props y habitaciones.
- VFX/shaders de distorsión, resonancia y Bootstrap.

### P2.3 — Encounter/Wave Director

- Encuentros con fases, spawn groups, caps, alive count y pacing.
- Activation volumes, pooling/despawn y dificultad escalable.
- Refuerzos aliados, entradas por Dropship y objetivos defensivos.
- Fail/retry desde checkpoint sin duplicar actores ni outputs.
- AI LOD real, tick budgets, sleep y simulación lejana.
- Stress tests con weather, aliados, synths y VFX activos.

### P2.4 — Personajes y contenido del Acto II

- Mossman como NPC narrativa y segunda compañera persistente.
- BreenGrub con modelo, host biológico, animación y voz.
- Científicos/prisioneros y guards especiales.
- Scanner, Dropship, Hunter y una presencia Advisor/synth equivalente.
- Pase de arte/modelos authored para manhack, torreta, gunship y strider, hoy
  funcionales pero visualmente procedurales.
- Kit de interrogación, medical, celdas, laboratorios y tecnología capturada.
- Torres/lentes de resonancia y centro de observación.
- Diálogos y música propios de Alyx, Mossman y Breen.
- Reglas para actores esenciales: invulnerable, incapacitado, revive o fail
  controlado; nunca muerte accidental que softlockee el mapa.

## P3 — Acto III: Borealis y tecnología temporal

### P3.1 — RealityLayerSystem

- Definir varias layers/eras dentro de un mapa.
- Activar/desactivar atómicamente render, collider, physics, nav, AI, luces,
  audio e I/O de cada layer.
- Estado independiente y serializable por era.
- Transferencia segura del jugador, NPCs y props entre layers.
- Entidades I/O `world_layer`, `temporal_anchor` y `reality_portal`.
- Preview y edición de layers en el editor.

### P3.2 — Rendering de realidades

- Portales/ventanas capaces de renderizar otra layer o escena, no solo otra
  cámara del mismo mundo.
- Presupuestos de recursión, resolución y visibilidad.
- Ghost geometry y secciones incompletas con colisión coherente.
- Transiciones de fase, freeze temporal, afterimages y distorsión espacial.

### P3.3 — Bootstrap, causalidad y loops

- Harmonic points que estabilizan sectores.
- Estado destruido/reparado y power routing entre eras.
- Snapshots parciales y reset determinista de un sector.
- Loops que preservan flags seleccionados y restauran el resto.
- TimeController: pause/freeze selectivo sin detener cámara, UI o escena.
- Repetición de combate sin duplicar drops, listeners o I/O pendiente.

### P3.4 — Contenido del Borealis

- Kit modular de casco, cubiertas, camarotes, carga, ingeniería y puente.
- Versiones intacta, congelada, dañada, incompleta y temporal de cada módulo.
- Bootstrap Device y maquinaria Aperture.
- Kit Aperture/dry dock con científicos, trabajadores y equipos de época.
- Océano/ventanas, hielo exterior y paisajes alienígenas.
- Props de storytelling, signage, decals y documentos.
- Música, alarmas, hull stress, anomalías y soundscapes temporales.

## P4 — Final, epílogo y contenido cósmico

- Mossman final y resolución persistente de su destino.
- Autodestrucción y trayectoria del Borealis como setpiece controlado.
- G-Man con modelo, voz, animación y escena fuera del tiempo.
- Vortigaunts con modelo, animación, voz y efecto de rescate.
- Nexo Combine, flota, defensas y esfera de Dyson.
- Time-stop selectivo y extracción de Alyx sin romper el estado del jugador.
- Epílogo en una Tierra futura con variante de Gordon post-humano; el modelo ya
  existe, pero mostrar el cuerpo fuera de portales requiere soporte cinematográfico.
- Sistema de carta/narración final, créditos de campaña y chapter select.
- Save final, New Game+, estadísticas o retorno seguro al menú.

## Backlog maestro de contenido

### Armas

No falta ninguna arma convencional obligatoria. El arsenal actual ya tiene más
variedad que la necesaria para esta historia.

Obligatorio:

- arma montada del helicóptero;
- arte propio de la Ice Gun si queda integrada en la campaña.

Opcional, solo si sirve al diseño:

- flare/señal luminosa para Whiteout;
- herramienta Bootstrap/Aperture si Gravity, Portal e Ice Gun no comunican bien
  los puzzles de reparación.

### Personajes obligatorios

- Eli, Kleiner, Magnusson y cuerpo de Eli.
- Mossman.
- BreenGrub.
- G-Man.
- Vortigaunts.
- Pilotos/técnicos de Resistencia.
- Científicos y trabajadores Aperture.

### Enemigos/variedad recomendada

- Scanner y Dropship.
- Hunter.
- Advisor o synth equivalente para presencia de alto rango.
- Dos criaturas Xen/árticas.
- Variantes visuales árticas y temporales de enemigos existentes.

### Kits ambientales obligatorios

- White Forest/funeral.
- Helicóptero y wreckage.
- Ártico científico/militar.
- Instalación Combine y resonancia.
- Interrogación/medical.
- Aperture/dry dock.
- Borealis modular en varias eras.
- Nexo Combine/Dyson.
- Tierra futura/epílogo.

### Audio y animación

- Voz por personaje y línea.
- Música por acto y clímax.
- Foley de helicóptero, tormenta, casco, maquinaria y anomalías.
- Clips corporales authored, facial, visemas y props de actuación.
- Variantes de dolor, combate y muerte para NPCs nuevos.

## Plan de producción de mapas

La distribución propuesta es:

- Acto I: 16 mapas.
- Acto II: 19 mapas.
- Acto III/final: 30 mapas.
- Total: 65 mapas.

Orden recomendado:

1. Implementar el mínimo P0 que habilita el Slice A y validarlo.
2. Implementar los mínimos P1/P3 necesarios para los Slices B/C y validarlos.
3. Endurecer lo aprendido y congelar schemas de campaña, mapa, save e I/O.
4. Producir un mapa representativo final por capítulo.
5. Validar ritmo y duración de los 14 mapas representativos.
6. Recién entonces expandir cada capítulo hasta la cantidad definitiva.
7. Hacer un pase completo de variedad para evitar 65 mapas con los mismos
   enemigos, pasillos y puzzles.

### Definition of Done por mapa

- Entrada, salida, landmarks y objetivos válidos.
- Al menos un checkpoint authored y probado.
- Todo I/O resuelve targets/inputs y no tiene ciclos peligrosos.
- Critical path recorrible por jugador y compañeros.
- Navmesh verde para cada perfil que el mapa utiliza.
- Setpieces recuperables ante muerte, skip o actor faltante.
- Save/load conserva exactamente el estado definido.
- Audio, soundscape, clima, luces y VFX terminados.
- Sin softlocks, spawn inválido ni actores esenciales muertos accidentalmente.
- Cumple presupuestos de frame, memoria, agentes, draw calls y carga en el
  hardware objetivo.
- Teardown sin bodies, timers, audio, listeners o entidades huérfanas.
- Smoke test, test de grafo y critical-path automatizados.

## Estado de salida esperado

Esta iniciativa se considera completa cuando:

- los 14 capítulos tienen al menos un mapa final-quality;
- los 65 mapas están conectados por un manifiesto versionado;
- la campaña puede guardarse, cerrarse y continuarse;
- todas las decisiones y actores narrativos persisten correctamente;
- el funeral, Whiteout, Resonance, Seven Hours y el final tienen vertical slices
  aprobados antes de multiplicar contenido;
- CI puede validar y recorrer la campaña completa;
- la experiencia final no depende de lógica hardcodeada por mapa dentro de
  `Game.ts`.

## Riesgo de publicación

El uso público de nombres, personajes, sonidos, estética y material derivado de
Half-Life/Epistle 3 requiere una revisión específica de licencias y derechos
antes de distribuir la campaña. No es un bloqueo técnico del prototipo, pero sí
un gate independiente de lanzamiento, incluso si el proyecto sigue siendo fan
y no comercial.
