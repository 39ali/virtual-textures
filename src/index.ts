import * as THREE from "three";
import { FlyCamera } from "./camera";

let frameID = 1;

console.warn("TILES_X, TILES_Y", TILES_X, TILES_Y);

console.warn("SLOT_SIZE", SLOT_COUNT);
console.warn("ATLAS_SIZE", ATLAS_SIZE);

class App {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene<THREE.Object3DEventMap>;
  camera: THREE.OrthographicCamera;
  debugScene: THREE.Scene<THREE.Object3DEventMap>;
  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      premultipliedAlpha: false,
    });

    this.renderer.setSize(1000, 1000);
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
    this.camera.zoom = 1;

    const ortho = new THREE.OrthographicCamera(
      -512,
      512,
      512,
      -512,
      -0.1,
      1000
    );
    // ortho.zoom = 1;
    ortho.position.set(0, 1, 0);
    ortho.updateProjectionMatrix();
    ortho.updateMatrixWorld();

    this.debugScene = new THREE.Scene();

    /**
     *
     *  load images, split images into tiles , images ={tiles:[] ,w,h}
     *
     */
  }

  run() {}
}

const app = new App();
app.run();

// let atlas: GpuAtlas;

/* -----------------------
   Resize
------------------------ */
// window.addEventListener("resize", () => {
//   renderer.setSize(innerWidth, innerHeight);
//   camera.aspect = innerWidth / innerHeight;
//   camera.updateProjectionMatrix();
// });

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (key === "w") {
    camera.position.y += 2;
  }
  if (key === "s") {
    camera.position.y -= 3;
  }

  if (key === "z") {
    camera.zoom -= 0.1;
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
});

const tileToSlot = new Int32Array(TILES_X * TILES_Y); // -1=not loaded, 0>= where the tile lives
tileToSlot.fill(-1);
const slotToTile = new Int32Array(SLOT_COUNT * SLOT_COUNT); // which tile is loaded in atlas slot
slotToTile.fill(-1);
const slotLastUsed = new Int32Array(SLOT_COUNT * SLOT_COUNT); // last used tile
// PT_lastUsed.fill(-1);

function updateLastUsed(s: number) {
  slotLastUsed[s] = frameID;
}

