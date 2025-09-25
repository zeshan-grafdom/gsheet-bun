// src/services/filters.ts
type Scalar = string | number | boolean | Date | null;
type RowDict = Record<string, any>;

type Condition = {
  field?: string;
  operator?: string;
  value?: any;
  values?: any[];
};

type WhereTree = Condition & {
  and?: Condition | Condition[];
  or?: Condition | Condition[];
};

const asArray = <T>(input?: T | T[]): T[] => {
  if (!input) return [];
  return Array.isArray(input) ? input : [input];
};

export class FiltersService {
  private isNullish(value: any): boolean {
    return value === null || value === undefined || value === "";
  }

  private toBool(value: any): boolean | null {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return Boolean(value);
    if (typeof value === "string") {
      const s = value.trim().toLowerCase();
      if (["true", "t", "yes", "y", "1"].includes(s)) return true;
      if (["false", "f", "no", "n", "0"].includes(s)) return false;
    }
    return null;
  }

  private toNumber(value: any): number | null {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const num = parseFloat(value.trim());
      return isNaN(num) ? null : num;
    }
    return null;
  }

  private toDateTime(value: any): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === "string") {
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date;
    }
    return null;
  }

  private coercePair(lhs: any, rhs: any): [Scalar, Scalar, string] {
    if (this.isNullish(lhs) && this.isNullish(rhs)) {
      return [null, null, "null"];
    }

    // Try datetime
    const ldt = this.toDateTime(lhs);
    const rdt = this.toDateTime(rhs);
    if (ldt && rdt) {
      return [ldt, rdt, "datetime"];
    }

    // Try number
    const ln = this.toNumber(lhs);
    const rn = this.toNumber(rhs);
    if (ln !== null && rn !== null) {
      return [ln, rn, "number"];
    }

    // Try boolean
    const lb = this.toBool(lhs);
    const rb = this.toBool(rhs);
    if (lb !== null && rb !== null) {
      return [lb, rb, "bool"];
    }

    // Default to string
    return [
      lhs === null ? "" : String(lhs),
      rhs === null ? "" : String(rhs),
      "string",
    ];
  }

  private compare(lhs: any, rhs: any, op: string): boolean {
    const [a, b, kind] = this.coercePair(lhs, rhs);

    const isEqualityOp = op === "eq" || op === "ne";
    if (a === null || b === null) {
      if (isEqualityOp) {
        return op === "eq" ? a === b : a !== b;
      }
      return false;
    }

    switch (op) {
      case "eq":
        return a === b;
      case "ne":
        return a !== b;
      case "gt":
        return kind !== "bool" && a > b;
      case "gte":
        return kind !== "bool" && a >= b;
      case "lt":
        return kind !== "bool" && a < b;
      case "lte":
        return kind !== "bool" && a <= b;
      default:
        return false;
    }
  }

  private like(cell: any, pattern: any): boolean {
    if (this.isNullish(cell) || this.isNullish(pattern)) return false;
    return String(cell).toLowerCase().includes(String(pattern).toLowerCase());
  }

  private between(cell: any, low: any, high: any): boolean {
    const [a1, b1, k1] = this.coercePair(cell, low);
    const [a2, b2, k2] = this.coercePair(cell, high);

    if (
      a1 === null ||
      b1 === null ||
      a2 === null ||
      b2 === null ||
      k1 !== k2
    ) {
      return false;
    }

    return a1 >= b1 && a2 <= b2;
  }

  private inList(cell: any, options: any[]): boolean {
    return options.some((opt) => this.compare(cell, opt, "eq"));
  }

  buildPredicate(payload: any): (row: RowDict) => boolean {
    const where: WhereTree | undefined = (payload?.where || payload) as
      | WhereTree
      | undefined;
    if (!where || typeof where !== "object") {
      return () => true;
    }

    const andConds = asArray(where.and);
    const orConds = asArray(where.or);

    return (row: RowDict): boolean => {
      let andOk = true;
      if (andConds.length > 0) {
        andOk = andConds.every((cond) => this.matchCondition(row, cond));
      }

      let orOk = orConds.length === 0;
      if (orConds.length > 0) {
        orOk = orConds.some((cond) => this.matchCondition(row, cond));
      }

      if (andConds.length > 0 && orConds.length > 0) {
        return andOk || orOk;
      }
      return andConds.length > 0 ? andOk : orOk;
    };
  }

  private matchCondition(row: RowDict, condition: Condition): boolean {
    if (!condition || typeof condition !== "object") return false;

    const { field, operator = "eq", value, values } = condition;
    if (!field) return false;
    const cell = row[field];
    const op = String(operator).toLowerCase();

    switch (op) {
      case "is_null":
        return this.isNullish(cell);
      case "is_not_null":
        return !this.isNullish(cell);
      case "like":
        return this.like(cell, value);
      case "between": {
        const pair = values || value;
        if (Array.isArray(pair) && pair.length >= 2) {
          return this.between(cell, pair[0], pair[1]);
        }
        return false;
      }
      case "in":
      case "not_in": {
        const opts = values || (Array.isArray(value) ? value : [value]);
        const inResult = this.inList(cell, opts);
        return op === "in" ? inResult : !inResult;
      }
      default:
        return this.compare(cell, value, op);
    }
  }

  applyFilters(rows: RowDict[], where?: any): RowDict[] {
    if (!where) return rows;
    const predicate = this.buildPredicate(where);
    return rows.filter(predicate);
  }
}
