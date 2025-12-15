import * as THREE from "three";
import {
  ATLAS_SIZE,
  FEEDBACK_RES,
  GpuAtlas,
  MAX_MIP,
  PADDING,
  SLOT_COUNT,
  TILE_SIZE,
  TILES_X,
  VIRTUAL_SIZE,
} from "./atlas";

let frameID = 1;

console.warn("TILES_X, TILES_Y", TILES_X, TILES_X);

console.warn("SLOT_COUNT", SLOT_COUNT);
console.warn("ATLAS_SIZE", ATLAS_SIZE);

const WIDTH = window.innerWidth;
const HEIGHT = window.innerWidth;

class App {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene<THREE.Object3DEventMap>;
  camera: THREE.OrthographicCamera;
  debugScene: THREE.Scene<THREE.Object3DEventMap>;
  atlas: GpuAtlas;
  fbMat: THREE.ShaderMaterial;
  quad: THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.ShaderMaterial,
    THREE.Object3DEventMap
  >;
  debugCam: THREE.OrthographicCamera;
  debugRenderTarget: THREE.WebGLRenderTarget<THREE.Texture<unknown>>;
  debugRenderTargetbuffer: Float32Array<ArrayBuffer>;
  velocity: THREE.Vector3;
  acceleration: number;
  damping: number;
  zoomVelocity: number;
  lastTime: number;
  fps: number;
  fpsDisplay: HTMLDivElement;
  frames: any;
  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      premultipliedAlpha: false,
    });

    // Match physical pixels (retina)
    //  this.renderer.setPixelRatio(window.devicePixelRatio);

    // Match CSS size
    //  this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.renderer.setSize(WIDTH, HEIGHT, false);
    document.body.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.OrthographicCamera(
      -512,
      512,
      512,
      -512,
      -0.1,
      1000
    ); //new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.camera.zoom = 2.6;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    this.debugCam = new THREE.OrthographicCamera(
      -512,
      512,
      512,
      -512,
      -0.1,
      1000
    );
    // ortho.zoom = 1;
    this.debugCam.position.set(0, 1, 0);
    this.debugCam.updateProjectionMatrix();
    this.debugCam.updateMatrixWorld();

    this.debugScene = new THREE.Scene();

    this.initAtlas();

    this.debugRenderTarget = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, {
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });

    this.debugRenderTargetbuffer = new Float32Array(WIDTH * HEIGHT * 4); // RGBA

    // camera movement
    this.velocity = new THREE.Vector3();
    this.zoomVelocity = 0;
    this.acceleration = 0.1;
    this.damping = 0.9;

    //

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

  initAtlas() {
    this.atlas = new GpuAtlas(
      "http://localhost:3000/earth-tiles",
      this.renderer
    );

    // VT shader
    const svtMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        pageTables: { value: this.atlas.pageTableTex },
        atlas: { value: this.atlas.atlasTex },
        tiles: { value: new THREE.Vector2(TILES_X, TILES_X) },
        tileSize: { value: TILE_SIZE },
        atlasSize: { value: ATLAS_SIZE },
      },
      vertexShader: `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
      fragmentShader: `
    precision highp float;
    varying vec2 vUv; 
    uniform sampler2D pageTables[${MAX_MIP}];
    uniform sampler2D atlas; 
    uniform vec2 tiles; 
    uniform float tileSize; 
    uniform float atlasSize;

    float padding = float(${PADDING});

    vec4 loadPage(ivec2 uv ,int mip){
    if (mip == 0) return texelFetch(pageTables[0], uv,0);
    if (mip == 1) return texelFetch(pageTables[1], uv,0);
    if (mip == 2) return texelFetch(pageTables[2], uv,0);
    if (mip == 3) return texelFetch(pageTables[3], uv,0);
    if (mip == 4) return texelFetch(pageTables[4], uv,0);
    if (mip == 5) return texelFetch(pageTables[5], uv,0);
    if (mip == 6) return texelFetch(pageTables[6], uv,0);
    return texelFetch(pageTables[6], uv,0);
    }

    void main(){

    // figure out mip level
    vec2 texel = vUv * tiles * tileSize; 
    vec2 dx = dFdx(texel);
    vec2 dy = dFdy(texel);
    float footprint = max(length(dx),length(dy));
    float mip =clamp(floor(log2(footprint)),0.0,float(${MAX_MIP - 1}));

    // fetch tile 
    float scale = exp2(float(mip));          
    vec2 tileF = vUv *tiles / scale;
    ivec2 tileID =ivec2(floor(tileF));
    vec2 local = fract(tileF);
    
    vec4 entry = loadPage(tileID,int(mip));

    // gl_FragColor =vec4(mip,entry.y,55.0,1.);
    //     return;

    if (entry.b < 0.5) {
        /// feedback pass will request a lower mip so try to load it 
        mip-=1.;
        scale = exp2(float(mip));          
        tileF = vUv *tiles / scale;
        tileID =ivec2(floor(tileF));
        local = fract(tileF);
        entry = loadPage(tileID,int(mip));
      
        if (entry.b < 0.5) {
        // load fallback mip 
        mip= ${MAX_MIP-1}.0;
        scale = exp2(float(mip));          
        tileF = vUv *tiles / scale;
        tileID =ivec2(floor(tileF));
        local = fract(tileF);
        entry = loadPage(tileID,int(mip));
        }
    } 
    vec2 atlasUV =
        entry.xy  +
        (padding / atlasSize) +
        local * (tileSize / atlasSize);
    

    gl_FragColor = texture2D(atlas, atlasUV );
    }
