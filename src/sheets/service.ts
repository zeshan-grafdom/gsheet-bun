import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";
import Fuse from "fuse.js";
import { FiltersService } from "./filters";

type RowDict = Record<string, any>;
type CacheKey = string;
type CacheEntry = { timestamp: number; data: string[][] };
export type SearchOptions = {
  term: string;
  keys?: string[];
  threshold?: number;
  limit?: number;
  minMatchCharLength?: number;
};

export type SheetQueryOptions = {
  uniqueBy?: string | string[];
  search?: SearchOptions;
};

export class GoogleSheetsService {
  private static instance: GoogleSheetsService;
  private sheetsApi: sheets_v4.Sheets | null = null;
  private credentials: any = null;
  private readCache = new Map<CacheKey, CacheEntry>();
  private inflightReads = new Map<CacheKey, Promise<string[][]>>();
  private readonly CACHE_TTL: number =
    parseInt(process.env.CACHE_TTL_MS || "10000") || 10000; // default 10s
  private readonly CACHE_MAX_ENTRIES: number =
    parseInt(process.env.CACHE_MAX_ENTRIES || "200") || 200; // cap entries for memory
  private filtersService = new FiltersService();

  private constructor() {}

  static getInstance(): GoogleSheetsService {
    if (!GoogleSheetsService.instance) {
      GoogleSheetsService.instance = new GoogleSheetsService();
    }
    return GoogleSheetsService.instance;
  }

  async warmup(): Promise<void> {
    try {
      console.log("🔧 Initializing Google Sheets service...");
      await this.getSheetsApi();

      // Make a test call to warm up the service
      const dummySheetId = process.env.DUMMY_SHEET_ID;
      const dummyRange =
        process.env.DUMMY_RANGE || process.env.DUMMY_SHEET_NAME || "";

      if (dummySheetId && dummyRange) {
        console.log("📡 Making warmup request...");
        await this.readValues(dummySheetId, dummyRange, false).catch(() =>
          console.warn(
            "⚠️  Warmup read failed for provided sheet/range. Service will lazily initialize on first request."
          )
        );
      } else if (dummySheetId && !dummyRange) {
        console.log(
          "ℹ️  Skipping warmup values read. Set DUMMY_RANGE (e.g. 'Sheet1!A1:A1') or DUMMY_SHEET_NAME to enable prefetch."
        );
      }

      console.log("✅ Sheets service warmup complete!");
    } catch (error) {
      console.warn("⚠️  Sheets service warmup failed:", error);
    }
  }

  private async loadCredentials(): Promise<any> {
    if (this.credentials) return this.credentials;

    const serviceAccountB64 = process.env.GOOGLE_SERVICE_ACCOUNT_INFO_B64;
    if (!serviceAccountB64) {
      throw new Error(
        "Missing GOOGLE_SERVICE_ACCOUNT_INFO_B64 environment variable"
      );
    }

    try {
      const serviceAccountInfo = JSON.parse(
        Buffer.from(serviceAccountB64, "base64").toString("utf-8")
      );

      const auth = new google.auth.GoogleAuth({
        credentials: serviceAccountInfo,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });

      this.credentials = await auth.getClient();
      return this.credentials;
    } catch (error) {
      throw new Error("Failed to parse Google service account credentials");
    }
  }

  private async getSheetsApi(): Promise<sheets_v4.Sheets> {
    if (this.sheetsApi) return this.sheetsApi;

    const auth = await this.loadCredentials();
    this.sheetsApi = google.sheets({ version: "v4", auth });
    return this.sheetsApi;
  }

  private pruneCache(now: number): void {
    for (const [key, entry] of this.readCache) {
      if (now - entry.timestamp > this.CACHE_TTL) {
        this.readCache.delete(key);
      }
    }

    while (this.readCache.size > this.CACHE_MAX_ENTRIES) {
      const oldestKey = this.readCache.keys().next().value;
      if (!oldestKey) break;
      this.readCache.delete(oldestKey);
    }
  }

