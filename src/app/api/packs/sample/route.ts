import { NextResponse } from "next/server";
import { warehouseOpsSample } from "../../../../../content/samples/warehouse-ops";

export function GET() {
  return NextResponse.json({ title: "Warehouse Ops", role: "Operations", gymName: "Warehouse Gym", leaderName: "Foreman Iris", markdown: warehouseOpsSample });
}
