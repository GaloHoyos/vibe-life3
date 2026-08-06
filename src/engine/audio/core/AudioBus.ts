export class AudioBus {
  readonly gain: GainNode;
  /**
   * Camino paralelo al fader, para los envíos a efectos. Una voz no puede
   * derivar su wet desde `gain` (ese es el sumado del bus, ya mezclado); si
   * enviara directo al rack, bajar el fader del bus no bajaría su reverb.
   *
   * `auxGain` replica el árbol de buses y el valor de cada fader, así el wet
   * arrastra exactamente la misma cadena de volúmenes que el seco. El bus
   * master deja su `auxGain` suelto: ahí lo engancha el rack de efectos.
   */
  readonly auxGain: GainNode;

  constructor(
    readonly name: string,
    context: AudioContext,
    parent?: AudioBus | AudioNode,
  ) {
    this.gain = context.createGain();
    this.gain.gain.value = 1;
    this.auxGain = context.createGain();
    this.auxGain.gain.value = 1;

    if (parent instanceof AudioBus) {
      this.gain.connect(parent.gain);
      this.auxGain.connect(parent.auxGain);
    } else if (parent) {
      this.gain.connect(parent);
    }
  }
}
