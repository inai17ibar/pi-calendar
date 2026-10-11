import { apiPost } from "../../../../server/api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function POST(request: Request) { return apiPost(request, "cache/request-month"); }
