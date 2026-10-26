import type vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
import type vtkImageData from "@kitware/vtk.js/Common/DataModel/ImageData";
import type vtkXMLReader from "@kitware/vtk.js/IO/XML/XMLReader";
import { checkVTKText, prepareVTKXML, renderableVTKValues, VTK_MAX_BYTES, VTK_MAX_POINTS } from "./climoptixVTK";
import { prepareCFDVolume } from "./cfdVolume";

export interface ResultField { key:string; name:string; cell:boolean; components:number; range:[number,number]; componentRanges:[number,number][] }
export async function readResultData(file:File) {
  if (file.size>VTK_MAX_BYTES) throw new Error("VTK files must be at most 25 MB.");
  const text=await file.text(), volume=/\.vti$/i.test(file.name), xml=/\.vt[pi]$/i.test(file.name);
  const prepared=volume?{text:prepareCFDVolume(text),warnings:[]}:xml?prepareVTKXML(text):{text:checkVTKText(text,false),warnings:[]};
  const readerModule=volume?await import("@kitware/vtk.js/IO/XML/XMLImageDataReader"):xml?await import("@kitware/vtk.js/IO/XML/XMLPolyDataReader"):await import("@kitware/vtk.js/IO/Legacy/PolyDataReader");
  const reader=readerModule.default.newInstance();
  try {
    if(xml)(reader as vtkXMLReader).parseAsArrayBuffer(new TextEncoder().encode(prepared.text).buffer);
    else if("parseAsText" in reader) reader.parseAsText(prepared.text);
    const data=reader.getOutputData() as vtkPolyData|vtkImageData;
    if (!data || !(data.isA("vtkPolyData")||data.isA("vtkImageData")) || data.getNumberOfPoints()<1 || data.getNumberOfCells()<1)
      throw new Error("No displayable PolyData geometry or structured volume was found.");
    if(data.getNumberOfPoints()>VTK_MAX_POINTS||data.getNumberOfCells()>VTK_MAX_POINTS)throw new Error("VTK geometry exceeds the display limit.");
    if(!volume){
      const poly=data as vtkPolyData;
      if(!renderableVTKValues(poly.getPoints().getData()))throw new Error("VTK coordinates must be finite and within the WebGL numeric range.");
      for(const cells of [poly.getPolys(),poly.getLines(),poly.getStrips(),poly.getVerts()]){
        const values=cells.getData();for(let offset=0;offset<values.length;){const count=values[offset++];
          if(!Number.isInteger(count)||count<1||offset+count>values.length)throw new Error("Invalid VTK cell connectivity.");
          for(let i=0;i<count;i++){const id=values[offset++];if(!Number.isInteger(id)||id<0||id>=data.getNumberOfPoints())throw new Error("VTK cells reference a missing point.");}
        }
      }
    }
    const fields:ResultField[]=[], warnings=[...prepared.warnings];
    for(const cell of [false,true])for(const array of (cell?data.getCellData():data.getPointData()).getArrays()){
      const name=array.getName();
      if(volume&&cell){warnings.push(`${name} (cell-centred volume fields require an explicit point-data export)`);continue;}
      if(array.getNumberOfTuples()!==(cell?data.getNumberOfCells():data.getNumberOfPoints())||!renderableVTKValues(array.getData())){warnings.push(`${name} (invalid value count or values)`);continue;}
      const components=array.getNumberOfComponents(), range=array.getRange(components>1?-1:0);
      if(!renderableVTKValues(range)){warnings.push(`${name} (magnitude range cannot be displayed safely)`);continue;}
      fields.push({key:`${cell?"cell":"point"}:${name}`,name,cell,components,range:[range[0],range[1]],componentRanges:Array.from({length:components},(_,i)=>{const values=array.getRange(i);return [values[0],values[1]];})});
    }
    return {data,volume,fields,warnings,dispose:()=>reader.delete()};
  }catch(error){reader.delete();throw error;}
}
export type ResultData = Awaited<ReturnType<typeof readResultData>>;

/** Slice real grid nodes. No renderer-derived values, guessed units or fabricated fields. */
export async function volumeSlice(image:vtkImageData,axis:number,index:number):Promise<vtkPolyData>{
  const [{default:polyModule},{default:arrayModule}]=await Promise.all([import("@kitware/vtk.js/Common/DataModel/PolyData"),import("@kitware/vtk.js/Common/Core/DataArray")]);
  const extent=image.getExtent(), dims=image.getDimensions(), origin=image.getOrigin(), spacing=image.getSpacing();
  const axes=[0,1,2].filter(a=>a!==axis), a=axes[0],b=axes[1], points:number[]=[], cells:number[]=[], ids:number[]=[];
  const fixed=Math.max(0,Math.min(dims[axis]-1,index));
  for(let v=0;v<dims[b];v++)for(let u=0;u<dims[a];u++){
    const ijk=[0,0,0];ijk[axis]=fixed;ijk[a]=u;ijk[b]=v;
    ids.push(ijk[0]+dims[0]*(ijk[1]+dims[1]*ijk[2]));
    points.push(...ijk.map((value,i)=>origin[i]+(value+extent[i*2])*spacing[i]));
    if(u<dims[a]-1&&v<dims[b]-1){const p=u+dims[a]*v;cells.push(4,p,p+1,p+1+dims[a],p+dims[a]);}
  }
  const poly=polyModule.newInstance();poly.getPoints().setData(Float32Array.from(points),3);poly.getPolys().setData(Uint32Array.from(cells));
  for(const array of image.getPointData().getArrays()){
    const n=array.getNumberOfComponents(),values=new Float32Array(ids.length*n);
    ids.forEach((id,i)=>{for(let c=0;c<n;c++)values[i*n+c]=array.getComponent(id,c);});
    poly.getPointData().addArray(arrayModule.newInstance({name:array.getName(),numberOfComponents:n,values}));
  }
  return poly;
}
