export class AudioBus {
  readonly gain: GainNode;

  constructor(
    readonly name: string,
    context: AudioContext,
    parent?: AudioBus | AudioNode,
  ) {
    this.gain = context.createGain();
    this.gain.gain.value = 1;

    if (parent instanceof AudioBus) {
      this.gain.connect(parent.gain);
    } else if (parent) {
      this.gain.connect(parent);
    }
  }
}
