import PlannerClient from "./planner-client";
import { LocalAccountBoundary } from "@/components/LocalAccountBoundary";

export default function PlannerPage() {
  return <LocalAccountBoundary><PlannerClient /></LocalAccountBoundary>;
}
