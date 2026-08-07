import { DashboardShell } from "@/components/dashboard-shell";
import { TraceView } from "@/components/trace-view";
import { trace } from "@/lib/agenttraces-api";

export default async function TracePage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; const data = await trace(id); return <DashboardShell section="traces" preview={data.preview}><TraceView trace={data.record} preview={data.preview} /></DashboardShell>; }
