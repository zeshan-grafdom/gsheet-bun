export class HttpException extends Error {
  public readonly status: number;
  public readonly response: any;

  constructor(response: any, status: number) {
    super(typeof response === "string" ? response : JSON.stringify(response));
    this.status = status;
    this.response = response;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class BadRequestException extends HttpException {
  constructor(message: string = "Bad Request") {
    super({ statusCode: 400, message }, 400);
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message: string = "Unauthorized") {
    super({ statusCode: 401, message }, 401);
  }
}

export class NotFoundException extends HttpException {
  constructor(message: string = "Not Found") {
    super({ statusCode: 404, message }, 404);
  }
}

export class ForbiddenException extends HttpException {
  constructor(message: string = "Forbidden") {
    super({ statusCode: 403, message }, 403);
  }
}

export class InternalServerErrorException extends HttpException {
  constructor(message: string = "Internal Server Error") {
    super({ statusCode: 500, message }, 500);
  }
}
