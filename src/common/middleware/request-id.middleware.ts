import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request & { requestId?: string }, response: Response, next: NextFunction) {
    const requestIdHeader = request.header('x-request-id');
    const requestId = requestIdHeader?.trim() || randomUUID();

    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);
    next();
  }
}
