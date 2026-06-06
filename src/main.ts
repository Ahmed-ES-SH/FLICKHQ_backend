import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    bufferLogs: false,
  });

  // Cookie parser
  app.use(cookieParser());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Security headers with helmet (configured for production)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", process.env.FRONTEND_URL || ''],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  // CORS configuration
  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3001',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    exposedHeaders: ['Content-Length', 'X-Response-Time'],
    maxAge: 86400, // 24 hours
  });

  // Global interceptors
  app.useGlobalInterceptors(new TransformInterceptor());

  // Global exception filter
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Request logging middleware
  app.use(
    new RequestLoggerMiddleware().use.bind(new RequestLoggerMiddleware()),
  );

  // Stripe webhook raw body
  // -----------------------
  // `rawBody: true` above causes Nest's Express adapter to attach the
  // unparsed request body to `req.rawBody` (Buffer) on every request, in
  // addition to the JSON-parsed `req.body`. The BillingModule's
  // `StripeWebhookController` reads `req.rawBody` and verifies the
  // Stripe-Signature against it (signature verification must operate
  // on the exact bytes Stripe sent — JSON re-serialization breaks it).
  // No additional per-route middleware is needed: the global
  // `ValidationPipe`, `helmet`, `cookieParser`, and the request logger
  // do not consume the body. Routes that do not need the raw body can
  // simply ignore `req.rawBody` and use `req.body` as usual.

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('CYPHER API')
    .setDescription('The CYPHER movie platform API description')
    .setVersion('1.0')
    .addTag('CYPHER')
    .addTag('auth')
    .addBearerAuth()
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, documentFactory);

  // Graceful shutdown
  app.enableShutdownHooks();

  app.setGlobalPrefix('api');

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
