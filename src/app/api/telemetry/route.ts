import { NextResponse } from "next/server";
import { getTelemetryData } from "@/lib/telemetry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export async function GET() {
  try {
    const data = await getTelemetryData();
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("Telemetry request failed:", error);
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}
