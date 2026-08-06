import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { SignInForm } from "@/components/sign-in-form";

export default function SignInPage() { return <main><div className="page-frame"><SiteHeader /><div className="auth-layout"><section><p className="context-line">Account</p><h1>Claim your traces and continue.</h1><p className="intro">Sign in to connect devices, create a team, and see the coding sessions behind your pull requests.</p><SignInForm /></section><aside><h2>Started from the CLI?</h2><p>Your device identity already protects captured sessions. Sign in with the same email you used with <code>agenttraces login</code> to claim them.</p><Link href="/docs/quickstart">Read how claiming works →</Link></aside></div></div></main>; }
