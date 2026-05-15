export interface MouseDelta {
  x: number;
  y: number;
}

export class Input {
  private readonly keysDown = new Set<string>();
  private readonly keysPressed = new Set<string>();
  private readonly keysReleased = new Set<string>();
  private readonly mouseButtonsDown = new Set<number>();
  private readonly mouseButtonsPressed = new Set<number>();
  private readonly mouseButtonsReleased = new Set<number>();
  private readonly mouseDelta: MouseDelta = { x: 0, y: 0 };
  private wheelDelta = 0;

  constructor(private readonly target: HTMLElement) {
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("mousedown", this.handleMouseDown);
    window.addEventListener("mouseup", this.handleMouseUp);
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("wheel", this.handleWheel, { passive: false });
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("mousedown", this.handleMouseDown);
    window.removeEventListener("mouseup", this.handleMouseUp);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("wheel", this.handleWheel);
  }

  requestPointerLock(): void {
    this.target.requestPointerLock();
  }

  isPointerLocked(): boolean {
    return document.pointerLockElement === this.target;
  }

  isKeyDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  wasKeyPressed(code: string): boolean {
    return this.keysPressed.has(code);
  }

  wasMousePressed(button: number): boolean {
    return this.mouseButtonsPressed.has(button);
  }

  isMouseDown(button: number): boolean {
    return this.mouseButtonsDown.has(button);
  }

  getMouseDelta(): MouseDelta {
    return this.mouseDelta;
  }

  getWheelDelta(): number {
    return this.wheelDelta;
  }

  endFrame(): void {
    this.keysPressed.clear();
    this.keysReleased.clear();
    this.mouseButtonsPressed.clear();
    this.mouseButtonsReleased.clear();
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    this.wheelDelta = 0;
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.keysDown.has(event.code)) {
      this.keysPressed.add(event.code);
    }

    this.keysDown.add(event.code);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.keysDown.delete(event.code);
    this.keysReleased.add(event.code);
  };

  private readonly handleMouseDown = (event: MouseEvent): void => {
    if (!this.mouseButtonsDown.has(event.button)) {
      this.mouseButtonsPressed.add(event.button);
    }

    this.mouseButtonsDown.add(event.button);
  };

  private readonly handleMouseUp = (event: MouseEvent): void => {
    this.mouseButtonsDown.delete(event.button);
    this.mouseButtonsReleased.add(event.button);
  };

  private readonly handleMouseMove = (event: MouseEvent): void => {
    if (!this.isPointerLocked()) {
      return;
    }

    this.mouseDelta.x += event.movementX;
    this.mouseDelta.y += event.movementY;
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (!this.isPointerLocked()) {
      return;
    }

    event.preventDefault();
    this.wheelDelta += event.deltaY;
  };
}
