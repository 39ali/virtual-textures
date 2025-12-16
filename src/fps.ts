export class Fps {
  lastTime: number;
  fps: number;
  fpsDisplay: HTMLDivElement;
  frames: number;
  constructor() {
    const fpsDisplay = document.createElement("div");
    fpsDisplay.style.position = "absolute";
    fpsDisplay.style.top = "10px";
    fpsDisplay.style.left = "10px";
    fpsDisplay.style.color = "#00ff00";
    fpsDisplay.style.fontFamily = "monospace";
    fpsDisplay.style.fontSize = "20px";
    fpsDisplay.style.backgroundColor = "rgba(0,0,0,0.5)";
    fpsDisplay.style.padding = "5px 10px";
    fpsDisplay.style.borderRadius = "4px";
    this.fpsDisplay = fpsDisplay;
    document.body.appendChild(fpsDisplay);

    // Variables to measure FPS
    this.lastTime = performance.now();
    this.fps = 0;
    this.frames = 0;
  }

  update() {
    // update fps
    this.frames++;
    const now = performance.now();
    // Update FPS every 0.5 second
    if (now - this.lastTime >= 500) {
      this.fps = (this.frames * 1000) / (now - this.lastTime);
      this.fpsDisplay.textContent = `FPS: ${this.fps.toFixed(1)}`;
      this.frames = 0;
      this.lastTime = now;
    }
  }
}
