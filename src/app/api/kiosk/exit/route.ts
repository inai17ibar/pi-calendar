import { apiPost, apiResponse } from "../../../../server/api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function GET(request: Request) { return apiResponse(request, "kiosk/exit"); }
export function POST(request: Request) { return apiPost(request, "kiosk/exit"); }
