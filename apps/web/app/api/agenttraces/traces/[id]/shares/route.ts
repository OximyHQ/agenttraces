import { createTraceShare } from "@/lib/agenttraces-api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await createTraceShare(id, await request.json() as Record<string, unknown>);
    if (!result) return Response.json({ error: "Cloud API is not configured" }, { status: 503 });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Share creation failed" }, { status: 502 });
  }
}
