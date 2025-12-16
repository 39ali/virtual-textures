import * as THREE from "three";
import {
  ATLAS_SIZE,
  FEEDBACK_RES,
  GpuAtlas,
  PADDING,
  TILE_SIZE,
} from "./atlas";
import { CameraControl } from "./cameraControl";
import { Fps } from "./fps";

let frameID = 1;

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

  cameraControl: CameraControl;
  fps: Fps;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      premultipliedAlpha: false,
    });

    this.renderer.setSize(WIDTH, HEIGHT, false);
    this.renderer.autoClear = false;
    document.body.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.OrthographicCamera(
      -512,
      512,
      512,
      -512,
      -0.1,
      1000
    );
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

    this.debugRenderTarget = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, {
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });

    this.debugRenderTargetbuffer = new Float32Array(WIDTH * HEIGHT * 4); // RGBA

    this.cameraControl = new CameraControl(this.camera);

    this.fps = new Fps();
  }

  clear() {
    if (this.scene) {
      this.scene.traverse((obj: any) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      this.scene.clear();
    }

    if (this.atlas) {
      this.atlas.clear();
    }
  }
  async initAtlas(url: string) {
    const info = await (await fetch(url + "/info.json")).json();
    console.warn(info);
    this.atlas = new GpuAtlas(
      url,
      this.renderer,
      info.virtualSize,
      info.maxMips
    );

    await this.atlas.loadFallbackMip();

    let loadPage = "vec4 loadPage(ivec2 uv ,int mip){";
    for (let mip = 0; mip < this.atlas.MAX_MIP; mip++) {
      loadPage += `if (mip == ${mip}) return texelFetch(pageTables[${mip}], uv,0);`;
    }
    loadPage += ` return texelFetch(pageTables[6], uv,0);
    }`;

    // VT shader
    const svtMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        pageTables: { value: this.atlas.pageTableTex },
        atlas: { value: this.atlas.atlasTex },
        tiles: {
          value: new THREE.Vector2(this.atlas.TILES_X, this.atlas.TILES_X),
        },
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
    uniform sampler2D pageTables[${this.atlas.MAX_MIP}];
    uniform sampler2D atlas; 
    uniform vec2 tiles; 
    uniform float tileSize; 
    uniform float atlasSize;

    float padding = float(${PADDING});

   ${loadPage}

    void main(){

    // figure out mip level
    vec2 texel = vUv * tiles * tileSize; 
    vec2 dx = dFdx(texel);
    vec2 dy = dFdy(texel);
    float footprint = max(length(dx),length(dy));
    float mip =clamp(floor(log2(footprint)),0.0,float(${
      this.atlas.MAX_MIP - 1
    }));

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
        mip= ${this.atlas.MAX_MIP - 1}.0;
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
        tiles: {
          value: new THREE.Vector2(this.atlas.TILES_X, this.atlas.TILES_X),
        },
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
      float mip =clamp(floor(log2(footprint)), 0.0,float(${
        this.atlas.MAX_MIP - 1
      }));
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
      quad.position.set(-400, 390, 0);

      this.debugScene.add(quad);
    }
    // pagetable debug
    {
      const svtMat = new THREE.ShaderMaterial({
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
    uniform sampler2D atlas[${this.atlas.MAX_MIP}]; 
    void main(){
      vec4 v = texture2D(atlas[4],vUv);
      gl_FragColor =vec4(v.r,v.g,0.0,1.0);
    }
`,
      });
      const quadGeo = new THREE.PlaneGeometry(200, 200);
      const quad = new THREE.Mesh(quadGeo, svtMat);
      quad.position.set(0, 400, 0);

      // this.debugScene.add(quad);
    }
  }

  render() {
    requestAnimationFrame(this.render.bind(this));

    frameID++;

    this.cameraControl.update();
    this.fps.update();

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
  }
}

const app = new App();
const url = "http://localhost:3000/";
await app.initAtlas(url + "earth-tiles-2");
app.render();

// switch between textures
const select = document.createElement("select");
select.id = "qualitySelect";

const options = [
  { value: "earth-tiles-2", label: "32768 × 32768 texture" },
  { value: "earth-tiles", label: "16384 × 16384 texture" },
];

options.forEach((opt) => {
  const option = document.createElement("option");
  option.value = opt.value;
  option.textContent = opt.label;
  select.appendChild(option);
});
document.body.appendChild(select);

select.addEventListener("change", async (event: Event) => {
  const target = event.target as HTMLSelectElement;
  const value = target.value;
  console.log("Selected:", value);
  app.clear();
  await app.initAtlas(url + value);
});
