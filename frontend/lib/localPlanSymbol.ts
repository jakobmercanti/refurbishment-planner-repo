/** Inert, self-contained catalogue images only; never remote resources or active SVG. */
export function isLocalPlanSymbol(value: string): boolean {
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return true;
  const prefix = "data:image/svg+xml;base64,";
  if (!value.startsWith(prefix) || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.slice(prefix.length))) return false;
  let svg: string;
  try { svg = atob(value.slice(prefix.length)); } catch { return false; }
  if (svg.length > 500000 || /<!|<\?|&(?!(?:amp|lt|gt|quot|apos);)/i.test(svg) || !/^\s*<svg\b/.test(svg) || !/<\/svg>\s*$/.test(svg)) return false;
  const numbers = /^[\d.\s,+-]+$/, colour = /^(none|#[0-9a-fA-F]{3,8}|black|white)$/;
  const numeric = new Set(["viewBox", "stroke-width", "stroke-dasharray", "cx", "cy", "r", "x", "y", "width", "height", "rx", "ry", "font-size"]);
  const enums: Record<string, string[]> = { "stroke-linecap": ["butt", "round", "square"], "stroke-linejoin": ["miter", "round", "bevel"], "text-anchor": ["start", "middle", "end"], "font-family": ["sans-serif", "serif", "monospace"] };
  let end = 0;
  const stack: string[] = [];
  for (const token of svg.matchAll(/<\/?([a-zA-Z]+)\b([^<>]*?)>/g)) {
    if (svg.slice(end, token.index).includes("<")) return false;
    end = token.index! + token[0].length;
    const name = token[1];
    if (!["svg", "g", "rect", "circle", "path", "text"].includes(name)) return false;
    if (token[0].startsWith("</")) { if (token[2].trim() || stack.pop() !== name) return false; continue; }
    if (!stack.length && (name !== "svg" || token.index !== svg.indexOf("<"))) return false;
    let attrs = token[2].replace(/\/\s*$/, "");
    const seen = new Set<string>();
    for (const attr of attrs.matchAll(/\s+([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const key = attr[1], text = attr[2] ?? attr[3];
      if (seen.has(key)) return false; seen.add(key);
      const valid = key === "xmlns" ? name === "svg" && text === "http://www.w3.org/2000/svg"
        : numeric.has(key) ? numbers.test(text) : key === "fill" || key === "stroke" ? colour.test(text)
        : key === "d" ? /^[MmLlHhVvCcSsQqTtAaZzEe\d.\s,+-]+$/.test(text) : enums[key]?.includes(text);
      if (!valid) return false;
    }
    attrs = attrs.replace(/\s+([\w:-]+)\s*=\s*(?:"[^"]*"|'[^']*')/g, "");
    if (attrs.trim()) return false;
    if (!token[0].endsWith("/>")) stack.push(name);
  }
  return !stack.length && !svg.slice(end).trim();
}
