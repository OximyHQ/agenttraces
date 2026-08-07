import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { TraceView } from "@/components/trace-view";
import { publicShare } from "@/lib/agenttraces-api";
import { demoTraces, type TraceRecord } from "@/lib/product-data";

export default async function SharedTrace({ params }: { params: Promise<{ token: string }> }) { const { token } = await params; const share = await publicShare(token); if (!share) notFound(); const trace = ("title" in (share.trace as object ?? {}) ? share.trace : demoTraces[0]) as TraceRecord; return <main><div className="shared-frame"><SiteHeader /><div className="share-notice"><span>{share.snapshot ? "Immutable snapshot" : "Live share"}</span><p>{share.snapshot ? "This view preserves the trace exactly as it was shared." : "This view may change as the source trace changes."}</p>{share.preview && <small>Illustrative preview</small>}</div><TraceView trace={{ ...trace, timeline: (share.events as TraceRecord["timeline"] | undefined) ?? trace.timeline }} publicView /></div></main>; }
