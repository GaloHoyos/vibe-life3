/**
 * Resorte de segundo orden con integración semi-implícita.
 *
 * Es lo que separa un apéndice que cuelga de uno que sigue una curva: un lerp
 * llega al destino y se queda, mientras que un resorte se pasa, vuelve y se
 * asienta. Esa demora es la que se lee como masa, y sin masa cualquier antena
 * parece pintada sobre el modelo.
 *
 * Euler explícito explota a `stiffness` alto con el paso variable de un frame;
 * semi-implícito (velocidad primero, posición con la velocidad ya nueva) se
 * mantiene estable en todo el rango que hace falta acá.
 */
export class SecondOrderSpring {
  private value: number;
  private velocity = 0;

  constructor(
    initialValue = 0,
    /** Frecuencia angular natural, en rad/s. Más alto, más rígido. */
    private stiffness = 18,
    /** 1 es crítico: por debajo rebota, por encima se arrastra. */
    private damping = 0.7,
  ) {
    this.value = initialValue;
  }

  step(target: number, delta: number): number {
    // Un frame perdido no puede mandar el resorte al infinito.
    const step = Math.min(delta, 1 / 45);
    this.velocity +=
      (this.stiffness * this.stiffness * (target - this.value) -
        2 * this.damping * this.stiffness * this.velocity) *
      step;
    this.value += this.velocity * step;
    return this.value;
  }

  /** Empujón instantáneo de velocidad: golpes, sacudones, retrocesos. */
  kick(impulse: number): void {
    this.velocity += impulse;
  }

  get current(): number {
    return this.value;
  }

  reset(value = 0): void {
    this.value = value;
    this.velocity = 0;
  }
}
