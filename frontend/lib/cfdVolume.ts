import { VTK_MAX_BYTES, VTK_MAX_POINTS } from "./climoptixVTK";

/** A small, ASCII-only structured volume contract for real scalar isosurfaces. */
export function prepareCFDVolume(text: string): string {
  if (new TextEncoder().encode(text).length > VTK_MAX_BYTES ||
      /<!DOCTYPE|<!ENTITY|<AppendedData|compressor\s*=|format\s*=\s*["'](?:binary|appended)["']/i.test(text))
    throw new Error("Use an uncompressed ASCII .vti volume of at most 25 MB.");
  if ((text.match(/<(?![!?/])/g)?.length ?? 0) > 256) throw new Error("Volume XML has too many elements.");
  const doc = new DOMParser().parseFromString(text,"application/xml"), root=doc.documentElement;
  if (doc.getElementsByTagName("parsererror").length || root.tagName!=="VTKFile" || root.getAttribute("type")!=="ImageData")
    throw new Error("Use a VTK ImageData .vti volume.");
  const image=root.getElementsByTagName("ImageData")[0], pieces=root.getElementsByTagName("Piece");
  if (!image || pieces.length!==1) throw new Error("Export one structured volume piece per file.");
  const numbers=(value:string|null,length:number) => {
    const result=(value??"").trim().split(/\s+/).map(Number);
    if (result.length!==length || result.some(n=>!Number.isFinite(n)||!Number.isFinite(Math.fround(n)))) throw new Error("Invalid volume coordinates.");
    return result;
  };
  const extent=numbers(image.getAttribute("WholeExtent"),6), origin=numbers(image.getAttribute("Origin")??"0 0 0",3), spacing=numbers(image.getAttribute("Spacing")??"1 1 1",3);
  if (extent.some(n=>!Number.isSafeInteger(n)) || spacing.some(n=>n<=0) ||
      (image.hasAttribute("Direction") && image.getAttribute("Direction")!.trim().split(/\s+/).map(Number).join(" ")!=="1 0 0 0 1 0 0 0 1"))
    throw new Error("Use a finite, axis-aligned structured volume with positive spacing.");
  const dims=[0,1,2].map(axis=>extent[axis*2+1]-extent[axis*2]+1);
  const points=dims.reduce((a,b)=>a*b,1), cells=dims.reduce((a,b)=>a*(b-1),1);
  if (dims.some(n=>n<2) || points>VTK_MAX_POINTS || cells>VTK_MAX_POINTS || points<8)
    throw new Error("A scalar volume needs 3D extents and at most 250,000 points/cells.");
  const piece=pieces[0];
  if (numbers(piece.getAttribute("Extent"),6).some((v,i)=>v!==extent[i])) throw new Error("Piece extent must match the complete volume.");
  for (let axis=0;axis<3;axis++) for (const index of [extent[axis*2],extent[axis*2+1]])
    if (!Number.isFinite(Math.fround(origin[axis]+index*spacing[axis]))) throw new Error("Volume bounds exceed the renderer range.");
  const clean=document.implementation.createDocument(null,"VTKFile"), output=clean.documentElement;
  output.setAttribute("type","ImageData");output.setAttribute("version","0.1");output.setAttribute("byte_order","LittleEndian");
  const add=(parent:Element,tag:string)=>{const node=clean.createElement(tag);parent.appendChild(node);return node;};
  const target=add(output,"ImageData");target.setAttribute("WholeExtent",extent.join(" "));target.setAttribute("Origin",origin.join(" "));target.setAttribute("Spacing",spacing.join(" "));
  const targetPiece=add(target,"Piece");targetPiece.setAttribute("Extent",extent.join(" "));
  let buffers=0, values=0;
  for (const [tag,tuples] of [["PointData",points],["CellData",cells]] as const) {
    const sources=[...piece.children].filter(node=>node.tagName===tag);
    if (sources.length>1) throw new Error("Duplicate volume data section.");
    const section=add(targetPiece,tag), names=new Set<string>();
    for (const array of sources[0]?.children??[]) {
      const name=array.getAttribute("Name")??"", components=Number(array.getAttribute("NumberOfComponents")??1);
      if (array.tagName!=="DataArray" || !/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(name) || Object.hasOwn(Object.prototype,name) || name==="prototype" || names.has(name) ||
          ++buffers>32 || array.children.length || array.getAttribute("format")!=="ascii" || !["Float32","Float64"].includes(array.getAttribute("type")??"") || !Number.isInteger(components) || components<1 || components>9)
        throw new Error("Unsupported volume array: use uniquely named ASCII Float32/Float64 fields.");
      names.add(name);let count=0;
      for (const token of (array.textContent??"").matchAll(/\S+/g)) {
        if (++count>tuples*components || ++values>4_000_000 || !Number.isFinite(Math.fround(Number(token[0])))) throw new Error("Invalid or oversized volume field array.");
      }
      if (count!==tuples*components) throw new Error("Volume field value count does not match its extent.");
      const item=add(section,"DataArray");item.setAttribute("Name",name);item.setAttribute("type",array.getAttribute("type")!);item.setAttribute("format","ascii");item.setAttribute("NumberOfComponents",String(components));item.textContent=array.textContent;
      if (components===1&&!section.hasAttribute("Scalars")) section.setAttribute("Scalars",name);
    }
  }
  return new XMLSerializer().serializeToString(clean);
}
