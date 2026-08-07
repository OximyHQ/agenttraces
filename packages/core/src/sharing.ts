export function traceSlug(title: string) {
  const value = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");
  return value || "trace";
}

export function sharePath(title: string, token: string) {
  return `/t/${traceSlug(title)}/${token}`;
}

export function shareToken(pathSegment: string) {
  return pathSegment.split("/").filter(Boolean).at(-1) ?? pathSegment;
}
