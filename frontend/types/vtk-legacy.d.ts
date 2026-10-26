declare module "@kitware/vtk.js/IO/Legacy/PolyDataReader" {
  import type { vtkObject } from "@kitware/vtk.js/interfaces";
  import type vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
  interface Reader extends vtkObject {
    parseAsText(text: string): void;
    getOutputData(): vtkPolyData;
  }
  const factory: { newInstance(): Reader };
  export default factory;
}
declare module "@kitware/vtk.js/Rendering/Profiles/Geometry" {}
declare module "@kitware/vtk.js/Filters/General/ImageMarchingCubes" {
  import type { vtkObject } from "@kitware/vtk.js/interfaces";
  import type vtkImageData from "@kitware/vtk.js/Common/DataModel/ImageData";
  import type vtkPolyData from "@kitware/vtk.js/Common/DataModel/PolyData";
  interface Filter extends vtkObject {
    setInputData(data:vtkImageData):void; setContourValue(value:number):void;
    getOutputData():vtkPolyData; update():void;
  }
  const factory:{newInstance(values?:{contourValue?:number;computeNormals?:boolean;mergePoints?:boolean}):Filter};
  export default factory;
}