function findSlot(id: number) {
  // debugger;
  let sloti = -1;
  for (let i = 0; i < slotToTile.length; i++) {
    if (slotToTile[i] === -1) {
      sloti = i;
      break;
    }
  }

  // no free slot , evict with lru
  if (sloti == -1) {
    let min = Infinity;
    let minIndex = -1;

    for (let i = 0; i < slotLastUsed.length; i++) {
      if (slotLastUsed[i] < min) {
        min = slotLastUsed[i];
        minIndex = i;
      }
    }

    sloti = minIndex;

    // slotToTile[sloti] = -1;
    // slotLastUsed[sloti] = -1;
    // tileToSlot[id] = -1;
  }

  return sloti;
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  // fly.update(delta);

  frameID++;

  //feedback pass
  renderer.setRenderTarget(atlas.fbRT);
  renderer.render(atlas.fbScene, camera);
  renderer.setRenderTarget(null);

  // read back tiles requests
  renderer.readRenderTargetPixels(
    atlas.fbRT,
    0,
    0,
    FEEDBACK_RES,
    FEEDBACK_RES,
    atlas.readBuf
  );

  // collect unique tile IDs that are requested
  const mark = new Uint8Array(TILES_X * TILES_Y);
  const requests = []; // new Int32Array(1024);
  let reqCount = 0;

  for (let i = 0; i < atlas.readBuf.length; i += 4) {
    const tx = atlas.readBuf[i];
    const ty = atlas.readBuf[i + 1];
    const textureid = atlas.readBuf[i + 2];
    if (tx < TILES_X && ty < TILES_Y && textureid !== 0) {
      const id = ty * TILES_X + tx;
      if (mark[id] === 0) {
        mark[id] = 1;
        requests[reqCount++] = id;
      }
    }
  }

  // console.warn("mark", mark);
  // console.warn("requests", requests);

  // feedback pass debug
  // {
  //   const clamped = new Uint8ClampedArray(atlas.readBuf.buffer);
  //   // const imageData1 = new ImageData(clamped, FEEDBACK_RES, FEEDBACK_RES);
  //   const canvas = document.createElement("canvas") as HTMLCanvasElement;
  //   const ctx = canvas.getContext("2d");

  //   canvas.width = FEEDBACK_RES;
  //   canvas.height = FEEDBACK_RES;

  //   const imageData = new ImageData(clamped, FEEDBACK_RES, FEEDBACK_RES);
  //   ctx.putImageData(imageData, 0, 0);

  //   document.body.append(canvas);
  // }

  // debugger;

  // 3) service requests
  for (let i = 0; i < reqCount; i++) {
    const id = requests[i];
    if (tileToSlot[id] !== -1) {
      // already loaded -> touch
      const s = tileToSlot[id];
      if (s >= 0) {
        updateLastUsed(s);
      }
      continue;
    }
    // need to load tile

    // const tx = txFromID(id);
    // const ty = tyFromID(id);
    // const slot = allocateSlotFor(id);
    // uploadTileToSlot(tx, ty, slot);

    const slot = findSlot(id);

    // upload tile to slot in atlas
    const gl = renderer.getContext();
    const properties = renderer.properties;
    // const textures = renderer.textures;
    //@ts-ignore
    const webglTexture = properties.get(atlas.atlasTex).__webglTexture;

    const tx = id % TILES_X;
    const ty = (id / TILES_X) | 0;

    const tileData = virtualTiles.tiles[ty * TILES_X + tx];

    // debugger;
    // console.warn(" virtualTiles.tiles", virtualTiles);
    // debugger;
    // console.warn("tileData", tileData);
    let sx = (slot % SLOT_COUNT) * TILE_SIZE_PADDED;
    let sy = ((slot / SLOT_COUNT) | 0) * TILE_SIZE_PADDED;

    // if (sx == 0) {
    // sx += PADDING;
    // // }

    // // if (sy == 0) {
    // sy += PADDING;
    // }

    // console.warn(tx, ty, tileData);
    // console.warn("slot coord", sx, sy);

    // console.warn(ty, tx, sx, sy);

    // bind underlying WebGL texture
    //@ts-ignore
    gl.bindTexture(gl.TEXTURE_2D, webglTexture);

    // guarantee alignment for WebGL
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    // if (tileData.constructor !== Uint8Array) {
    //   console.warn("error type is wrong ");
    //   debugger;
    // }

    const paddedTilePixels = createPaddedTile(tileData, TILE_SIZE, PADDING);

    // const pixels = new Uint8Array(
    //   tileData.buffer,
    //   tileData.byteOffset,
    //   tileData.byteLength
    // );
    // console.warn("tile data", paddedTilePixels);

    // console.warn("slot", slot, tileData);
    // Upload sub-region
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0, // mip level
      sx, // offset X in atlas
      sy, // offset Y in atlas
      TILE_SIZE_PADDED,
      TILE_SIZE_PADDED,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      paddedTilePixels
    );

    // update pagetable
    {
      //@ts-ignore
      const webglTexture = properties.get(atlas.pageTableTex).__webglTexture;
      gl.bindTexture(gl.TEXTURE_2D, webglTexture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0, // mip level
        tx, // offset X in atlas
        ty, // offset Y in atlas
        1,
        1,
        gl.RGBA,
        gl.FLOAT,
        new Float32Array([sx / ATLAS_SIZE, sy / ATLAS_SIZE, 1, 1])
      );

      // slot was evicted ,  update pagetable at id
      if (slotToTile[slot] != -1) {
        console.warn("slot was evicted update pagetable");
        const id = slotToTile[slot];
        const tx = id % TILES_X;
        const ty = (id / TILES_X) | 0;
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0, // mip level
          tx, // offset X in atlas
          ty, // offset Y in atlas
          1,
          1,
          gl.RGBA,
          gl.FLOAT,
          new Float32Array([0, 0, 0, 1])
        );
      }
    }

    updateLastUsed(slot);
    slotToTile[slot] = id;
    tileToSlot[id] = slot;

    // if (i === 8) {
    //   break;
    // }
  }

  //   mesh.rotation.y += 0.004; // just to show it works
  renderer.render(scene, camera);

  renderer.autoClear = false;
  // requestAnimationFrame(animate);

  renderer.render(debugScene, ortho);
  // console.log("pt_loaded", PT_loaded);

  renderer.autoClear = true;
}

function splitImageDataIntoTiles(
  imageData: ImageDataArray,
  width: number,
  height: number,
  tileW: number,
  tileH: number
) {
  const src = imageData;
  const srcW = width;
  const srcH = height;

  const tilesX = srcW / tileW;
  const tilesY = srcH / tileH;

  const tiles = new Array(tilesX * tilesY);

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const out = new Uint8ClampedArray(tileW * tileH * 4);
      let dstIndex = 0;

      const startX = tx * tileW;
      const startY = ty * tileH;

      for (let y = 0; y < tileH; y++) {
        const srcIndex = ((startY + y) * srcW + startX) * 4;
        out.set(src.subarray(srcIndex, srcIndex + tileW * 4), dstIndex);
        dstIndex += tileW * 4;
      }

      tiles[ty * tilesX + tx] = new Uint8Array(
        out.buffer,
        out.byteOffset,
        out.byteLength
      );
    }
  }

  return {
    tiles,
    tilesX,
    tilesY,
  };
}

