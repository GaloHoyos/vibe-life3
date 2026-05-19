export type ZombieAiState =
  | "idle"
  | "alert"
  | "chase"
  | "attack"
  | "dead";

export type ZombieBalanceState =
  | "balanced"
  | "stumbling"
  | "fallen"
  | "recovering"
  | "dead";
