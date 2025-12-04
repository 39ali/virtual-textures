import * as THREE from "three";

export class FlyCamera {
  velocity: any;
  camera: THREE.PerspectiveCamera;
  direction: THREE.Vector3;
  domElement: HTMLCanvasElement;
  movement: {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
  };
  pitch: number;
  yaw: number;
  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLCanvasElement) {
    this.camera = camera;
    this.domElement = domElement;

    this.movement = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      up: false,
      down: false,
    };

    this.velocity = new THREE.Vector3();
    this.direction = new THREE.Vector3();

    this.pitch = 0; // vertical rotation
    this.yaw = 0; // horizontal rotation

    domElement.addEventListener("click", () => {
      domElement.requestPointerLock();
    });

    this.onMouseMove = this.onMouseMove.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);

    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === domElement) {
        document.addEventListener("mousemove", this.onMouseMove);
      } else {
        document.removeEventListener("mousemove", this.onMouseMove);
      }
    });

    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
  }

  onMouseMove(e: { movementX: number; movementY: number }) {
    const sensitivity = 0.002;

    this.yaw -= e.movementX * sensitivity;
    this.pitch -= e.movementY * sensitivity;

    // prevent flipping
    this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));

    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
  }

  onKeyDown(e: { code: any }) {
    switch (e.code) {
      case "KeyW":
        this.movement.forward = true;
        break;
      case "KeyS":
        this.movement.backward = true;
        break;
      case "KeyA":
        this.movement.left = true;
        break;
      case "KeyD":
        this.movement.right = true;
        break;
      case "KeyQ":
        this.movement.down = true;
        break;
      case "KeyE":
        this.movement.up = true;
        break;
    }
  }

  onKeyUp(e: { code: any }) {
    switch (e.code) {
      case "KeyW":
        this.movement.forward = false;
        break;
      case "KeyS":
        this.movement.backward = false;
        break;
      case "KeyA":
        this.movement.left = false;
        break;
      case "KeyD":
        this.movement.right = false;
        break;
      case "KeyQ":
        this.movement.down = false;
        break;
      case "KeyE":
        this.movement.up = false;
        break;
    }
  }

  update(delta: number) {
    const speed = 20.0; // movement speed

    this.direction.set(0, 0, 0);

    if (this.movement.forward) this.direction.z -= 1;
    if (this.movement.backward) this.direction.z += 1;
    if (this.movement.left) this.direction.x -= 1;
    if (this.movement.right) this.direction.x += 1;
    if (this.movement.up) this.direction.y += 1;
    if (this.movement.down) this.direction.y -= 1;

    if (this.direction.lengthSq() > 0) {
      this.direction.normalize();

      const move = new THREE.Vector3();
      move.copy(this.direction).applyEuler(this.camera.rotation);

      this.camera.position.addScaledVector(move, delta * speed);
    }
  }
}
