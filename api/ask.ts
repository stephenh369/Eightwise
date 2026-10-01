import { handleAskRequest } from "../server/ask";

export const config = {
  runtime: "edge",
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = process.env.TYPESAFE_API_KEY;
  const result = await handleAskRequest(body, apiKey);

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
}
