export type NPCState =
  | "idle"
  | "alert"
  | "chase"
  | "attack"
  | "stagger"
  | "fallen"
  | "recovering"
  | "dead";

export type NPCBalanceState =
  | "balanced"
  | "stumbling"
  | "fallen"
  | "recovering"
  | "dead";
