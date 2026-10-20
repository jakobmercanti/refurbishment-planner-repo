import { z } from "zod";

const finite = z.number().finite();
const vertex = z.tuple([finite, finite, finite]);
const index = z.number().int().nonnegative();
const schema = z.object({
  version: z.literal(1),
  geometry_revision: z.number().int().positive().optional(),
  units: z.literal("mm"),
  profile: z.string().min(1).max(60),
  label: z.string().min(1).max(200),
  dimensions_mm: z.tuple([finite.min(.001).max(20000), finite.min(.001).max(20000), finite.min(.001).max(20000)]),
  vertices_mm: z.array(vertex).min(4).max(5000),
  triangles: z.array(z.tuple([index, index, index])).min(4).max(10000),
  assumptions: z.array(z.string().max(500)).max(12),
}).superRefine((mesh, context) => {
  if (mesh.triangles.some(face => new Set(face).size !== 3 || face.some(i => !Number.isInteger(i) || i < 0 || i >= mesh.vertices_mm.length))) {
    context.addIssue({ code: "custom", message: "Invalid CFD triangle indices" });
    return;
  }
  if (mesh.vertices_mm.some(point => point.some((value, axis) => value < 0 || value > mesh.dimensions_mm[axis] + 1e-7)))
    context.addIssue({ code: "custom", message: "CFD vertices exceed catalogue dimensions" });
  const edges = new Map<string, { count: number; balance: number }>();
  let volume6 = 0;
  for (const face of mesh.triangles) {
    const [a, b, c] = face.map(i => mesh.vertices_mm[i]);
    const ab = b.map((v,i) => v-a[i]), ac = c.map((v,i) => v-a[i]);
    const cross = ab.map((_,i) => ab[(i+1)%3]*ac[(i+2)%3]-ab[(i+2)%3]*ac[(i+1)%3]);
    if (!cross.some(v => v !== 0)) context.addIssue({ code: "custom", message: "Degenerate CFD triangle" });
    volume6 += a.reduce((sum,v,i) => sum+v*(b[(i+1)%3]*c[(i+2)%3]-b[(i+2)%3]*c[(i+1)%3]),0);
    for (let i=0;i<3;i++) {
      const u=face[i],v=face[(i+1)%3],key=u<v?`${u}:${v}`:`${v}:${u}`,edge=edges.get(key)??{count:0,balance:0};
      edge.count++;edge.balance+=u<v?1:-1;edges.set(key,edge);
    }
  }
  if (!(volume6 > 0) || [...edges.values()].some(edge => edge.count !== 2 || edge.balance !== 0))
    context.addIssue({ code: "custom", message: "CFD surface must be closed with outward winding" });
});

export type CfdMesh = z.infer<typeof schema>;
export function parseCfdMesh(value: unknown): CfdMesh { return schema.parse(value); }
