/** Bounded ASCII-only result imports. Never execute code or retrieve file/URL references. */
export const VTK_MAX_BYTES = 25 * 1024 * 1024;
export const VTK_MAX_POINTS = 250000;
const INTEGER_LIMITS: Record<string, [number, number]> = {
  Int8: [-128, 127],
  UInt8: [0, 255],
  Int16: [-32768, 32767],
  UInt16: [0, 65535],
  Int32: [-2147483648, 2147483647],
  UInt32: [0, 4294967295],
  Int64: [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  UInt64: [0, Number.MAX_SAFE_INTEGER],
};
function numericValue(token: string, type: string): number {
  const value = Number(token);
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
    throw new Error("non-finite values or outside WebGL numeric range");
  const range = Object.hasOwn(INTEGER_LIMITS, type)
    ? INTEGER_LIMITS[type]
    : undefined;
  if (
    range &&
    (!Number.isSafeInteger(value) || value < range[0] || value > range[1])
  )
    throw new Error("integer value exceeds the declared or safe display range");
  return value;
}

/** The legacy reader splits only on spaces and silently truncates/wraps data.
 * Validate every declared numeric buffer first, normalise whitespace and omit
 * empty cell blocks that would otherwise consume the following section header.
 * Only this in-memory copy changes; original downloads stay byte-for-byte intact.
 */
function checkedLegacy(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/[ \t]+/g, " "));
  const dataset = lines.indexOf("DATASET POLYDATA", 3);
  if (
    !lines[0].startsWith("# vtk DataFile Version") ||
    lines[2] !== "ASCII" ||
    dataset < 0 ||
    lines.slice(3, dataset).some(Boolean)
  )
    throw new Error("Use an ASCII legacy VTK POLYDATA file, or ASCII .vtp.");
  const output = [...lines.slice(0, 3), "DATASET POLYDATA"];
  const integerTypes: Record<string, string> = {
    bit: "UInt8",
    char: "Int8",
    unsigned_char: "UInt8",
    short: "Int16",
    unsigned_short: "UInt16",
    int: "Int32",
    unsigned_int: "UInt32",
    long: "Int32",
    unsigned_long: "UInt32",
  };
  const typeOf = (type: string) => {
    if (type === "float") return "Float32";
    if (type === "double") return "Float64";
    if (Object.hasOwn(integerTypes, type)) return integerTypes[type];
    throw new Error(
      "Unsupported legacy numeric type. Export this result as ASCII .vtp.",
    );
  };
  const bounded = (token: string | undefined, max: number) => {
    const n = Number(token);
    if (!Number.isSafeInteger(n) || n < 0 || n > max)
      throw new Error("VTK geometry or field arrays exceed the display limit.");
    return n;
  };
  let points = 0,
    cells = 0,
    storage = 0,
    arrays = 0,
    tuples = 0;
  let association = "";
  let fieldArrays = 0, associatedField = false, fieldValues = 0;
  const sections = new Set<string>(),
    names = new Set<string>();
  let pending: {
    remaining: number;
    type: string;
    bit: boolean;
    lookup: boolean;
    cells?: number;
    read: number;
    vertices: number;
    skip?: boolean;
  } | null = null;
  for (const line of lines.slice(dataset + 1)) {
    if (!line) continue;
    let append = true;
    const parts = line.split(" "),
      header = parts[0];
    if (pending) {
      append = !pending.skip;
      if (pending.lookup) {
        if (header !== "LOOKUP_TABLE" || parts.length !== 2)
          throw new Error(
            "Legacy SCALARS require LOOKUP_TABLE before their values.",
          );
        pending.lookup = false;
      } else {
        if (parts.length > pending.remaining)
          throw new Error("VTK array value count exceeds its declaration.");
        for (const token of parts) {
          const value = numericValue(token, pending.type);
          if (pending.bit && value > 1)
            throw new Error("Invalid legacy bit value.");
          if (pending.cells !== undefined) {
            if (!pending.vertices) {
              if (value < 1 || !Number.isSafeInteger(value))
                throw new Error("Invalid VTK cell connectivity.");
              pending.vertices = value;
              pending.read++;
            } else {
              if (value < 0 || value >= points)
                throw new Error("VTK cells reference a missing point.");
              pending.vertices--;
            }
          }
        }
        pending.remaining -= parts.length;
        if (!pending.remaining) {
          if (
            pending.vertices ||
            (pending.cells !== undefined && pending.read !== pending.cells)
          )
            throw new Error(
              "VTK cell value count does not match the declared cells.",
            );
          pending = null;
        }
      }
    } else if (fieldArrays > 0) {
      // OpenFOAM's native writer uses FIELD for both global TimeValue metadata
      // and point/cell arrays. Normalize only validated numeric attributes into
      // standard legacy sections; never send generic metadata to vtk.js.
      const name = parts[0], components = bounded(parts[1], 9), count = bounded(parts[2], VTK_MAX_POINTS);
      if (parts.length !== 4 || !components || ++arrays > 64 || name.length > 200 || names.has(name) ||
          Object.hasOwn(Object.prototype, name) || name === "prototype" || (associatedField && count !== tuples))
        throw new Error("Invalid or oversized legacy FIELD array.");
      const type = typeOf(parts[3]); names.add(name); fieldArrays--; append = false;
      fieldValues += count * components;
      if (fieldValues > 4_000_000) throw new Error("VTK fields exceed the four-million-value display limit.");
      if (associatedField) {
        if (components === 3) output.push(`VECTORS ${name} double`);
        else if (components === 9) output.push(`TENSORS ${name} double`);
        else if (components <= 4) output.push(`SCALARS ${name} double ${components}`, "LOOKUP_TABLE default");
        else throw new Error("Use ASCII .vtp for legacy fields with five to eight components.");
      }
      if (count) pending = { remaining: count * components, type, bit: parts[3] === "bit", lookup: false,
        read: 0, vertices: 0, skip: !associatedField };
    } else if (header === "FIELD") {
      if (parts.length !== 3) throw new Error("Invalid legacy FIELD section.");
      fieldArrays = bounded(parts[2], 64); associatedField = !!association; append = false;
    } else if (
      header === "POINTS" ||
      ["VERTICES", "LINES", "POLYGONS", "TRIANGLE_STRIPS"].includes(header)
    ) {
      if (association || sections.has(header))
        throw new Error("Duplicate or misplaced VTK geometry section.");
      sections.add(header);
      const count = bounded(parts[1], VTK_MAX_POINTS);
      if (header === "POINTS") {
        if (!count || parts.length !== 3)
          throw new Error("VTK needs a nonempty point dataset.");
        points = count;
        pending = {
          remaining: count * 3,
          type: typeOf(parts[2]),
          bit: parts[2] === "bit",
          lookup: false,
          read: 0,
          vertices: 0,
        };
      } else {
        const size = bounded(parts[2], VTK_MAX_POINTS * 10);
        storage += size;
        cells += count;
        if (
          !points ||
          parts.length !== 3 ||
          cells > VTK_MAX_POINTS ||
          storage > VTK_MAX_POINTS * 10 ||
          (!count && size)
        )
          throw new Error("Invalid or oversized VTK cell storage.");
        if (!count) continue;
        if (!size) throw new Error("VTK cells need connectivity values.");
        pending = {
          remaining: size,
          type: "UInt32",
          bit: false,
          lookup: false,
          cells: count,
          read: 0,
          vertices: 0,
        };
      }
    } else if (header === "POINT_DATA" || header === "CELL_DATA") {
      if (sections.has(header) || parts.length !== 2)
        throw new Error("Invalid VTK attribute section.");
      sections.add(header);
      association = header;
      names.clear();
      tuples = bounded(parts[1], VTK_MAX_POINTS);
      if (tuples !== (header === "POINT_DATA" ? points : cells))
        throw new Error("VTK field value count does not match geometry.");
    } else if (["SCALARS", "VECTORS", "NORMALS", "TENSORS"].includes(header)) {
      const components =
        header === "SCALARS"
          ? bounded(parts[3] ?? "1", 4)
          : header === "TENSORS"
            ? 9
            : 3;
      if (
        !association ||
        !tuples ||
        !components ||
        ++arrays > 64 ||
        !parts[1] ||
        names.has(parts[1]) ||
        parts[1].length > 200 ||
        Object.hasOwn(Object.prototype, parts[1]) ||
        parts[1] === "prototype" ||
        parts.length < 3 ||
        parts.length > (header === "SCALARS" ? 4 : 3)
      )
        throw new Error("Unsupported or duplicate VTK field array.");
      names.add(parts[1]);
      fieldValues += tuples * components;
      if (fieldValues > 4_000_000) throw new Error("VTK fields exceed the four-million-value display limit.");
      pending = {
        remaining: tuples * components,
        type: typeOf(parts[2]),
        bit: parts[2] === "bit",
        lookup: header === "SCALARS",
        read: 0,
        vertices: 0,
      };
    } else {
      throw new Error(
        "Unsupported legacy section " +
          header.slice(0, 60) +
          ". Export this result as ASCII .vtp.",
      );
    }
    if (append) output.push(line);
  }
  if (pending || fieldArrays)
    throw new Error(
      "Incomplete VTK array: value count does not match its declaration.",
    );
  if (!points || !cells)
    throw new Error("VTK needs a nonempty point/cell dataset.");
  return output.join("\n");
}
/** WebGL uses float32 even when a VTK file stores float64. Do not render infinities. */
export function renderableVTKValues(values: ArrayLike<number>): boolean {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i]) || !Number.isFinite(Math.fround(values[i])))
      return false;
  }
  return true;
}

