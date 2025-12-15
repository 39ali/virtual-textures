import sharp from "sharp";
import fs from "fs-extra";
import path from "path";

async function isResolved<T>(p: Promise<T>) {
  let resolved = false;
  p.then(() => (resolved = true)).catch(() => (resolved = true));
  await Promise.race([p, new Promise((r) => setTimeout(r, 0))]);
  return resolved;
}

interface TileOptions {
  inputFile: string;
  tileSize: number;
  padding: number;
  outputDir: string;
}

export async function exportTiles(options: TileOptions) {
  const { tileSize, padding, outputDir, inputFile } = options;

  await fs.ensureDir(outputDir);

  sharp.concurrency(7);
  sharp.simd(true);
  sharp.cache(false);

  let image = sharp(inputFile, { limitInputPixels: false });

  const meta = await image.metadata();

  if (!meta.width || !meta.height) throw new Error("Invalid image dimensions.");

  let width = meta.width;
  // const height = meta.height;
  const tasks: Promise<any>[] = [];

  let mipi = -1;
  for (; width >= tileSize; width /= 2) {
    mipi++;

    const tilesX = Math.ceil(width / tileSize);
    const tilesY = Math.ceil(width / tileSize);

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const extractLeft = tx * tileSize;
        const extractTop = ty * tileSize;

        const file = `tile_${mipi}_${ty}_${tx}.png`;
        const tilePath = path.join(outputDir, file);

        tasks.push(
          image
            .clone()
            .resize(width, width)
            .extract({
              left: extractLeft,
              top: extractTop,
              width: tileSize,
              height: tileSize,
            })
            .extend({
              top: padding,
              bottom: padding,
              left: padding,
              right: padding,
              extendWith: "copy", // duplicate edge pixels
            })
            .flip()
            .png({ compressionLevel: 0 })
            .toFile(tilePath)
            .then(() => {
              console.warn(`exported ${file}`);
            })
        );
      }
    }
  }

  await Promise.allSettled(tasks);
  console.log("Done.");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {} as TileOptions;

  for (let i = 0; i < args.length; i++) {
    const key = args[i];

    if (key === "--input") config.inputFile = args[++i];
    else if (key === "--out") config.outputDir = args[++i];
    else if (key === "--tile") config.tileSize = parseInt(args[++i], 10);
    else if (key === "--pad") config.padding = parseInt(args[++i], 10);
  }

  return config;
}

async function main() {
  const cfg = parseArgs();

  if (!cfg.inputFile || !cfg.outputDir) {
    console.log(`Usage:
  tile-export --input image.tif --out tiles/ --tile 256 --pad 8
`);
    process.exit(1);
  }

  await exportTiles(cfg);
}

main();
