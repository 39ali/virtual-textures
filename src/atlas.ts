import * as THREE from "three";

const VIRTUAL_SIZE = 8192;
const TILE_SIZE = 256;
const PADDING = 1.0;
const TILE_SIZE_PADDED = TILE_SIZE + 2 * PADDING;

const TILES_X = VIRTUAL_SIZE / TILE_SIZE; // 32
const TILES_Y = TILES_X;

const SLOT_COUNT = 16;
const ATLAS_SIZE = TILE_SIZE_PADDED * SLOT_COUNT;

const FEEDBACK_RES = 256;

class GpuAtlas {
  width: number;
  height: number;
  virtualTexture: ImageDataArray;
  atlasTex: THREE.DataTexture;
  pageTableTex: THREE.DataTexture;
  fbScene: THREE.Scene<THREE.Object3DEventMap>;
  fbRT: THREE.WebGLRenderTarget<THREE.Texture<unknown>>;
  readBuf: Uint8Array<ArrayBuffer>;

  constructor(width: number, height: number, virtualTexture: ImageDataArray) {
    this.width = width;
    this.height = height;
    this.virtualTexture = virtualTexture;
    // page table
    // RGBA float: R = atlasU, G = atlasV, B = loaded(1/0), A = slotIndex (float or -1)
    const pageTableData = new Float32Array(TILES_X * TILES_Y * 4);
    for (let i = 0; i < TILES_X * TILES_Y; i++) {
      pageTableData[i * 4 + 0] = -1;
      pageTableData[i * 4 + 1] = -1;
      pageTableData[i * 4 + 2] = 0;
      pageTableData[i * 4 + 3] = -1;
    }
    const pageTableTex = new THREE.DataTexture(
      pageTableData,
      TILES_X,
      TILES_Y,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    pageTableTex.magFilter = THREE.NearestFilter;
    pageTableTex.minFilter = THREE.NearestFilter;
    pageTableTex.generateMipmaps = false;
    pageTableTex.needsUpdate = true;
    this.pageTableTex = pageTableTex;

    /// atlas
    const data = new Float32Array(ATLAS_SIZE * ATLAS_SIZE * 4);
    data.fill(0);
    const atlasTex = new THREE.DataTexture(
      data,
      ATLAS_SIZE,
      ATLAS_SIZE,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    atlasTex.minFilter = THREE.LinearFilter;
    atlasTex.magFilter = THREE.LinearFilter;
    atlasTex.generateMipmaps = false;
    atlasTex.needsUpdate = true;
    this.atlasTex = atlasTex;

    /// feedback pass
    const fbScene = new THREE.Scene();

    // const quadGeo = new THREE.PlaneGeometry(2, 2);
    // const fbQuad = new THREE.Mesh(quadGeo, fbMat);
    // fbScene.add(fbQuad);
    const fbRT = new THREE.WebGLRenderTarget(FEEDBACK_RES, FEEDBACK_RES, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.fbScene = fbScene;
    this.fbRT = fbRT;
    this.readBuf = new Uint8Array(FEEDBACK_RES * FEEDBACK_RES * 4);
  }

  updateTiles() {}
}
async function loadImageToPixels(url: string) {
  // 1. download image
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;

  await img.decode(); // wait for image to load

  // 2. draw to canvas
  const canvas = document.createElement("canvas");
  // document.body.append(canvas);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  canvas.width = img.width;
  canvas.height = img.height;

  ctx.drawImage(img, 0, 0);

  // 3. extract raw bitmap as Uint8ClampedArray
  const imageData = ctx.getImageData(0, 0, img.width, img.height);

  // flip it
  const { width, height, data } = imageData;
  const rowSize = width * 4;

  const flipped = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y++) {
    const srcStart = y * rowSize;
    const dstStart = (height - y - 1) * rowSize;
    flipped.set(data.subarray(srcStart, srcStart + rowSize), dstStart);
  }

  return {
    width: img.width,
    height: img.height,
    pixels: flipped,
  };
}

function createPaddedTile(tileData: Uint8Array, T: number, P: number) {
  const PT = T + 2 * P; // padded dimension
  const out = new Uint8Array(PT * PT * 4); // output buffer

  //@ts-ignore
  function copyPixel(dst, dx, dy, src, sx, sy, srcW, dstW) {
    const di = (dy * dstW + dx) * 4;
    const si = (sy * srcW + sx) * 4;
    dst[di] = src[si];
    dst[di + 1] = src[si + 1];
    dst[di + 2] = src[si + 2];
    dst[di + 3] = src[si + 3];
  }

  // 1. Copy center payload tile
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      copyPixel(out, x + P, y + P, tileData, x, y, T, PT);
    }
  }

  // 2. Top & bottom padding (repeat first/last row)
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < T; x++) {
      // top padding copies row 0
      copyPixel(out, x + P, P - 1 - y, tileData, x, 0, T, PT);
      // bottom padding copies row T-1
      copyPixel(out, x + P, P + T + y, tileData, x, T - 1, T, PT);
    }
  }

  // 3. Left & right padding (repeat first/last column)
  for (let x = 0; x < P; x++) {
    for (let y = 0; y < T; y++) {
      // left padding copies column 0
      copyPixel(out, P - 1 - x, y + P, tileData, 0, y, T, PT);
      // right padding copies column T-1
      copyPixel(out, P + T + x, y + P, tileData, T - 1, y, T, PT);
    }
  }

  // 4. Corner padding (repeat corners)
  // for (let y = 0; y < P; y++) {
  //   for (let x = 0; x < P; x++) {
  //     // top-left
  //     copyPixel(out, P - 1 - x, P - 1 - y, tileData, 0, 0, T, PT);
  //     // top-right
  //     copyPixel(out, P + T + x, P - 1 - y, tileData, T - 1, 0, T, PT);
  //     // bottom-left
  //     copyPixel(out, P - 1 - x, P + T + y, tileData, 0, T - 1, T, PT);
  //     // bottom-right
  //     copyPixel(out, P + T + x, P + T + y, tileData, T - 1, T - 1, T, PT);
  //   }
  // }

  return out;
}
const { width, height, pixels } = await loadImageToPixels(
  "http://localhost:3000/bbb-splash (5).png"
);

virtualTiles = splitImageDataIntoTiles(
  pixels,
  width,
  height,
  TILE_SIZE,
  TILE_SIZE
);
