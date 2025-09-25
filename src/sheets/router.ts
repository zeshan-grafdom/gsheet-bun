import { readSheet, updateSheet, createRow } from "./controllers";
import { CORE_HEADERS, createRoute, jsonResponse } from "../utils/index";

export async function router(req: Request, url: URL): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORE_HEADERS });
  }

  const createRowRoute = await createRoute(
    "POST",
    "/api/:spreadsheetId",
    req,
    url,
    async (route) => {
      const spreadsheetId = route.params["spreadsheetId"];
      return await createRow(req, spreadsheetId!, url.searchParams);
    }
  );

  if (createRowRoute) {
    return createRowRoute;
  }

  const updateRoute = await createRoute(
    "PUT",
    "/api/:spreadsheetId",
    req,
    url,
    async (route) => {
      const spreadsheetId = route.params["spreadsheetId"];
      return await updateSheet(req, spreadsheetId!, url.searchParams);
    }
  );

  if (updateRoute) {
    return updateRoute;
  }

  const readRoute = await createRoute(
    "POST",
    "/api/:spreadsheetId/read",
    req,
    url,
    async (route) => {
      const spreadsheetId = route.params["spreadsheetId"];
      return await readSheet(req, spreadsheetId!, url.searchParams);
    }
  );

  if (readRoute) {
    return readRoute;
  }

  // No routes matched
  return jsonResponse({ error: "Not found" }, { status: 404 });
}
