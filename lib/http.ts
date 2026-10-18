/** Réponses JSON standardisées des API. */
export function json(data: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export function jsonError(
  error: string,
  status: number,
  extra?: Record<string, unknown>,
): Response {
  return json({ error, ...extra }, status);
}
