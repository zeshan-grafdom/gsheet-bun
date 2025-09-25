import { serve } from "bun";
import { GoogleSheetsService } from "./src/sheets/service";
import { router } from "./src/sheets/router";

const sheetsService = GoogleSheetsService.getInstance();
await sheetsService.warmup();

const server = serve({
  port: process.env.PORT || 8000,
  async fetch(req) {
    const url = new URL(req.url);

    const response = await router(req, url);
    return response;
  },
});

console.log(`Bun server running on http://localhost:${server.port}`);
