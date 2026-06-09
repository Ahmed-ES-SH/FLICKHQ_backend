import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || '';

    res.on('finish', () => {
      const { statusCode } = res;
      const contentLength = res.get('content-length');
      const responseTime = res.get('x-response-time');

      this.logger.log(
        `${method} ${originalUrl} ${statusCode} ${contentLength || 0}b - ${ip} ${userAgent}${responseTime ? ` - ${responseTime}` : ''}`,
      );
    });

    next();
  }
}
