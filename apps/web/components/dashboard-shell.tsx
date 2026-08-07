import Link from "next/link";
import { SiteHeader } from "./site-header";

export function DashboardShell({ children, section, preview = false, workspaceName = "Personal", deviceCount }: { children: React.ReactNode; section: "overview" | "traces" | "pull-requests" | "team"; preview?: boolean; workspaceName?: string; deviceCount?: number }) {
  return (
    <div className="app-frame">
      <a className="skip-link" href="#content">Skip to content</a>
      <SiteHeader app />
      <div className="app-layout">
        <aside className="app-nav" aria-label="Workspace navigation">
          <p className="workspace-name">{workspaceName} <span>⌄</span></p>
          <nav>
            <Link data-current={section === "overview"} href="/dashboard">Overview</Link>
            <Link data-current={section === "traces"} href="/dashboard#latest-traces">Traces</Link>
            <Link data-current={section === "pull-requests"} href="/dashboard/pull-requests">Pull requests</Link>
            <Link data-current={section === "team"} href="/dashboard/team">Team & devices</Link>
          </nav>
          <div className="capture-state"><span aria-hidden="true" />Capture configured<p>{deviceCount == null ? "Device status available in team view" : `${deviceCount} device${deviceCount === 1 ? "" : "s"} registered`}</p></div>
        </aside>
        <main id="content" className="app-main">
          {preview && <div className="preview-banner"><strong>Preview workspace</strong><span>Connect the cloud API to show your team’s traces.</span><Link href="/docs/deployment">Configure →</Link></div>}
          {children}
        </main>
      </div>
    </div>
  );
}
