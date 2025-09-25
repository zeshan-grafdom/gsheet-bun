import { readSheet, updateSheet, createRow } from "./controllers";
import { CORE_HEADERS, jsonResponse } from "../utils/index";

let count = 0;

export async function router(req: Request, url: URL): Promise<Response> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORE_HEADERS });
  }

  console.log("Count:", ++count);

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

  // Try second route: PUT /api/sheets/:spreadsheetId
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

  // Create row route: POST /api/:spreadsheetId/rows

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

function extractPathParams(
  pattern: string,
  path: string
): Record<string, string> | null {
  const paramNames: string[] = [];
  const regexPattern = pattern.replace(/:([^/]+)/g, (_, paramName) => {
    paramNames.push(paramName);
    return "([^/]+)";
  });

  const regex = new RegExp(`^${regexPattern}$`);
  const match = path.match(regex);

  if (!match) {
    return null;
  }

  const params: Record<string, string> = {};
  paramNames.forEach((name, index) => {
    params[name] = match[index + 1] || "";
  });

  return params;
}

async function createRoute(
  method: string,
  path: string,
  req: Request,
  url: URL,
  handler: (req: IRoute) => Promise<Response | Record<string, any>>
): Promise<Response | null> {
  try {
    if (req.method !== method) {
      return null;
    }

    const params = extractPathParams(path, url.pathname);
    if (!params) {
      return null;
    }

    const handlerResult = await handler({ params });
    if (handlerResult instanceof Response) {
      return handlerResult;
    }

    const successCode =
      SUCCESS_CODES[method as keyof typeof SUCCESS_CODES] || 200;

    return jsonResponse(handlerResult, { status: successCode });
  } catch (error: any) {
    const errorStatus = error?.["status"] ?? 500;
    const errorMessage = error?.["message"] ?? "Unexpected Error Occurred";

    return jsonResponse(
      {
        message: errorMessage,
        status: errorStatus,
      },
      {
        status: errorStatus,
      }
    );
  }
}

interface IRoute {
  params: Record<string, string>;
}

const SUCCESS_CODES = {
  GET: 200,
  POST: 201,
  PUT: 200,
  DELETE: 204,
};
