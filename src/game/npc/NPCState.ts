export type NpcAiState =
  | "idle"
  | "alert"
  | "chase"
  | "attack"
  | "dead";

export type NpcBalanceState =
  | "balanced"
  | "stumbling"
  | "fallen"
  | "recovering"
  | "dead";
