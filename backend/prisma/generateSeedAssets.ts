/**
 * Regenerate the committed seed media in prisma/seed-assets from testSets.ts.
 * Run only when a script or icon changes:
 *
 *   npx tsx prisma/generateSeedAssets.ts
 *
 * Needs `edge-tts` (pip install edge-tts), ImageMagick `convert`, and the
 * frontend dependencies installed (Lucide icons, ISC licence).
 *
 * ponytail: TTS drafts stand in for human-recorded prompt audio. Replace a file
 * in seed-assets/audio (same name) with a studio recording when one exists.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TEST_SETS } from "./testSets.js";

const here = dirname(fileURLToPath(import.meta.url));
const audioDir = join(here, "seed-assets/audio");
const iconDir = join(here, "seed-assets/icons");
const lucideIcons = join(here, "../../frontend/node_modules/lucide-react/dist/esm/icons");
const VOICE = "en-US-AvaNeural";

type IconNode = [string, Record<string, string>][];

function svg(node: IconNode) {
  const children = node
    .map(([tag, attrs]) => {
      const rest = Object.entries(attrs).filter(([name]) => name !== "key");
      return `<${tag} ${rest.map(([name, value]) => `${name}="${value}"`).join(" ")}/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1f2a2e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`;
}

mkdirSync(audioDir, { recursive: true });
mkdirSync(iconDir, { recursive: true });

for (const set of TEST_SETS) {
  for (const question of set.questions) {
    const out = join(audioDir, `${set.code}-${question.category}.mp3`);
    if (!existsSync(out)) {
      execFileSync("edge-tts", ["--voice", VOICE, "--text", question.audioScript, "--write-media", out]);
      console.log(`audio ${out}`);
    }
    for (const option of question.options ?? []) {
      const out = join(iconDir, `${option.icon}.png`);
      if (existsSync(out)) continue;
      const { __iconNode } = (await import(pathToFileURL(join(lucideIcons, `${option.icon}.mjs`)).href)) as {
        __iconNode: IconNode;
      };
      const svgPath = join(iconDir, `${option.icon}.svg`);
      writeFileSync(svgPath, svg(__iconNode));
      execFileSync("convert", ["-background", "none", "-density", "768", svgPath, "-resize", "128x128", out]);
      execFileSync("rm", [svgPath]);
      console.log(`icon ${out}`);
    }
  }
}
