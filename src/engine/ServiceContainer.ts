/**
 * Token tipado que identifica un servicio en el {@link ServiceContainer}.
 *
 * El parámetro genérico `TService` no existe en runtime; sólo sirve para
 * que `register`/`resolve` infieran el tipo del servicio asociado.
 *
 * @example
 * ```ts
 * export const RendererToken = new ServiceToken<Renderer>("Renderer");
 * container.register(RendererToken, new Renderer(root));
 * const renderer = container.resolve(RendererToken); // tipado como Renderer
 * ```
 */
export class ServiceToken<TService> {
  /** Marcador fantasma para preservar el tipo `TService` en la firma. */
  readonly _phantom?: TService;

  constructor(readonly name: string) {}
}

/**
 * Contenedor de servicios ligero (Service Locator tipado).
 *
 * No instancia servicios por sí mismo: acepta instancias ya construidas.
 * Esto evita convertir el motor en un framework de DI completo a la vez
 * que desacopla quien produce un servicio de quien lo consume.
 *
 * Pensado para que el `Engine` registre los subsistemas del núcleo y
 * que la capa de juego (`Game`) los resuelva al cargar contenido,
 * sin que el Engine conozca los consumidores concretos.
 */
export class ServiceContainer {
  private readonly services = new Map<ServiceToken<unknown>, unknown>();

  /**
   * Registra una instancia bajo el token dado.
   *
   * @throws si ya existe un servicio para el token.
   */
  register<TService>(
    token: ServiceToken<TService>,
    instance: TService,
  ): TService {
    const key = token as ServiceToken<unknown>;
    if (this.services.has(key)) {
      throw new Error(`Servicio ya registrado: ${token.name}`);
    }
    this.services.set(key, instance);
    return instance;
  }

  /**
   * Recupera una instancia previamente registrada.
   *
   * @throws si el token no está registrado.
   */
  resolve<TService>(token: ServiceToken<TService>): TService {
    const value = this.services.get(token as ServiceToken<unknown>);
    if (value === undefined) {
      throw new Error(`Servicio no registrado: ${token.name}`);
    }
    return value as TService;
  }

  /** `true` si hay una instancia para el token. */
  has<TService>(token: ServiceToken<TService>): boolean {
    return this.services.has(token as ServiceToken<unknown>);
  }

  /** Limpia el contenedor. Útil en `Engine.dispose()`. */
  clear(): void {
    this.services.clear();
  }
}
