export interface BlobPreyClaim {
  readonly preyId: string;
  readonly ownerId: string;
  readonly claimedAt: number;
}

/**
 * Autoridad mínima de ownership para digestión. Un cadáver nunca puede estar
 * envuelto por dos organismos ni conceder biomasa dos veces.
 */
export class BlobPreyClaimService {
  private readonly claims = new Map<string, BlobPreyClaim>();
  private readonly consumed = new Set<string>();

  claim(preyId: string, ownerId: string, now: number): boolean {
    if (!preyId || !ownerId || this.consumed.has(preyId)) return false;
    const current = this.claims.get(preyId);
    if (current) return current.ownerId === ownerId;
    this.claims.set(preyId, Object.freeze({ preyId, ownerId, claimedAt: now }));
    return true;
  }

  isOwnedBy(preyId: string, ownerId: string): boolean {
    return this.claims.get(preyId)?.ownerId === ownerId;
  }

  release(preyId: string, ownerId: string): boolean {
    if (!this.isOwnedBy(preyId, ownerId)) return false;
    return this.claims.delete(preyId);
  }

  complete(preyId: string, ownerId: string): boolean {
    if (!this.isOwnedBy(preyId, ownerId) || this.consumed.has(preyId)) return false;
    this.claims.delete(preyId);
    this.consumed.add(preyId);
    return true;
  }

  releaseOwner(ownerId: string): void {
    for (const [preyId, claim] of this.claims) {
      if (claim.ownerId === ownerId) this.claims.delete(preyId);
    }
  }

  get(preyId: string): BlobPreyClaim | null {
    return this.claims.get(preyId) ?? null;
  }

  /** Sólo para teardown/tests; los ids vuelven a ser válidos en el siguiente nivel. */
  reset(): void {
    this.claims.clear();
    this.consumed.clear();
  }
}

export const blobPreyClaims = new BlobPreyClaimService();
