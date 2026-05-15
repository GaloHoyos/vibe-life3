/**
 * Almacenamiento clave/valor genérico para datos cargados en runtime
 * (niveles, configs JSON, etc.). No tipa la naturaleza del recurso: el
 * llamador especifica `TResource` al recuperar.
 */
export class ResourceManager {
  private readonly resources = new Map<string, unknown>();

  register<TResource>(key: string, resource: TResource): void {
    this.resources.set(key, resource);
  }

  get<TResource>(key: string): TResource {
    const resource = this.resources.get(key);

    if (!resource) {
      throw new Error(`Recurso no registrado: ${key}`);
    }

    return resource as TResource;
  }

  has(key: string): boolean {
    return this.resources.has(key);
  }

  async loadJson<TData>(key: string, url: string): Promise<TData> {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`No se pudo cargar JSON ${url}: ${response.status}`);
    }

    const data = (await response.json()) as TData;
    this.register(key, data);
    return data;
  }
}
