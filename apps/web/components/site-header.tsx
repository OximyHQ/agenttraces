import Link from "next/link";

export function SiteHeader({ app = false }: { app?: boolean }) {
  return (
    <header className={app ? "app-header" : "site-header"}>
      <Link className="wordmark" href="/" aria-label="AgentTraces home">agenttraces</Link>
      <nav aria-label="Primary navigation">
        <Link href="/docs">Docs</Link>
        <a href="https://github.com/OximyHQ/agenttraces">GitHub</a>
        {app ? <Link href="/dashboard/team">Team</Link> : <Link href="/sign-in">Sign in</Link>}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return <footer><span>AgentTraces</span><nav aria-label="Footer navigation"><Link href="/docs">Docs</Link><a href="https://github.com/OximyHQ/agenttraces">GitHub</a><a href="https://www.npmjs.com/package/agenttraces">npm</a></nav></footer>;
}
