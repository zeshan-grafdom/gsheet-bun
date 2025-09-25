export const CORE_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

export function jsonResponse(body: any, init?: ResponseInit): Response {
  const headers = {
    ...(init?.headers as Record<string, string>),
    ...CORE_HEADERS,
  };
  const status = init?.status ?? 200;
  return new Response(JSON.stringify(body), { status, headers });
}
