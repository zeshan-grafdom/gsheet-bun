import { validateData, validateSheet } from "./dto";
import { FiltersService } from "./filters";
import { GoogleSheetsService, type SheetQueryOptions } from "./service";
import { jsonResponse } from "../utils/index";

const sheetsService = GoogleSheetsService.getInstance();
const filtersService = new FiltersService();

export async function readSheet(
  req: Request,
  spreadsheetId: string,
  searchParams: URLSearchParams
) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const sheetName = validateSheet(searchParams);
    let rows: any = await sheetsService.readValues(spreadsheetId, sheetName);
    if (!rows.length) {
      return jsonResponse(
        { error: "Sheet appears empty or unreadable" },
        { status: 400 }
      );
    }

    const headers = rows[0];
    rows = sheetsService.normalizeRows(headers!, rows.slice(1));
    rows = filtersService.applyFilters(rows, body.where);
    const rawOptions = body.options as SheetQueryOptions | undefined;
    rows = sheetsService.applyOptions(rows, rawOptions);

    const response = {
      sheet: sheetName,
      headers,
      rows,
    };

    return response;
  } catch (error: any) {
    throw error;
  }
}

export async function updateSheet(
  req: Request,
  spreadsheetId: string,
  searchParams: URLSearchParams
) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const sheetName = validateSheet(searchParams);
    const data = validateData(body.data);

    const where = body.where;
    const updateAll = searchParams.get("multiple")?.toLowerCase() === "true";
    const upsert = searchParams.get("upsert")?.toLowerCase() === "true";

    const result = await sheetsService.updateRows(
      spreadsheetId,
      sheetName,
      where,
      data,
      updateAll
    );

    let appended = 0;
    if (result.updated === 0 && upsert) {
      const appendRes = await sheetsService.appendRow(
        spreadsheetId,
        sheetName,
        data
      );
      appended = appendRes.appended;
    }

    const response = {
      sheet: sheetName,
      updated: result.updated,
      appended,
    };

    return response;
  } catch (error: any) {
    throw error;
  }
}

export async function createRow(
  req: Request,
  spreadsheetId: string,
  searchParams: URLSearchParams
): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const sheetName = validateSheet(searchParams);
    const data = validateData(body);

    const result = await sheetsService.appendRow(
      spreadsheetId,
      sheetName,
      data
    );

    const response = {
      sheet: sheetName,
      message: "Row appended",
    };

    return jsonResponse(response, { status: 201 });
  } catch (error: any) {
    const status = error?.status ?? 400;
    return jsonResponse(
      { error: error?.message ?? String(error), status },
      { status }
    );
  }
}
