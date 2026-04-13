# Flick HQ Backend API Documentation

## Project Overview

Flick HQ is a NestJS-based backend for a movie streaming/platform application. The project provides RESTful APIs for user management, authentication, movie browsing, personal lists (watchlist, favorites, watched), notifications, payments, blog, categories, and contact functionality. The application uses TypeORM with PostgreSQL for data persistence, JWT for authentication, and integrates with external services like Stripe for payments and Google OAuth for social login.

---

## Architecture

The project follows a modular architecture where each feature is encapsulated in its own module. The main application module (`AppModule`) imports and coordinates all feature modules. The application uses global guards for authentication and rate limiting, global interceptors for response transformation, and global filters for error handling. Configuration is managed through environment variables with validation schemas, and the API documentation is automatically generated using Swagger.

---

## API Endpoints

### 1. Authentication Module

The authentication module handles all user authentication operations, including login, logout, email verification, password reset, and social login via Google OAuth.

#### Public Endpoints

**POST /auth/login**

- Authenticates a user with email and password credentials
- Returns a JWT token upon successful authentication
- Rate limited to 5 attempts per 6 hours to prevent brute force attacks

**POST /auth/verify-email**

- Verifies a user's email address using a unique token sent via email
- Rate limited to 5 attempts per 6 hours

**POST /auth/rest-password/send**

- Initiates the password reset process by sending a reset link to the user's registered email
- Rate limited to 3 attempts per 15 minutes

**POST /auth/rest-password/verify**

- Validates a password reset token before allowing the user to change their password
- Rate limited to 5 attempts per 15 minutes

**POST /auth/rest-password**

- Completes the password reset process by setting a new password using the validated token
- Rate limited to 5 attempts per hour

**GET /auth/google**

- Initiates Google OAuth2 login flow
- Redirects user to Google for authentication

**GET /auth/google/callback**

- Handles the callback from Google OAuth2
- Creates or updates user record and sets an authentication cookie
- Redirects to frontend with refresh parameter

#### Protected Endpoints

**POST /auth/logout**

- Logs out the current user by adding their token to a blacklist
- Requires JWT authentication

**GET /auth/current-user**

- Retrieves the profile of the currently authenticated user
- Requires JWT authentication

---

### 2. User Module

The user module handles user registration, retrieval, update, and deletion operations. Admin-only endpoints provide user statistics.

**POST /user**

- Creates a new user (public registration endpoint)
- No authentication required

**GET /user**

- Retrieves all users with pagination and filtering
- Requires ADMIN role authentication

**GET /user/stats**

- Retrieves user statistics (total users, active users, etc.)
- Requires ADMIN role authentication

**GET /user/:id**

- Retrieves a specific user by ID

**PATCH /user/:id**

- Updates a user's information

**DELETE /user/:id**

- Deletes a user

---

### 3. Movies Module

The movies module provides endpoints for searching and retrieving movie details from TMDB.

**GET /api/v1/movies**

- Searches and browses movies by query string
- Supports pagination with page and limit parameters

**GET /api/v1/movies/:id**

- Retrieves detailed information about a specific movie by internal ID

---

### 4. Lists Module

The lists module manages user's personal movie collections including watchlist, favorites, and watched movies. Each list type has its own controller but shares similar patterns.

#### Watchlist

**GET /api/v1/watchlist**

- Retrieves the authenticated user's watchlist with pagination

**POST /api/v1/watchlist**

- Adds a movie to the user's watchlist

**DELETE /api/v1/watchlist/:movieId**

- Removes a movie from the user's watchlist
- Requires JWT authentication

#### Favorites

**GET /api/v1/favorites**

- Retrieves the authenticated user's favorites list with pagination

**POST /api/v1/favorites**

- Adds a movie to the user's favorites

**DELETE /api/v1/favorites/:movieId**

- Removes a movie from the user's favorites

**GET /api/v1/favorites/check/:tmdbId**

- Checks if a specific movie is in the user's favorites
- Returns a boolean indicating membership

#### Watched

**GET /api/v1/watched**

- Retrieves the authenticated user's watched list with pagination

**POST /api/v1/watched**

- Marks a movie as watched (can include a user rating)

**PATCH /api/v1/watched/:movieId**

- Updates the rating for a watched movie

**DELETE /api/v1/watched/:movieId**

- Removes a movie from the watched list

**GET /api/v1/watched/check/:tmdbId**

- Checks if a specific movie is in the user's watched list

---

### 5. Notifications Module

The notifications module handles both client-facing and admin-facing notification operations.

#### Client Endpoints

**GET /notifications**

- Retrieves notifications for the authenticated user with cursor-based pagination
- Supports infinite scroll pattern