let virtualTiles: {
  tiles: Uint8Array[];
  tilesX: number;
  tilesY: number;
};

async function main() {
  /// virtual texture

  // console.warn("pixels", virtualTiles, width, height);
  // console.log("out", out);

  // console.warn("tile0", out.tiles[0][0]);

  atlas = new GpuAtlas(width, height, pixels);

  // ----------------- SVT shader (samples page table + atlas) -----------------
  const svtMat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      pageTable: { value: atlas.pageTableTex },
      atlas: { value: atlas.atlasTex },
      tiles: { value: new THREE.Vector2(TILES_X, TILES_Y) },
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
    uniform sampler2D pageTable; 
    uniform sampler2D atlas; 
    uniform vec2 tiles; 
    uniform float tileSize; 
    uniform float atlasSize;

    float padding = float(${PADDING}) ;
    void main(){
      // 1. Which VT tile am I inside?
    vec2 tileFloat = vUv * tiles;
    ivec2 tileID = ivec2(floor(tileFloat));

    // 2. Read page table entry (normalized coordinates)
    vec2 ptUV = (vec2(tileID) + 0.5) / tiles;
    vec4 entry = texture2D(pageTable, ptUV);

    // entry.r = atlasX (0..1)
    // entry.g = atlasY (0..1)
    // entry.b = loaded flag

    if (entry.b < 0.5) {
        gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); // fallback red
        return;
    }

    // 3. local 0..1 coordinates inside payload tile
    vec2 local = fract(tileFloat);

    // 4. Convert local → atlas pixel coordinates (important!)
    vec2 atlasPx =
        entry.xy * atlasSize +     // slot start in pixels
        vec2(padding) +
        local * (tileSize);        // scale interior

    // 5. Convert to normalized UV
    vec2 atlasUV = atlasPx / atlasSize;

    // 6. Sample atlas
    gl_FragColor = texture2D(atlas, atlasUV );
    }
`,
  });

  const quadGeo = new THREE.PlaneGeometry(400, 400);
  const quad = new THREE.Mesh(quadGeo, svtMat);
  quad.position.y = -700;
  quad.position.x = -200;
  quad.position.z = -3;

  scene.add(quad);

  //feedback sprite
  const fbMat = new THREE.ShaderMaterial({
    // transparent: true,
    uniforms: { tiles: { value: new THREE.Vector2(TILES_X, TILES_Y) } },
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
      void main(){ 
      vec2 uv = vec2(vUv.x,vUv.y);
      vec2 v = floor(uv * tiles); 
      gl_FragColor = vec4(v.x/255.,v.y/255.,1.0, 1.0);
      }`,
    depthTest: false,
  });
  const quadFeedback = new THREE.Mesh(quadGeo, fbMat);
  quadFeedback.position.copy(quad.position);

  // quadFeedback.scale.set(0.0, 0.0, 1.0);
  atlas.fbScene.add(quadFeedback);

  /// atlas debug
  {
    const svtMat = new THREE.ShaderMaterial({
      // transparent: true,
      uniforms: {
        atlas: { value: atlas.atlasTex },
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
    uniform sampler2D atlas; 
    void main(){
    
      gl_FragColor = texture2D(atlas,vUv);
    }
`,
    });
    const quadGeo = new THREE.PlaneGeometry(200, 200);
    const quad = new THREE.Mesh(quadGeo, svtMat);
    quad.position.set(-300, 400, 0);

    debugScene.add(quad);
  }
  // pagetable debug
  {
    const svtMat = new THREE.ShaderMaterial({
      // transparent: true,
      uniforms: {
        atlas: { value: atlas.pageTableTex },
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
    uniform sampler2D atlas; 
    void main(){
      vec4 v = texture2D(atlas,vUv);
      gl_FragColor =vec4(v.r,v.g,0.0,v.b);
    }
`,
    });
    const quadGeo = new THREE.PlaneGeometry(200, 200);
    const quad = new THREE.Mesh(quadGeo, svtMat);
    quad.position.set(0, 400, 0);

    debugScene.add(quad);
  }

  //initiaize stuff
  renderer.render(scene, camera);

  animate();
}

main();
