export const runtime = "edge";

async function handler(request: Request) {
  const { getAuth } = await import("@/lib/auth");
  return getAuth().handler(request);
}

export function GET(request: Request) { return handler(request); }
export function POST(request: Request) { return handler(request); }
