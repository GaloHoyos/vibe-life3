export type ZombieAiState =
  | "idle"
  | "alert"
  | "chase"
  | "investigate"
  | "attack"
  | "dead";

export type ZombieBalanceState =
  | "balanced"
  | "stumbling"
  | "fallen"
  | "recovering"
  | "dead";
