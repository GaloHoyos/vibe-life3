/**
 * Contrato HTTP del Workshop desde la optica del cliente. El backend remoto
 * (hoy un Cloudflare Worker) define su propia copia de estos tipos: ambos lados
 * son deployables independientes que solo se hablan por JSON, sin compartir codigo.
 */

/** Tipo de contenido publicable. Fase 1 solo emite `"map"`. */
export type WorkshopContentType = "map";

/** Metadatos de un item del Workshop tal como los lista el catalogo remoto. */
export interface WorkshopListing {
  /** Id estable asignado por el backend (clave de descarga/suscripcion). */
  id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  /** Hash/version del contenido; permite detectar actualizaciones. */
  revision: string;
  updatedAt: string;
  downloads: number;
  rating: number;
  tags: string[];
  type: WorkshopContentType;
}

export type WorkshopSort = "recent" | "popular" | "rating";

export interface WorkshopQuery {
  search?: string;
  tag?: string;
  sort?: WorkshopSort;
  page?: number;
}

/** Datos que acompañan una publicacion (los provee el autor al subir). */
export interface PublishMeta {
  title: string;
  description: string;
  tags: string[];
  type: WorkshopContentType;
}

export interface WorkshopUser {
  id: string;
  name: string;
}
