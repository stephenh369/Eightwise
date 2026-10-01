import type { Connect } from "vite";
import { defineConfig, loadEnv } from "vite";
import { handleAskRequest } from "./server/ask";

function readJsonBody(
  req: Connect.IncomingMessage,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text) as unknown);
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = env.TYPESAFE_API_KEY;

  return {
    plugins: [
      {
        name: "eightwise-api",
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url !== "/api/ask" || req.method !== "POST") {
              next();
              return;
            }

            try {
              const body = await readJsonBody(req);
              const result = await handleAskRequest(body, apiKey);
              res.statusCode = result.status;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(result.body));
            } catch {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "invalid_body" }));
            }
          });
        },
      },
    ],
  };
});