/** Validate ASCII XML before vtk.js can pad missing data or allocate from offsets.
 * Only a canonical numeric PolyData tree reaches the third-party reader. The
 * original File is never changed and remains available for lossless download.
 */
export function prepareVTKXML(text: string): {
  text: string;
  warnings: string[];
} {
  checkVTKText(text, true);
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.getElementsByTagName("parsererror").length)
    throw new Error("The VTK XML is malformed.");
  const root = document.documentElement;
  if (root.tagName !== "VTKFile" || root.getAttribute("type") !== "PolyData")
    throw new Error("Only VTK PolyData files are supported.");
  const children = (parent: Element, tag: string) =>
    Array.from(parent.children).filter((el) => el.tagName === tag);
  const one = (parent: Element, tag: string): Element => {
    const found = children(parent, tag);
    if (found.length !== 1)
      throw new Error(`VTK requires exactly one ${tag} element.`);
    return found[0];
  };
  const source = one(one(root, "PolyData"), "Piece");
  const count = (name: string) => {
    const n = Number(source.getAttribute(`NumberOf${name}`) ?? 0);
    if (!Number.isSafeInteger(n) || n < 0 || n > VTK_MAX_POINTS)
      throw new Error("VTK geometry exceeds the display limit.");
    return n;
  };
  const points = count("Points"),
    cellKinds = ["Verts", "Lines", "Strips", "Polys"] as const;
  const cells = cellKinds.reduce((sum, kind) => sum + count(kind), 0);
  if (!points || !cells || cells > VTK_MAX_POINTS)
    throw new Error("VTK needs a bounded, nonempty point/cell dataset.");
  const clean = document.implementation.createDocument(null, "VTKFile");
  clean.documentElement.setAttribute("type", "PolyData");
  clean.documentElement.setAttribute("version", "0.1");
  clean.documentElement.setAttribute("byte_order", "LittleEndian");
  const add = (parent: Element, tag: string) => {
    const el = clean.createElement(tag);
    parent.appendChild(el);
    return el;
  };
  const piece = add(add(clean.documentElement, "PolyData"), "Piece");
  for (const kind of ["Points", ...cellKinds])
    piece.setAttribute(`NumberOf${kind}`, String(count(kind)));
  const warnings: string[] = [];
  const array = (
    input: Element,
    expected: number,
    components: number,
    onValue?: (n: number) => void,
  ): Element => {
    const type = input.getAttribute("type") ?? "";
    if (
      input.children.length ||
      input.getAttribute("format") !== "ascii" ||
      Number(input.getAttribute("NumberOfComponents") ?? 1) !== components ||
      !(
        Object.hasOwn(INTEGER_LIMITS, type) ||
        type === "Float32" ||
        type === "Float64"
      )
    )
      throw new Error("unsupported numeric array format");
    const contents = input.textContent ?? "";
    let read = 0;
    for (const token of contents.matchAll(/\S+/g)) {
      if (++read > expected)
        throw new Error("value count does not match the geometry");
      const value = numericValue(token[0], type);
      onValue?.(value);
    }
    if (read !== expected)
      throw new Error("value count does not match the geometry");
    const output = clean.createElement("DataArray");
    // vtk.js maps 64-bit ASCII integers to 32-bit arrays. Preserve exact, safe
    // integers as doubles instead of silently wrapping them during decoding.
    output.setAttribute(
      "type",
      type === "Int64" || type === "UInt64" ? "Float64" : type,
    );
    output.setAttribute("format", "ascii");
    output.setAttribute("NumberOfComponents", String(components));
    if (input.hasAttribute("Name"))
      output.setAttribute("Name", input.getAttribute("Name")!);
    output.textContent = contents;
    return output;
  };
  try {
    add(piece, "Points").appendChild(
      array(one(one(source, "Points"), "DataArray"), points * 3, 3),
    );
  } catch (e) {
    throw new Error(
      `VTK coordinates: ${e instanceof Error ? e.message : "invalid data"}.`,
    );
  }
  let totalConnectivity = 0;
  for (const kind of cellKinds) {
    const n = count(kind);
    if (!n) continue;
    const container = one(source, kind),
      arrays = children(container, "DataArray");
    const named = (name: string) => {
      const found = arrays.filter((el) => el.getAttribute("Name") === name);
      if (found.length !== 1)
        throw new Error("VTK cell offsets and connectivity must be unique.");
      return found[0];
    };
    let last = 0;
    const offsets = array(named("offsets"), n, 1, (offset) => {
      if (
        !Number.isSafeInteger(offset) ||
        offset <= last ||
        offset > VTK_MAX_POINTS * 10
      )
        throw new Error(
          "VTK cell offsets exceed the connectivity limit or are not increasing",
        );
      last = offset;
    });
    totalConnectivity += last;
    if (totalConnectivity > VTK_MAX_POINTS * 10)
      throw new Error("VTK connectivity exceeds the display limit.");
    const connectivity = array(named("connectivity"), last, 1, (id) => {
      if (!Number.isSafeInteger(id) || id < 0 || id >= points)
        throw new Error("VTK cells reference a missing point");
    });
    const output = add(piece, kind);
    output.appendChild(offsets);
    output.appendChild(connectivity);
  }
  for (const [tag, tuples] of [
    ["PointData", points],
    ["CellData", cells],
  ] as const) {
    const containers = children(source, tag);
    if (containers.length > 1)
      throw new Error(`VTK requires at most one ${tag} element.`);
    if (!containers.length) continue;
    const output = add(piece, tag),
      names = new Set<string>();
    for (const input of children(containers[0], "DataArray")) {
      const name = input.getAttribute("Name") ?? "";
      try {
        if (
          !name.trim() ||
          name.length > 200 ||
          Object.hasOwn(Object.prototype, name) ||
          name === "prototype" ||
          names.has(name)
        )
          throw new Error("missing, duplicate or unsupported field name");
        const components = Number(
          input.getAttribute("NumberOfComponents") ?? 1,
        );
        if (!Number.isInteger(components) || components < 1 || components > 9)
          throw new Error("unsupported component count");
        output.appendChild(array(input, tuples * components, components));
        names.add(name);
      } catch (e) {
        warnings.push(
          `${name.slice(0, 200) || "Unnamed field"} (${e instanceof Error ? e.message : "invalid array"})`,
        );
      }
    }
    for (const attr of [
      "Scalars",
      "Vectors",
      "Normals",
      "Tensors",
      "TCoords",
    ]) {
      const name = containers[0].getAttribute(attr);
      if (name && names.has(name)) output.setAttribute(attr, name);
    }
  }
  // String FieldData parsing can loop on missing terminators; it is metadata,
  // not a point/cell result. Never send it to vtk.js' generic XML reader.
  if (root.getElementsByTagName("FieldData").length)
    warnings.push("FieldData metadata (not rendered)");
  return { text: new XMLSerializer().serializeToString(clean), warnings };
}
export function checkVTKText(text: string, xml: boolean): string {
  if (new TextEncoder().encode(text).byteLength > VTK_MAX_BYTES)
    throw new Error("VTK files must be at most 25 MB.");
  if (
    /<!DOCTYPE|<!ENTITY|<AppendedData|compressor\s*=|format\s*=\s*["'](?:binary|appended)["']/i.test(
      text,
    )
  )
    throw new Error(
      "Use an uncompressed ASCII VTK surface/slice export, not binary, appended or compressed data.",
    );
  if (xml) {
    // Bound tree complexity before DOMParser, including unsupported metadata.
    const starts = /<(?![!?/])/g;
    let elements = 0;
    while (starts.exec(text)) {
      if (++elements > 1024)
        throw new Error("VTK XML exceeds the 1,024-element display limit.");
    }
    if (!/<VTKFile\b[^>]*\btype\s*=\s*["']PolyData["']/i.test(text))
      throw new Error(
        "Only VTK PolyData (.vtp) surfaces/slices are supported.",
      );
    const pieces = [...text.matchAll(/<Piece\b([^>]*)>/gi)];
    if (pieces.length !== 1)
      throw new Error("Export one PolyData piece per file.");
    for (const match of text.matchAll(
      /\bNumberOf(?:Points|Verts|Lines|Strips|Polys)\s*=\s*["']([^"']+)["']/gi,
    )) {
      const n = Number(match[1]);
      if (!Number.isSafeInteger(n) || n < 0 || n > VTK_MAX_POINTS)
        throw new Error(
          "VTK geometry exceeds the 250,000-point/cell display limit.",
        );
    }
    if ((text.match(/<DataArray\b/g) ?? []).length > 64)
      throw new Error("Too many VTK arrays (maximum 64).");
    for (const match of text.matchAll(
      /\bNumberOfComponents\s*=\s*["']([^"']+)["']/gi,
    )) {
      if (
        !Number.isSafeInteger(Number(match[1])) ||
        Number(match[1]) < 1 ||
        Number(match[1]) > 9
      )
        throw new Error("Unsupported VTK array component count.");
    }
  } else {
    return checkedLegacy(text);
  }
  return text;
}
