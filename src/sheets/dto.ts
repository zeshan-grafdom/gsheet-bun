export function validateSheet(searchParams: URLSearchParams): string {
  const sheet = searchParams.get("sheet");
  if (!sheet) {
    throw new Error("Missing 'sheet' parameter");
  }
  return sheet;
}

export function validateData(input: Record<string, any>): Record<string, any> {
  if (!input) {
    throw new Error("'data' is required");
  }

  if (Array.isArray(input)) {
    throw new Error("'data' must be a non-empty object");
  }

  if (Object.keys(input).length === 0) {
    throw new Error("'data' must have at least one key-value pair");
  }

  return input;
}