**GET /notifications/paginated** (Deprecated)

- Legacy endpoint for paginated notifications (offset-based)
- Replaced by cursor-based pagination

**GET /notifications/unread-count**

- Retrieves the count of unread notifications for the authenticated user

**PATCH /notifications/:id/read**

- Marks a specific notification as read

**PATCH /notifications/read-all**

- Marks all notifications as read for the authenticated user

**DELETE /notifications/:id**

- Soft deletes a notification (marks as deleted but retains in database)

**GET /notifications/preferences**

- Retrieves notification preferences for the authenticated user

**PATCH /notifications/preferences**

- Updates notification preferences for the authenticated user

#### Admin Endpoints

**POST /admin/notifications/send**

- Sends a notification to a specific user

**POST /admin/notifications/broadcast**

- Broadcasts a notification to all users or specific target users

**GET /admin/notifications**

- Retrieves all notifications with pagination (admin view)

**DELETE /admin/notifications/:id**

- Permanently deletes a notification (hard delete)

---

### 6. Payments Module

The payments module integrates with Stripe for handling payment operations.

**POST /payments/intent**

- Creates a Stripe payment intent for the authenticated user
- Rate limited to 2 attempts per 5 seconds to prevent duplicate charges

**POST /payments/webhook**

- Handles Stripe webhook events for payment status updates
- Requires raw body for signature verification

**GET /payments/history**

- Retrieves payment history for the authenticated user with pagination

---

### 7. Blog Module

The blog module provides content management for articles with both public and admin-facing endpoints.

#### Public Endpoints

**GET /blog**

- Lists published articles with pagination and tag filtering
- Only returns articles that have been published

**GET /blog/:slug**

- Retrieves a single published article by its slug
- Returns 404 if article is not found or not published

#### Admin Endpoints

**POST /admin/blog**

- Creates a new article

**PATCH /admin/blog/:id**

- Updates an existing article

**PATCH /admin/blog/:id/publish**

- Toggles the publish status of an article
- Requires excerpt to be set before publishing

**DELETE /admin/blog/:id**

- Deletes an article

**GET /admin/blog**

- Lists all articles with pagination and filtering (including unpublished)

---

### 8. Categories Module

The categories module manages movie categories with public and admin endpoints.

#### Public Endpoints

**GET /categories**

- Retrieves all categories (public view)

**GET /categories/:slug**

- Retrieves a category by its slug

#### Admin Endpoints

**POST /admin/categories**

- Creates a new category

**GET /admin/categories**

- Lists all categories with pagination and filtering

**GET /admin/categories/:id**

- Retrieves a category by ID

**PATCH /admin/categories/:id**

- Updates a category

**DELETE /admin/categories/:id**

- Deletes a category

**POST /admin/categories/reorder**

- Bulk reorders categories (changes display order)

---

### 9. Contact Module

The contact module handles contact form submissions from users.

#### Public Endpoints

**POST /contact**

- Submits a contact message from a user
- Rate limited to 5 submissions per hour per IP
- Records the IP address of the submitter

#### Admin Endpoints

**GET /admin/contact**

- Lists all contact messages with pagination and filtering

**GET /admin/contact/:id**

- Retrieves a specific contact message by ID

**PATCH /admin/contact/:id/read**

- Marks a contact message as read

**PATCH /admin/contact/:id/reply**

- Marks a contact message as replied

**DELETE /admin/contact/:id**

- Perman deletes a contact message

---

### 10. Health Check

**GET /health**

- Returns the health status of the application
- No authentication required

---

## Security Features

The application implements several security measures including rate limiting via Throttler module, JWT-based authentication with token blacklisting for logout, role-based access control with ADMIN and USER roles, global authentication guard checking token blacklist, input validation using class-validator with whitelist mode, Helmet for security headers, CORS configuration, and Stripe webhook signature verification.

---

## Data Flow

The application follows a standard NestJS flow where requests pass through global guards for authentication and authorization, then reach controllers that validate incoming DTOs, controllers delegate to services that contain business logic, services interact with repositories for database operations, and responses are transformed through global interceptors before being returned to clients.

---

## External Integrations

The project integrates with TMDB API for movie data, Stripe for payment processing, Google OAuth for social authentication, and sends emails using the configured mailer service.

---

## Database

The application uses PostgreSQL as its database with TypeORM as the ORM. Migrations are managed through TypeORM's migration system, and the database configuration includes SSL settings for production environments.

---

## Caching

The application uses cache-manager for caching, with configuration options for TTL (time-to-live) and maximum cache size. Caching is applied to improve performance for frequently accessed data.
