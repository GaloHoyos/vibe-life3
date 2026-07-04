/**
 * Tuning data-driven de la portal gun y sus portales.
 * Slot "a" = portal azul (LMB), slot "b" = portal naranja (RMB).
 */
export const PortalConfig = {
  ellipse: {
    // Forma del óvalo de Valve (aspect 108:64 ≈ 1.69) dimensionada al jugador
    // ya normalizado (1.80 m alto × 0.70 m ancho): óvalo 2.20 × 1.30 m. Se entra
    // parado con headroom, sin quedar desproporcionadamente alto.
    halfWidth: 0.65,
    halfHeight: 1.1,
  },
  placement: {
    range: 60,
    /** Lift over the surface for fit probes; toi must land near it. */
    probeLift: 0.1,
    probeMaxDistance: 0.2,
    probeToiMin: 0.08,
    probeToiMax: 0.12,
    /** Min alignment (dot) between probe hit normal and portal normal. */
    normalAlignMin: 0.99,
    /** Below this |normal.y| the surface counts as wall (up = world up). */
    wallNormalYMax: 0.75,
    /** Paso radial (m) de la búsqueda de bump al colocar el portal. */
    bumpStep: 0.12,
    /** Muestras angulares por anillo de la búsqueda de bump. */
    bumpAngularSamples: 12,
  },
  traversal: {
    /** Per-entity seconds before the same body can teleport again. */
    cooldownSeconds: 0.15,
    /**
     * The player teleports when crossing the EXACT portal plane (offset 0,
     * like Portal/Lague): a point crossed just behind the entry plane maps to
     * just IN FRONT of the exit plane, so the player never lands buried in
     * the exit wall. The near-plane "blink" that this offset used to hide is
     * now covered by the extruded surface plug (`surfacePlugDepth`).
     */
    playerTriggerOffset: 0,
    /**
     * Same idea for dynamic bodies, but larger: they have no collision
     * filter against the backing wall, so they must teleport BEFORE the
     * solver resolves the contact (or they bounce off and never cross).
     */
    dynamicTriggerOffset: 0.25,
    /**
     * Min exit speed along the exit normal. For the player it only applies to
     * VERTICAL exits (floor/ceiling, where falling back behind the plane
     * drops you out of the world); wall exits keep the incoming speed intact
     * so slow walk-throughs stay fluid. Dynamics/NPCs use it on every exit.
     */
    minExitSpeed: 1.5,
    /** Distance to a linked portal that enables wall pass-through filtering. */
    passThroughProximity: 1.5,
    /** Ellipse margin factor for the crossing test. */
    crossingMargin: 1.15,
    /** Radius of the ball query that collects dynamic-body candidates. */
    dynamicQueryRadius: 2,
    /** Push-out along the exit normal for teleported dynamic bodies. */
    dynamicExitClearance: 0.35,
    /**
     * Salida por pared: si el mapeo exacto deja los pies del jugador embebidos
     * en el piso (entrar por un portal elevado desde abajo mapea la cápsula por
     * debajo del centro del portal de salida), se lo sube a apoyar los pies. Se
     * busca piso hasta esta distancia bajo los pies mapeados; más allá, la
     * salida se considera aérea (caída legítima) y no se ajusta.
     */
    exitGroundSnap: 0.5,
  },
  view: {
    renderScale: 1,
    maxViewDistance: 45,
    /**
     * Profundidad (m) del "tapón" extruido dentro de la pared detrás del
     * disco. Debe superar la distancia de la cámara a la esquina de su near
     * plane (near 0.05, fov <= 90 → ~0.115): cuando el near plane rebana el
     * disco y la pared al cruzar, el interior del tapón sigue cubriendo la
     * vista. En paredes más finas que esto la tapa trasera asoma del otro lado.
     */
    surfacePlugDepth: 0.13,
  },
  colors: {
    a: 0x3fa7ff,
    b: 0xff9a3f,
  },
  /**
   * Traversal de props estilo Portal: en vez de teleportar el cuerpo entero
   * cuando su centro cruza, el portal tiene un AGUJERO físico real (parche con
   * óvalo recortado) y el objeto se representa a la vez de los dos lados (clon
   * espejado) para volcarse sobre el borde y caer. Ver `PortalTravellerSystem`.
   */
  dynamicClone: {
    /** Si está OFF, se usa el teleport por cruce del centro (comportamiento viejo). */
    enabled: true,
    /** Radio (m) del parche de apertura coplanar con la superficie del portal. */
    apertureRadius: 2.2,
    /** Espesor (m) del parche hundido en la superficie (borde de pivoteo). */
    apertureThickness: 0.1,
    /** Distancia del centro del prop al portal para entrar en la zona de traversal. */
    proximity: 2.2,
    /** Peso del blend de posición del clon hacia el primary al reconciliar. */
    blendPosition: 0.5,
    /** Peso del blend de rotación (slerp) del clon hacia el primary. */
    blendRotation: 0.5,
  },
  npcTraversal: {
    enabled: true,
    /** Costo A* del edge warp (equivalente en metros de caminata). */
    warpEdgeCost: 2,
    /** El waypoint de cruce queda esta distancia DETRÁS del plano del disco. */
    crossingDepth: 0.55,
    /** Máxima altura del borde inferior del disco sobre el piso para que un
     * NPC terrestre pueda entrar caminando por un portal de pared. */
    maxEntryLipHeight: 0.7,
  },
} as const;
