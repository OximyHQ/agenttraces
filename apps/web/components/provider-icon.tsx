import { siClaude, siCursor, siGithubcopilot, siGoogle, siOpenai, type SimpleIcon } from "simple-icons";

const providers: Array<{ match: RegExp; icon: SimpleIcon }> = [
  { match: /claude|anthropic/i, icon: siClaude },
  { match: /codex|openai/i, icon: siOpenai },
  { match: /cursor/i, icon: siCursor },
  { match: /copilot|github/i, icon: siGithubcopilot },
  { match: /antigravity|gemini|google/i, icon: siGoogle },
];

export function ProviderIcon({ source, className = "provider-icon" }: { source: string; className?: string }) {
  const provider = providers.find(({ match }) => match.test(source));
  if (provider) return <svg className={className} viewBox="0 0 24 24" role="img" aria-label={`${source} provider`}><path fill="currentColor" d={provider.icon.path} /></svg>;
  return <svg className={className} viewBox="0 0 24 24" role="img" aria-label={`${source} source`}><path d="M5.5 7.5h13v9h-13zM8 10l2 2-2 2m4.5 0h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function ProviderLabel({ source }: { source: string }) {
  return <span className="provider-label"><ProviderIcon source={source} /><span>{source}</span></span>;
}