  async readValues(
    spreadsheetId: string,
    range: string,
    useCache: boolean = true
  ): Promise<string[][]> {
    const trimmedRange = range?.trim();
    if (!trimmedRange) {
      throw new Error("Range must be a non-empty string");
    }

    const cacheKey = `${spreadsheetId}:${trimmedRange}`;
    const now = Date.now();

    // Check cache (LRU semantics: if hit, re-insert to mark as recently used)
    if (useCache && this.readCache.has(cacheKey)) {
      const entry = this.readCache.get(cacheKey)!;
      if (now - entry.timestamp <= this.CACHE_TTL) {
        // Refresh insertion order for LRU
        this.readCache.delete(cacheKey);
        this.readCache.set(cacheKey, entry);
        return entry.data;
      }
      this.readCache.delete(cacheKey);
    }

    if (!useCache) {
      this.readCache.delete(cacheKey);
    } else if (this.inflightReads.has(cacheKey)) {
      const pending = this.inflightReads.get(cacheKey)!;
      return pending;
    }

    const fetchPromise = this.fetchSheetValues(
      spreadsheetId,
      trimmedRange
    ).then((values) => {
      if (useCache) {
        this.pruneCache(now);
        this.readCache.set(cacheKey, { timestamp: now, data: values });
      }
      return values;
    });

    if (useCache) {
      this.inflightReads.set(cacheKey, fetchPromise);
      fetchPromise.finally(() => {
        this.inflightReads.delete(cacheKey);
      });
    }

    return fetchPromise;
  }

