import * as THREE from "three";

export const TILE_SIZE = 256;
export const PADDING = 1.0;
export const TILE_SIZE_PADDED = TILE_SIZE + 2 * PADDING;

export const SLOT_COUNT = 2 ** 5;
export const ATLAS_SIZE = TILE_SIZE_PADDED * SLOT_COUNT;

export const FEEDBACK_RES = 256;

console.warn("SLOT_COUNT", SLOT_COUNT);
console.warn("ATLAS_SIZE", ATLAS_SIZE);

enum TileState {
  loaded,
  loading,
}

class Tile {
  state: TileState;
  data: ImageBitmap;
}

class Slot {
  tileid: number;
  mip: number;
  lastUsed: number;
}

export class GpuAtlas {
  url: string;

  readBuf: Uint8Array<ArrayBuffer>;
  fbScene: THREE.Scene<THREE.Object3DEventMap>;
  fbRT: THREE.WebGLRenderTarget<THREE.Texture<unknown>>;

  atlasTex: THREE.DataTexture;
  pageTableTex: THREE.DataTexture[];

  renderer: THREE.WebGLRenderer;
  // all loaded tiles [mip][x,y]
  tiles: Tile[][];
  // tile location in atlas
  pagetables: Int32Array<ArrayBuffer>[];
  // atlas slot info
  atlas: Slot[];
  mark: Uint32Array<ArrayBuffer>[];
  VIRTUAL_SIZE: number;
  TILES_X: number;
  MAX_MIP: number;

  constructor(
    url: string,
    renderer: THREE.WebGLRenderer,
    VIRTUAL_SIZE: number,
    MAX_MIP: number
  ) {
    this.VIRTUAL_SIZE = VIRTUAL_SIZE;
    this.TILES_X = VIRTUAL_SIZE / TILE_SIZE;
    this.MAX_MIP = MAX_MIP;

    this.url = url;
    // page table
    // RGBA float: R = atlasU, G = atlasV, B = loaded(1/0), A = not used
    this.pageTableTex = [];
    for (let i = 0; i < MAX_MIP; i++) {
      let pageWidth = this.TILES_X / 2 ** i;
      let pageHeight = this.TILES_X / 2 ** i;
      const pageTableData = new Float32Array(pageWidth * pageHeight * 4);

      for (let i = 0; i < pageWidth * pageHeight; i++) {
        pageTableData[i * 4 + 0] = -1;
        pageTableData[i * 4 + 1] = -1;
        pageTableData[i * 4 + 2] = -1;
        pageTableData[i * 4 + 3] = -1;
      }
      const pageTableTex = new THREE.DataTexture(
        pageTableData,
        pageWidth,
        pageHeight,
        THREE.RGBAFormat,
        THREE.FloatType
      );
      pageTableTex.magFilter = THREE.NearestFilter;
      pageTableTex.minFilter = THREE.NearestFilter;
      pageTableTex.generateMipmaps = false;
      pageTableTex.needsUpdate = true;
      renderer.initTexture(pageTableTex);
      this.pageTableTex[i] = pageTableTex;
    }

    /// atlas
    const data = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
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

    renderer.initTexture(atlasTex);
    this.atlasTex = atlasTex;


    this.tiles = [];
    for (let i = 0; i < MAX_MIP; i++) this.tiles.push([]);

    // -1=not loaded, 0>= where the tile lives)
    this.pagetables = [];
    for (let i = 0; i < MAX_MIP; i++) {
      const tileX = this.TILES_X / 2 ** i;
      const tileY = this.TILES_X / 2 ** i;
      const tiles = new Int32Array(tileX * tileY);
      tiles.fill(-1);
      this.pagetables[i] = tiles;
    }

    this.atlas = [];
    for (let i = 0; i < SLOT_COUNT * SLOT_COUNT; i++) {
      this.atlas[i] = new Slot();
      this.atlas[i].lastUsed = -1;
      this.atlas[i].tileid = -1;
      this.atlas[i].mip = -1;
    }

    /// feedback pass
    this.fbRT = new THREE.WebGLRenderTarget(FEEDBACK_RES, FEEDBACK_RES, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });

