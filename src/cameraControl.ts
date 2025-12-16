import * as THREE from "three";
export class CameraControl {
  keys: { [key: string]: boolean };
  velocity: THREE.Vector3;
  acceleration: number;
  damping: number;
  zoomVelocity: number;
  camera: THREE.OrthographicCamera;
  constructor(camera: THREE.OrthographicCamera) {
    this.camera = camera;
    this.keys = {};

    window.addEventListener("keydown", (e) => {
      const key = e.key.toLowerCase();
      this.keys[key] = true;
    });

    window.addEventListener("keyup", (e) => {
      const key = e.key.toLowerCase();
      this.keys[key] = false;
    });

    this.velocity = new THREE.Vector3();
    this.zoomVelocity = 0;
    this.acceleration = 0.1;
    this.damping = 0.9;
  }
  update() {
    this.velocity.multiplyScalar(this.damping);
    this.zoomVelocity *= this.damping;
    this.zoomVelocity *= this.damping;
    if (this.keys.w) this.velocity.y += this.acceleration;
    if (this.keys.s) this.velocity.y -= this.acceleration;
    if (this.keys.a) this.velocity.x -= this.acceleration;
    if (this.keys.d) this.velocity.x += this.acceleration;
    if (this.keys.q) this.zoomVelocity += this.acceleration * 0.05;
    if (this.keys.z) this.zoomVelocity -= this.acceleration * 0.05;

    this.camera.position.add(this.velocity);
    this.camera.zoom = Math.max(1, this.camera.zoom + this.zoomVelocity);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }
}
