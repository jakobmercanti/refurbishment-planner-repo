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