`,
    });

    const quadGeo = new THREE.PlaneGeometry(400, 400);
    const quad = new THREE.Mesh(quadGeo, svtMat);
    quad.position.z = -3;

    this.quad = quad;
    this.scene.add(quad);

    //feedback shader
    this.fbMat = new THREE.ShaderMaterial({
      // transparent: true,
      uniforms: {
        tiles: { value: new THREE.Vector2(TILES_X, TILES_X) },
        tileSize: { value: TILE_SIZE },
        mipBias: { value: Math.ceil(Math.log2(WIDTH / 256)) },
      },
      vertexShader: `
      varying vec2 vUv;
      void main(){ 
        vUv = uv; 
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
      fragmentShader: `
      precision highp float; 
      varying vec2 vUv; 
      uniform vec2 tiles; 
      uniform float tileSize; 
      uniform float mipBias; 
    
      void main(){ 
      vec2 texel = vUv * tiles * tileSize; 
      vec2 dx = dFdx(texel);
      vec2 dy = dFdy(texel);
      float footprint = max(length(dx), length(dy));
      float mip =clamp(floor(log2(footprint)), 0.0,float(${MAX_MIP - 1}));
      mip = max(mip- mipBias,0.0);

      float scale = exp2(mip); 
      vec2 tileId = floor( vUv * tiles/scale); 

      gl_FragColor = vec4(tileId.x/255.,tileId.y/255.,1.0, mip/255.);
      }`,
      depthTest: false,
    });

    /// atlas debug
    {
      const svtMat = new THREE.ShaderMaterial({
        // transparent: true,
        uniforms: {
          atlas: { value: this.atlas.atlasTex },
        },
        vertexShader: `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,

        fragmentShader: `
    precision highp float;
    varying vec2 vUv; 
    uniform sampler2D atlas; 
    void main(){
      gl_FragColor = texture2D(atlas,vUv);
    }
`,
      });
      const quadGeo = new THREE.PlaneGeometry(200, 200);
      const quad = new THREE.Mesh(quadGeo, svtMat);
      quad.position.set(-300, 400, 0);

      this.debugScene.add(quad);
    }
    // pagetable debug
    {
      const svtMat = new THREE.ShaderMaterial({
        // transparent: true,
        uniforms: {
          atlas: { value: this.atlas.pageTableTex },
        },
        vertexShader: `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        // Standard transformation
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,

        fragmentShader: `
    precision highp float;
    varying vec2 vUv; 
    uniform sampler2D atlas[${MAX_MIP}]; 
    void main(){
      vec4 v = texture2D(atlas[4],vUv);
      gl_FragColor =vec4(v.r,v.g,0.0,1.0);
    }
`,
      });
      const quadGeo = new THREE.PlaneGeometry(200, 200);
      const quad = new THREE.Mesh(quadGeo, svtMat);
      quad.position.set(0, 400, 0);

      this.debugScene.add(quad);
    }
  }
  ii = 0;

  render() {
    // if (this.ii===30){
    //   return
    // }
    // this.ii++
    requestAnimationFrame(this.render.bind(this));

    frameID++;

    if (keys.w) this.velocity.y += this.acceleration;
    if (keys.s) this.velocity.y -= this.acceleration;
    if (keys.a) this.velocity.x -= this.acceleration;
    if (keys.d) this.velocity.x += this.acceleration;
    if (keys.q) this.zoomVelocity += this.acceleration * 0.05;
    if (keys.z) this.zoomVelocity -= this.acceleration * 0.05;
    // console.warn("keys",keys)
    this.velocity.multiplyScalar(this.damping);
    this.zoomVelocity *= this.damping;
    // this.zoomVelocity.multiplyScalar(this.damping);

    this.camera.position.add(this.velocity);
    this.camera.zoom = Math.max(1, this.camera.zoom + this.zoomVelocity);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.renderer.autoClear = false;

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

    //feedback pass

    const mat = this.quad.material;
    this.quad.material = this.fbMat;

    this.renderer.setRenderTarget(this.atlas.fbRT);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);

    this.quad.material = mat;

    // read back tiles requests
    this.renderer.readRenderTargetPixels(
      this.atlas.fbRT,
      0,
      0,
      FEEDBACK_RES,
      FEEDBACK_RES,
      this.atlas.readBuf
    );

    this.atlas.update(frameID);

    // render debug
    // {
    //  this. renderer.setRenderTarget(this.debugRenderTarget );
    //    this. renderer.clear(true, true, true);

    //     this.renderer.render(this.scene, this.camera);
    // this.renderer.setRenderTarget(null);

    // const pixelBuffer = new Float32Array(1000 * 1000 * 4); // RGBA

    // this.renderer.readRenderTargetPixels(this.debugRenderTarget, 0, 0, 1000, 1000, pixelBuffer);
    // const set = new Set()
    // for (let i=0 ;i< 1000*1000;i++ ){

    //     set.add(`${pixelBuffer[i*4 +0]},${pixelBuffer[i*4 +1]},${pixelBuffer[i*4 +2] },${pixelBuffer[i*4 +3]}`)
    // }
    // console.log("set",set)
    // }

    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, this.camera);

    this.renderer.render(this.debugScene, this.debugCam);

    // this.renderer.autoClear = true;
  }
}

const keys: { [key: string]: boolean } = {};
const app = new App();
await app.atlas.loadFallbackMip()
app.render();

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  keys[key] = true;
});

window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  keys[key] = false;
});
