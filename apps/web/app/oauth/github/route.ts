import { getAuth } from "@/lib/auth";

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const callback = new URL("/api/auth/callback/github", incoming.origin);
  callback.search = incoming.search;

  return getAuth().handler(new Request(callback, {
    method: "GET",
    headers: request.headers,
    redirect: "manual",
  }));
}
