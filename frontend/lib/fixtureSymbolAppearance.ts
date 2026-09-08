/** Colour the existing vector symbol without changing its measured outline. */
export function colouredFixtureSymbol(svg: string, key: string, creative: boolean): string {
  const shower = key.startsWith("shower");
  const cabinet = /vanity|furniture/.test(key);
  const colours = shower ? (creative ? ["#edf5ec", "#b5d2ca"] : ["#edf8f8", "#a7cfda"])
    : cabinet ? (creative ? ["#e8dfcf", "#bfa98b"] : ["#eadcc3", "#bba17c"])
    : creative ? ["#fffaf0", "#d8dace"] : ["#ffffff", "#cedddb"];
  const defs = `<defs><linearGradient id="fixture-material" x2="1" y2="1"><stop stop-color="${colours[0]}"/><stop offset="1" stop-color="${colours[1]}"/></linearGradient></defs>`;
  return svg.replace(/(<svg\b[^>]*>)/, `$1${defs}`)
    .replace(/fill="(?:white|#fff|#ffffff)"/gi, 'fill="url(#fixture-material)"')
    .replace(/stroke="#202724"/g, `stroke="${creative ? "#77796d" : "#526763"}"`)
    .replace(/stroke="#bbb"/g, 'stroke="#92b4b2"')
    .replace(/(<ellipse\b[^>]*?)(\/?>)/g, (match, attrs: string, close: string) => attrs.includes("fill=") ? match : `${attrs} fill="${creative ? "#edf0e4" : "#e2efed"}"${close}`);
}
