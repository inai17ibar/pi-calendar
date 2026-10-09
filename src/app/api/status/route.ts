import { apiResponse } from "../../../server/api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function GET(request: Request) { return apiResponse(request, "status"); }