    this.readBuf = new Uint8Array(FEEDBACK_RES * FEEDBACK_RES * 4);
    this.mark = [];
    for (let i = 0; i < MAX_MIP; i++) {
      const tileX = this.TILES_X / 2 ** i;
      const tileY = this.TILES_X / 2 ** i;
      this.mark.push(new Uint32Array(tileX * tileY));
    }
    this.renderer = renderer;
  }

  async loadFallbackMip() {
    const mip = this.MAX_MIP - 1;
    const slot = 0;
    const tx = 0;
    const ty = 0;
    const id = 0;

    const newTile = new Tile();
    newTile.state = TileState.loading;
    this.tiles[mip][0] = newTile;
    await this.download_tile(mip, tx, ty).then((data) => {
      newTile.data = data;
      newTile.state = TileState.loaded;
      this.upload_tile(slot, mip, tx, ty, data);
    });

    this.updateLastUsed(slot, 99999);
    this.atlas[slot].tileid = id;
    this.atlas[slot].mip = mip;
    this.pagetables[mip][id] = slot;
  }

  updateLastUsed(s: number, frameID: number) {
    this.atlas[s].lastUsed = frameID;
  }

  findSlot() {
    let sloti = -1;
    let wasEvicted = false;
    for (let i = 0; i < this.atlas.length; i++) {
      if (this.atlas[i].tileid === -1) {
        sloti = i;
        // debugger;
        break;
      }
    }

    // no free slot , evict with lru
    if (sloti == -1) {
      let min = Infinity;
      let minIndex = -1;

      // slot i=0 is reserved for fallback
      for (let i = 1; i < this.atlas.length; i++) {
        if (this.atlas[i].lastUsed < min) {
          min = this.atlas[i].lastUsed;
          minIndex = i;
          wasEvicted = true;
        }
      }

      sloti = minIndex;
    }

    return { sloti, wasEvicted };
  }

  update(frameID: number) {
    // collect unique tile IDs that are requested

    for (let i = 0; i < this.MAX_MIP; i++) {
      this.mark[i].fill(0);
    }

    const requests = [];
    let reqCount = 0;

    for (let i = 0; i < this.readBuf.length; i += 4) {
      const tx = this.readBuf[i];
      const ty = this.readBuf[i + 1];
      const valid = this.readBuf[i + 2];
      const mip = this.readBuf[i + 3];

      if (valid !== 0) {
        const tileX = this.TILES_X / 2 ** mip;
        const id = ty * tileX + tx;
        if (!this.mark[mip][id]) {
          this.mark[mip][id] = 1;
          requests[reqCount++] = { id, mip };
        }
      }
    }

    //  console.warn("requests", requests);

    // check if tile needs uploading and uplaod it to a free slot
    for (let i = 0; i < reqCount; i++) {
      const { id, mip } = requests[i];
      if (this.pagetables[mip][id] !== -1) {
        // already loaded -> touch
        const s = this.pagetables[mip][id];
        if (s >= 0) {
          this.updateLastUsed(s, frameID);
        }
        continue;
      }

      const { sloti: slot, wasEvicted } = this.findSlot();
      // // slot was evicted, update pagetable at id
      if (wasEvicted) {
        console.log("slot was evicted, update pagetable", slot);
        const properties = this.renderer.properties;

        const id = this.atlas[slot].tileid;
        const slotMip = this.atlas[slot].mip;

        const tileX = this.TILES_X / 2 ** slotMip;
        const tx = id % tileX;
        const ty = (id / tileX) | 0;
        //@ts-ignore
        const webglTexture = properties.get(
          this.pageTableTex[slotMip]
          //@ts-ignore
        ).__webglTexture;
        const gl = this.renderer.getContext();
        gl.bindTexture(gl.TEXTURE_2D, webglTexture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          tx,
          ty,
          1,
          1,
          gl.RGBA,
          gl.FLOAT,
          new Float32Array([0, 0, 0, 1])
        );

        this.pagetables[slotMip][id] = -1;
      }

      this.updateLastUsed(slot, frameID);
      this.atlas[slot].tileid = id;
      this.atlas[slot].mip = mip;
      this.pagetables[mip][id] = slot;

      const tileX = this.TILES_X / 2 ** mip;
      const tileY = this.TILES_X / 2 ** mip;

      const tx = id % tileX;
      const ty = (id / tileY) | 0;

      const tile = this.tiles[mip][ty * tileX + tx];
      if (!tile) {
        const newTile = new Tile();
        newTile.state = TileState.loading;
        this.tiles[mip][ty * tileX + tx] = newTile;

        // console.warn("loading slot,mip, tx, ty", slot, mip, tx, ty);
        this.download_tile(mip, tx, ty).then((data) => {
          newTile.data = data;
          newTile.state = TileState.loaded;
          this.upload_tile(slot, mip, tx, ty, data);
        });
      } else if (tile.state === TileState.loaded) {
        this.upload_tile(slot, mip, tx, ty, tile.data);
      }
    }
  }

  upload_tile(
    slot: number,
    mip: number,
    tx: number,
    ty: number,
    tileData: ImageBitmap
  ) {
    const properties = this.renderer.properties;
    //@ts-ignore
    const webglTexture = properties.get(this.atlasTex).__webglTexture;
    const gl = this.renderer.getContext();

    // upload tile to atlas
    gl.bindTexture(gl.TEXTURE_2D, webglTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    let sx = (slot % SLOT_COUNT) * TILE_SIZE_PADDED;
    let sy = ((slot / SLOT_COUNT) | 0) * TILE_SIZE_PADDED;

    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      sx,
      sy,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      tileData
    );

    // update pagetable
    {
      //@ts-ignore
      const webglTexture = properties.get(
        this.pageTableTex[mip]
        //@ts-ignore
      ).__webglTexture;

      gl.bindTexture(gl.TEXTURE_2D, webglTexture);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        tx,
        ty,
        1,
        1,
        gl.RGBA,
        gl.FLOAT,
        new Float32Array([sx / ATLAS_SIZE, sy / ATLAS_SIZE, 1, 1])
      );
      console.log(`pagetable upload  mip=${mip},tx=${tx},ty=${ty},`);
      // ,  [
      //   sx / ATLAS_SIZE,
      //   sy / ATLAS_SIZE,
      //   1,
      //   1,
      // ]);

      // for (let i= 0 ;i<mip ;i++){
      //  if (this.tileToSlot[i]===-1){

      //  }
      // }
    }
  }

  download_tile(mip: number, tx: number, ty: number): Promise<ImageBitmap> {
    const url = `${this.url}/tile_${mip}_${ty}_${tx}.png`;
    const img = fetch(url)
      .then((r) => r.blob())
      .then(createImageBitmap);
    return img;
  }

  clear() {
    this.pageTableTex.forEach((t) => t.dispose());
    this.atlasTex.dispose();
    this.fbRT.dispose();
  }
}
