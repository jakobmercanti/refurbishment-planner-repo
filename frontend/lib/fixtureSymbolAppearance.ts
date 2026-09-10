type Rgb = [number, number, number];

function parseColour(value?: string): Rgb | null {
  const match = /^#([\da-f]{6})$/i.exec(value ?? "");
  if (!match) return null;
  return [Number.parseInt(match[1].slice(0, 2), 16), Number.parseInt(match[1].slice(2, 4), 16), Number.parseInt(match[1].slice(4, 6), 16)];
}

function mixColour(source: Rgb, target: Rgb, amount: number): string {
  const rgb = source.map((channel, index) => Math.round(channel + (target[index] - channel) * amount));
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** Colour the existing vector symbol without changing its measured outline. */
export function colouredFixtureSymbol(svg: string, key: string, creative: boolean, actualColour?: string): string {
  const shower = key.startsWith("shower");
  const cabinet = /vanity|furniture/.test(key);
  const base = parseColour(actualColour);
  const colours = base
    ? [mixColour(base, [255, 255, 255], creative ? .42 : .28), mixColour(base, [0, 0, 0], creative ? .25 : .18)]
    : shower ? (creative ? ["#edf5ec", "#b5d2ca"] : ["#edf8f8", "#a7cfda"])
      : cabinet ? (creative ? ["#e8dfcf", "#bfa98b"] : ["#eadcc3", "#bba17c"])
      : creative ? ["#fffaf0", "#d8dace"] : ["#ffffff", "#cedddb"];
  const defs = `<defs><linearGradient id="fixture-material" x2="1" y2="1"><stop stop-color="${colours[0]}"/><stop offset="1" stop-color="${colours[1]}"/></linearGradient></defs>`;
  return svg.replace(/(<svg\b[^>]*>)/, `$1${defs}`)
    .replace(/fill="(?:white|#fff|#ffffff)"/gi, 'fill="url(#fixture-material)"')
    .replace(/stroke="#202724"/g, `stroke="${creative ? "#77796d" : "#526763"}"`)
    .replace(/stroke="#bbb"/g, 'stroke="#92b4b2"')
    .replace(/(<ellipse\b[^>]*?)(\/?>)/g, (match, attrs: string, close: string) => attrs.includes("fill=") ? match : `${attrs} fill="${creative ? "#edf0e4" : "#e2efed"}"${close}`);
}
