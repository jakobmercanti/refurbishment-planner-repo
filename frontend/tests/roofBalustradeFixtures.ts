import { defaultBuilding, duplicateFloor, activeFloor, updateFloor, type FloorOpening } from "../lib/buildingDocument";
import { newProject, parseProject } from "../lib/projectDocument";

const mm=(value:number)=>({value,uncertainty_mm:0,verified:false,source_type:"USER_MEASURED"});
export const stairOpening=():FloorOpening=>({id:"stair-void",name:"Stairwell",shape:"RECTANGLE",vertices:[{x:1200,y:1600},{x:2800,y:1600},{x:2800,y:3600},{x:1200,y:3600}]});
export function roofProject(upper=false) {
  let p=newProject();
  p.rooms=[0,1].map(index=>({id:`room-${index}`,source_floorplan_room_id:`outline-${index}`,name:index?"Study":"Living room",version:1,vertices:[{x:index*4000,y:0},{x:(index+1)*4000,y:0},{x:(index+1)*4000,y:6000},{x:index*4000,y:6000}],wall_height:mm(2400),wall_thickness:mm(100),openings:[],obstacles:[]}));
  const walls=p.rooms.map((room,i)=>({id:`wall-${i}`,points:[...room.vertices,room.vertices[0]]}));
  p.floorplan={walls,rooms:p.rooms.map((room,i)=>({id:room.source_floorplan_room_id!,sourceWallId:walls[i].id,sourceWallIds:[walls[i].id],name:room.name,vertices:room.vertices,colourIndex:i})),openings:[],measurements:[],annotations:[],dimensionOffsets:{},hiddenDimensions:[],canvasSize:{width:1100,height:700},selectedRoomId:"outline-0",wallHeight:2400,wallThickness:100,squaredWalls:true,snapEnabled:false,snapSize:100};
  p.building=defaultBuilding(p);
  if(upper){p=duplicateFloor(p,activeFloor(p).id);p=updateFloor(p,activeFloor(p).id,{name:"Upper floor",openings:[stairOpening()]});}
  return parseProject(p);
}