  private async fetchSheetValues(
    spreadsheetId: string,
    range: string
  ): Promise<string[][]> {
    const normalizedRange = range.includes("!") ? range : `${range}!A:ZZZ`;
    const sheets = await this.getSheetsApi();

    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: normalizedRange,
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING",
        majorDimension: "ROWS",
        fields: "values",
      });

      return (response.data.values || []) as string[][];
    } catch (err: any) {
      throw new Error(
        err?.message || "Failed to read values from Google Sheet"
      );
    }
  }

  normalizeRows(headers: string[] = [], rawRows: string[][]): RowDict[] {
    if (!rawRows.length || headers.length === 0) return [];

    const headerCount = headers.length;
    const result: RowDict[] = [];

    for (const row of rawRows) {
      const normalized: RowDict = Object.create(null);

      // Pad or trim row to match header count
      for (let i = 0; i < headerCount; i++) {
        const key = headers[i] ?? `col_${i}`;
        normalized[key] = i < row.length ? row[i] : "";
      }

      result.push(normalized);
    }

    return result;
  }

  applyOptions(rows: RowDict[], options?: SheetQueryOptions): RowDict[] {
    if (!options) return rows;

    let processed = rows;

    if (options.uniqueBy) {
      processed = this.applyUnique(processed, options.uniqueBy);
    }

    if (options.search) {
      processed = this.applySearch(processed, options.search);
    }

    return processed;
  }

  private applyUnique(rows: RowDict[], uniqueBy: string | string[]): RowDict[] {
    if (!uniqueBy) return rows;

    const keys = Array.isArray(uniqueBy) ? uniqueBy : [uniqueBy];
    const seen = new Set<string>();
    const result: RowDict[] = [];

    for (const row of rows) {
      const compoundKey = keys.map((k) => String(row[k] ?? "")).join("|");
      if (!seen.has(compoundKey)) {
        seen.add(compoundKey);
        result.push(row);
      }
    }

    return result;
  }

  // Uses Fuse.js to perform fuzzy search while limiting allocations via result cap.
  private applySearch(rows: RowDict[], search: SearchOptions): RowDict[] {
    const term = search?.term?.trim();
    if (!term) {
      return rows;
    }

    if (rows.length === 0) {
      return rows;
    }

    const keys = (search.keys || Object.keys(rows[0] || {})).filter(Boolean);
    if (keys.length === 0) {
      return rows;
    }

    const limit = Math.min(search.limit ?? rows.length, rows.length);
    if (limit <= 0) {
      return [];
    }

    const minMatchCharLength =
      typeof search.minMatchCharLength === "number"
        ? Math.max(1, search.minMatchCharLength)
        : Math.min(term.length, 2);

    const fuse = new Fuse<RowDict>(rows, {
      keys,
      threshold: search.threshold ?? 0.3,
      includeScore: false,
      shouldSort: true,
      ignoreLocation: true,
      minMatchCharLength,
      useExtendedSearch: false,
    });

    const results = fuse.search(term, { limit });
    if (!results.length) {
      return [];
    }

    return results.map((entry) => entry.item);
  }

  // applyPagination(
  //   rows: RowDict[],
  //   page?: number,
  //   limit?: number
  // ): [
  //   RowDict[],
  //   { total: number; page: number; limit: number; hasNextPage: boolean }
  // ] {
  //   const pageNum = Math.max(1, parseInt(String(page)) || 1);
  //   const limitNum = Math.max(0, parseInt(String(limit)) || 50);

  //   const total = rows.length;
  //   const start = (pageNum - 1) * limitNum;
  //   const end = limitNum > 0 ? start + limitNum : total;

  //   const paginatedRows = rows.slice(start, end);
  //   const hasNextPage = end < total;

  //   return [
  //     paginatedRows,
  //     { total, page: pageNum, limit: limitNum, hasNextPage },
  //   ];
  // }

  private colIdxToA1(n: number): string {
    let result = "";
    n++;
    while (n > 0) {
      n--;
      result = String.fromCharCode(65 + (n % 26)) + result;
      n = Math.floor(n / 26);
    }
    return result;
  }

  async updateRows(
    spreadsheetId: string,
    sheetName: string,
    where: any,
    data: RowDict,
    updateAll: boolean = false
  ): Promise<{ updated: number; appended: number }> {
    // Read current values and headers
    const values = await this.readValues(spreadsheetId, sheetName, false);

    if (!values.length) {
      throw new Error("Sheet appears empty or unreadable");
    }

    const headers = (values[0] ?? []) as string[];
    const rows = this.normalizeRows(headers, values.slice(1));

    // Find matching rows
    const predicate = where
      ? this.filtersService.buildPredicate(where)
      : () => true;
    const matchingIndices: number[] = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => predicate(row))
      .map(({ index }) => index as number);

    const sheets = await this.getSheetsApi();
    let updated = 0;
    // Note: updateRows no longer auto-appends. Appends must be done explicitly

    if (matchingIndices.length > 0) {
      const targetIndices = updateAll
        ? matchingIndices
        : matchingIndices.slice(0, 1);

      // Prepare batch updates
      const batchRequests: any[] = [];

      for (const ri of targetIndices) {
        const rowIndex: number = ri as number;
        const existingRow = rows[rowIndex];
        if (!existingRow) continue;
        const updatedRow = headers.map((h) =>
          existingRow[h] !== undefined && existingRow[h] !== null
            ? existingRow[h]
            : ""
        );
        let hasChanges = false;

        // Apply updates
        for (const [key, value] of Object.entries(data)) {
          const headerIndex = headers.indexOf(key);
          if (headerIndex >= 0) {
            if (String(updatedRow[headerIndex]) !== String(value)) {
              updatedRow[headerIndex] = value;
              hasChanges = true;
            }
          }
        }

        if (hasChanges) {
          const sheetRowNum = rowIndex + 2; // +1 for header, +1 for 1-based
          const endCol = this.colIdxToA1(headers.length - 1);
          const range = `${sheetName}!A${sheetRowNum}:${endCol}${sheetRowNum}`;

          batchRequests.push({
            range,
            values: [updatedRow],
          });
        }
      }

      // Execute batch update
      if (batchRequests.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: "RAW",
            data: batchRequests,
          },
        });
        updated = batchRequests.length;
      }
    }

    return { updated, appended: 0 };
  }

  async appendRow(
    spreadsheetId: string,
    sheetName: string,
    data: RowDict
  ): Promise<{ appended: number }> {
    const values = await this.readValues(spreadsheetId, sheetName, false);

    if (!values.length) {
      throw new Error("Sheet appears empty or unreadable");
    }

    const headers = (values[0] ?? []) as string[];
    const newRow = headers.map((h) =>
      data[h] !== undefined && data[h] !== null ? data[h] : ""
    );
    const lastRow = values.length + 1;
    const endCol = this.colIdxToA1(headers.length - 1);
    const range = `${sheetName}!A${lastRow}:${endCol}${lastRow}`;

    const sheets = await this.getSheetsApi();
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [newRow],
      },
    });

    return { appended: 1 };
  }
}
