import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { CookieOptions } from 'express';

/**
 * Centralized service for authentication cookie operations.
 *
 * Single source of truth for:
 * - Cookie name (from AUTH_TOKEN env var)
 * - Cookie configuration (httpOnly, secure, sameSite, path, maxAge)
 * - Setting and clearing the auth cookie
 *
 * Every auth-related cookie operation MUST go through this service.
 * Never hardcode the cookie name or configuration anywhere else.
 */
@Injectable()
export class AuthCookieService {
  private readonly cookieName: string;
  private readonly isProduction: boolean;
  private readonly frontendUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.cookieName = this.configService.getOrThrow<string>('AUTH_TOKEN');
    this.isProduction =
      this.configService.get<string>('NODE_ENV') === 'production';
    this.frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
  }

  /**
   * Returns the configured auth cookie name.
   */
  get name(): string {
    return this.cookieName;
  }

  /**
   * Returns the configured frontend URL for redirects.
   */
  get redirectUrl(): string {
    return this.frontendUrl;
  }

  /**
   * Returns the cookie configuration options.
   *
   * - httpOnly: true (prevents client-side JS access)
   * - secure: true in production only (requires HTTPS)
   * - sameSite: 'lax' (CSRF protection while allowing top-level navigations)
   * - path: '/' (available across the entire site)
   * - maxAge: 5 days in milliseconds (matches common JWT expiry)
   */
  private getCookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 5 * 24 * 60 * 60 * 1000, // 5 days
    };
  }

  /**
   * Sets the authentication HttpOnly cookie on the response.
   *
   * @param response - Express response object
   * @param token - JWT token string to store in the cookie
   */
  setAuthCookie(response: Response, token: string): void {
    response.cookie(this.cookieName, token, this.getCookieOptions());
  }

  /**
   * Clears the authentication cookie from the response.
   *
   * @param response - Express response object
   */
  clearAuthCookie(response: Response): void {
    response.clearCookie(this.cookieName, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: 'lax',
      path: '/',
    });
  }
}
