import { SUCCESS_CODES } from "../constants";
import type { IRoute } from "../types";

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

export async function createRoute(
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
