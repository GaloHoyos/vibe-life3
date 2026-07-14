import { describe, expect, it } from "vitest";
import { BlobPreyClaimService } from "@game/npc/blob/BlobPreyClaimService";

describe("BlobPreyClaimService", () => {
  it("permite un solo owner y completar una única vez", () => {
    const claims = new BlobPreyClaimService();
    expect(claims.claim("prey", "blob-a", 1)).toBe(true);
    expect(claims.claim("prey", "blob-b", 1.1)).toBe(false);
    expect(claims.complete("prey", "blob-b")).toBe(false);
    expect(claims.complete("prey", "blob-a")).toBe(true);
    expect(claims.complete("prey", "blob-a")).toBe(false);
    expect(claims.claim("prey", "blob-b", 2)).toBe(false);
  });

  it("libera todos los claims del Blob al morir o ser dispuesto", () => {
    const claims = new BlobPreyClaimService();
    claims.claim("a", "blob", 0);
    claims.claim("b", "blob", 0);
    claims.claim("c", "other", 0);
    claims.releaseOwner("blob");
    expect(claims.get("a")).toBeNull();
    expect(claims.get("b")).toBeNull();
    expect(claims.get("c")?.ownerId).toBe("other");
  });
});
