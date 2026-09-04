import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceUrl = "https://www.dulux.co.uk/en/colour-details/filters";
const outputPath = path.join(projectRoot, "lib", "duluxColours.generated.json");

const families = [
  { id: "WHITE", name: "White", colour: "#DBDBCC", slug: "White" },
  { id: "RED", name: "Red", colour: "#E4032F", slug: "Red" },
  { id: "ORANGE", name: "Orange", colour: "#F28E16", slug: "Orange" },
  { id: "GOLD", name: "Gold", colour: "#FFCD00", slug: "Gold" },
  { id: "YELLOW", name: "Yellow", colour: "#FFEC00", slug: "Yellow" },
  { id: "LIME", name: "Lime", colour: "#B7CE0D", slug: "Lime" },
  { id: "GREEN", name: "Green", colour: "#3F993F", slug: "Green" },
  { id: "TEAL", name: "Teal", colour: "#2FAF9F", slug: "Teal" },
  { id: "BLUE", name: "Blue", colour: "#4376A3", slug: "Blue" },
  { id: "VIOLET", name: "Violet", colour: "#745184", slug: "Violet" },
  { id: "COOL_NEUTRAL", name: "Cool Neutral", colour: "#8F9293", slug: "Cool%20Neutral" },
  { id: "WARM_NEUTRAL", name: "Warm Neutral", colour: "#C1B28B", slug: "Warm%20Neutral" },
];

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function hexToRgb(hex) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToLab({ r, g, b }) {
  const linear = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const x = (linear[0] * 0.4124 + linear[1] * 0.3576 + linear[2] * 0.1805) / 0.95047;
  const y = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  const z = (linear[0] * 0.0193 + linear[1] * 0.1192 + linear[2] * 0.9505) / 1.08883;
  const pivot = (value) => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function colourDistance(first, second) {
  return (first.l - second.l) ** 2 + (first.a - second.a) ** 2 + (first.b - second.b) ** 2;
}

async function loadRalClassic() {
  const source = await readFile(path.join(projectRoot, "node_modules", "ral-colors", "RAL", "classic.js"), "utf8");
  const entries = [];
  const pattern = /RAL(\d{4}):\s*\{\s*description:\s*'([^']+)'[^}]*HEX:\s*'?(#[0-9A-Fa-f]{6})'?/g;
  for (const match of source.matchAll(pattern)) {
    entries.push({ code: `RAL ${match[1]}`, name: match[2].trim(), colour: match[3].toUpperCase(), lab: rgbToLab(hexToRgb(match[3])) });
  }
  if (entries.length < 200) throw new Error(`Expected the RAL Classic collection; found only ${entries.length} entries.`);
  return entries;
}

function closestRal(hex, ralColours) {
  const lab = rgbToLab(hexToRgb(hex));
  return ralColours.reduce((closest, candidate) => colourDistance(lab, candidate.lab) < colourDistance(lab, closest.lab) ? candidate : closest);
}

async function loadFamily(family, ralColours) {
  const url = `${sourceUrl}/h_${family.slug}?showAllColors=true`;
  const response = await fetch(url, { headers: { "User-Agent": "RenovationFit colour catalogue sync" } });
  if (!response.ok) throw new Error(`Dulux returned ${response.status} for ${family.name}.`);
  const html = await response.text();
  const pattern = /<div class="m7-color-card[^>]*data-ccid="([^"]+)"[^>]*data-label="([^"]+)"[^>]*data-hex="(#[0-9A-Fa-f]{6})"/g;
  const shades = [];
  const seen = new Set();
  for (const match of html.matchAll(pattern)) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    const colour = match[3].toUpperCase();
    const ral = closestRal(colour, ralColours);
    shades.push({ id: match[1], name: decodeHtml(match[2]), colour, ralCode: ral.code, ralName: ral.name });
  }
  if (!shades.length) throw new Error(`No colour cards were found for ${family.name}.`);
  return { id: family.id, name: family.name, colour: family.colour, sourceUrl: url, shades };
}

const ralColours = await loadRalClassic();
const catalogue = {
  source: sourceUrl,
  ralReference: "Closest digital match to the RAL Classic RGB reference; not an official Dulux equivalence.",
  families: await Promise.all(families.map((family) => loadFamily(family, ralColours))),
};

await writeFile(outputPath, `${JSON.stringify(catalogue, null, 2)}\n`, "utf8");
console.log(`Saved ${catalogue.families.reduce((total, family) => total + family.shades.length, 0)} Dulux colour entries to ${outputPath}.`);
