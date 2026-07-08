/**
 * Tuning visual de la granada activa (`grenade-primed.glb` mientras est
 * volando o esperando explotar). El `GrenadeSystem` re-aplica `thrownScale`
 * en cada frame al mesh para que el debug tuner pueda modificarlo en vivo.
 *
 * Default elegido para matchear aproximadamente el tamao del pickup (que
 * usa una `pickupScale` similar)  ajustar via debug panel y commitear ac.
 */
export const GrenadeRenderTuning = {
  thrownScale: 0.09,
};
