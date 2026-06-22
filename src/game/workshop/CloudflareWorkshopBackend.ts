import type { WorkshopBackend, WorkshopCapabilities } from "./WorkshopBackend";
import type {
  PublishMeta,
  WorkshopListing,
  WorkshopQuery,
  WorkshopUser,
} from "./WorkshopTypes";

interface WorkshopSession {
  token: string;
  user: WorkshopUser;
}

const SESSION_KEY = "vibe.workshop.session";
const AUTH_MESSAGE_TYPE = "vibe-workshop-auth";

/**
 * Implementacion del Workshop contra el Cloudflare Worker (Fase 1). Habla solo
 * por HTTP con `VITE_WORKSHOP_API`; si esa env no esta definida, el backend
 * queda sin capacidades y la UI muestra "Workshop no disponible" (el juego
 * sigue andando offline).
 */
export class CloudflareWorkshopBackend implements WorkshopBackend {
  readonly id = "cloudflare";
  readonly capabilities: WorkshopCapabilities;

  private readonly base: string | undefined;
  private session: WorkshopSession | null;

  constructor() {
    this.base = import.meta.env.VITE_WORKSHOP_API;
    this.capabilities = { publish: this.base !== undefined, auth: this.base !== undefined };
    this.session = loadSession();
  }

  async list(query?: WorkshopQuery): Promise<WorkshopListing[]> {
    const params = new URLSearchParams();
    if (query?.search) params.set("search", query.search);
    if (query?.tag) params.set("tag", query.tag);
    if (query?.sort) params.set("sort", query.sort);
    if (query?.page !== undefined) params.set("page", String(query.page));
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const body = await this.requestJson(`/api/maps${suffix}`);
    if (!Array.isArray(body)) return [];
    return body.map(toListing).filter((l): l is WorkshopListing => l !== null);
  }

  async fetchDocument(id: string, revision?: string): Promise<unknown> {
    const suffix = revision ? `?rev=${encodeURIComponent(revision)}` : "";
    return this.requestJson(`/api/maps/${encodeURIComponent(id)}/document${suffix}`);
  }

  async publish(document: unknown, meta: PublishMeta): Promise<WorkshopListing> {
    const body = await this.requestJson("/api/maps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta, document }),
    });
    const listing = toListing(body);
    if (!listing) {
      throw new Error("El servidor devolvio una respuesta de publicacion invalida.");
    }
    return listing;
  }

  signIn(): Promise<WorkshopUser> {
    const base = this.requireBase();
    const origin = new URL(base).origin;
    return new Promise<WorkshopUser>((resolve, reject) => {
      const popup = window.open(`${base}/auth/github`, "vibe-workshop-auth", "width=600,height=720");
      if (!popup) {
        reject(new Error("No se pudo abrir la ventana de inicio de sesion (popup bloqueado)."));
        return;
      }
      const onMessage = (event: MessageEvent): void => {
        if (event.origin !== origin) return;
        const session = parseSession(event.data);
        if (!session) return;
        cleanup();
        this.setSession(session);
        resolve(session.user);
      };
      const poll = window.setInterval(() => {
        if (popup.closed) {
          cleanup();
          reject(new Error("Inicio de sesion cancelado."));
        }
      }, 500);
      const cleanup = (): void => {
        window.clearInterval(poll);
        window.removeEventListener("message", onMessage);
      };
      window.addEventListener("message", onMessage);
    });
  }

  signOut(): void {
    this.session = null;
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // best-effort
    }
  }

  currentUser(): WorkshopUser | null {
    return this.session?.user ?? null;
  }

  private requireBase(): string {
    if (this.base === undefined) {
      throw new Error("Workshop no configurado (falta VITE_WORKSHOP_API).");
    }
    return this.base;
  }

  private setSession(session: WorkshopSession): void {
    this.session = session;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // best-effort
    }
  }

  private async requestJson(path: string, init?: RequestInit): Promise<unknown> {
    const base = this.requireBase();
    const headers = new Headers(init?.headers);
    if (this.session) headers.set("Authorization", `Bearer ${this.session.token}`);
    const response = await fetch(`${base}${path}`, { ...init, headers });
    if (!response.ok) {
      if (response.status === 401) this.signOut();
      throw new Error(await errorMessage(response));
    }
    return response.json() as Promise<unknown>;
  }
}

function loadSession(): WorkshopSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return parseSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

function parseSession(value: unknown): WorkshopSession | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.type !== undefined && v.type !== AUTH_MESSAGE_TYPE) return null;
  if (typeof v.token !== "string") return null;
  const user = v.user;
  if (!user || typeof user !== "object") return null;
  const u = user as Record<string, unknown>;
  if (typeof u.id !== "string" || typeof u.name !== "string") return null;
  return { token: v.token, user: { id: u.id, name: u.name } };
}

function toListing(value: unknown): WorkshopListing | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || typeof v.title !== "string") return null;
  return {
    id: v.id,
    slug: typeof v.slug === "string" ? v.slug : v.id,
    title: v.title,
    description: typeof v.description === "string" ? v.description : "",
    author: typeof v.author === "string" ? v.author : "anonimo",
    revision: typeof v.revision === "string" ? v.revision : "",
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : "",
    downloads: typeof v.downloads === "number" ? v.downloads : 0,
    rating: typeof v.rating === "number" ? v.rating : 0,
    tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === "string") : [],
    type: "map",
  };
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      const message = (body as Record<string, unknown>).error;
      if (typeof message === "string") return message;
    }
  } catch {
    // sin cuerpo JSON
  }
  return `Error del Workshop (${response.status}).`;
}
