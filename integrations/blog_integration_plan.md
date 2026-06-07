# Blog Module Frontend Integration Plan

This document serves as a comprehensive integration guide for the frontend developer connecting to the NestJS Backend Blog APIs. It maps to the backend files in [src/blog](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/blog).

---

## 🔑 Core Authentication & Authorization

The blog module features two types of routes:
1. **Public Routes (`/blog/*`)**: Accessible by any client. No authentication token is required. Controlled by [blog.public.controller.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/blog/blog.public.controller.ts).
2. **Admin/Management Routes (`/admin/blog/*`)**: Restricted to administrators only. Controlled by [blog.controller.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/blog/blog.controller.ts).
   - **Authentication Requirement**: Requests must include the cookie named `sanad_auth_token` containing a valid JWT.
   - **Role Requirement**: The authenticated user's role must be `ADMIN`.
   - **API Client Setup**: Ensure your API client (e.g., Axios or Fetch) is configured to send cookies (`withCredentials: true` or `credentials: 'include'`).

---

## 📊 Endpoint Summary Table

| HTTP Method | Route | Auth Required | Role Required | Description |
| :--- | :--- | :---: | :---: | :--- |
| **GET** | `/blog` | ❌ No | None | List published articles (paginated, tag/category filters) |
| **GET** | `/blog/:slug` | ❌ No | None | Retrieve details of a single published article by slug |
| **GET** | `/admin/blog` |  Yes | `ADMIN` | List all articles (paginated, full filters, search, sort) |
| **POST** | `/admin/blog` |  Yes | `ADMIN` | Create a new article (draft status by default) |
| **PATCH** | `/admin/blog/:id` |  Yes | `ADMIN` | Update details of an existing article |
| **PATCH** | `/admin/blog/:id/publish` |  Yes | `ADMIN` | Toggle the publishing status of an article |
| **DELETE** | `/admin/blog/:id` |  Yes | `ADMIN` | Permanently delete an article |

---

## 📂 Data Models

### 1. Article Structure
Mapped from [Article](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/blog/schema/article.schema.ts).

| Field | Type | Nullable | Description |
| :--- | :--- | :---: | :--- |
| `id` | `string` (UUID) | ❌ No | Unique identifier for the article |
| `title` | `string` | ❌ No | Title of the article (max 300 characters) |
| `slug` | `string` | ❌ No | Unique URL-friendly slug, auto-generated from the title |
| `excerpt` | `string` |  Yes | Short summary of the article (required to publish) |
| `content` | `string` | ❌ No | Full markdown or HTML body of the article |
| `coverImageUrl` | `string` (URL) |  Yes | URL of the article's cover image |
| `tags` | `string[]` | ❌ No | List of lowercased, whitespace-trimmed tags |
| `categoryId` | `string` (UUID) |  Yes | ID of the linked category |
| `category` | `Category` or `null` |  Yes | Populated category entity (see structure below) |
| `isPublished` | `boolean` | ❌ No | Whether the article is visible to the public |
| `publishedAt` | `string` (Date) |  Yes | ISO timestamp of when the article was published |
| `readTimeMinutes` | `number` | ❌ No | Estimated read time in minutes, calculated on the backend (200 words/min) |
| `viewsCount` | `number` | ❌ No | Total views count, automatically incremented on public details fetch |
| `createdAt` | `string` (Date) | ❌ No | ISO timestamp of article creation |
| `updatedAt` | `string` (Date) | ❌ No | ISO timestamp of last update |

### 2. Category Structure
When populated inside an article:
- **For public lists (`GET /blog`)**: Only `id`, `name`, and `slug` are returned to save bandwidth.
- **For detail and admin endpoints**: The complete category object is returned.

| Field | Type | Nullable | Description |
| :--- | :--- | :---: | :--- |
| `id` | `string` (UUID) | ❌ No | Unique identifier for the category |
| `name` | `string` | ❌ No | Unique display name of the category |
| `slug` | `string` | ❌ No | Unique URL slug |
| `description` | `string` |  Yes | Detailed category description |
| `color` | `string` |  Yes | Hex color code (e.g. `#FF0000`) for badges |
| `icon` | `string` |  Yes | FontIcon class or symbol name |
| `order` | `number` | ❌ No | Sorting order integer |
| `createdAt` | `string` (Date) | ❌ No | ISO timestamp of category creation |
| `updatedAt` | `string` (Date) | ❌ No | ISO timestamp of last update |

---

## 🛠️ Endpoint Specifications

### 1. List Published Articles (Public)
Retrieves a paginated list of published articles only. Highly optimized for reader-facing blog homepages or list feeds.

* **Endpoint:** `GET /blog`
* **Authentication:** None
* **Headers:** `Accept: application/json`

#### Query Parameters ([FindPublishedArticlesQueryDto](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/blog/dto/find-published-articles-query.dto.ts))
Inherits pagination parameters from [PaginationQueryDto](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/common/dto/pagination-query.dto.ts).

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :---: | :--- | :--- |
| `page` | `number` | No | `1` | Page number to fetch (minimum `1`) |
| `limit` | `number` | No | `10` | Number of items per page (minimum `1`, maximum `1000`) |
| `sortBy` | `string` | No | `'createdAt'` | Sort field: `'createdAt'`, `'updatedAt'`, `'amount'`, `'viewsCount'`, `'publishedAt'`, `'title'` |
| `order` | `string` | No | `'DESC'` | Sort direction: `'ASC'` or `'DESC'` |
| `categoryId` | `string` (UUID) | No | None | Filter articles belonging to a specific category ID |
| `tag` | `string` | No | None | Filter articles containing a specific tag (case-insensitive) |

#### Responses
*   **`200 OK`** — Success. Returns metadata and article data. Category details are restricted to `id`, `name`, and `slug`.
    ```json
    {
      "data": [
        {
          "id": "c1f76d49-43c2-4876-96cb-5192131e5f8f",
          "title": "Getting Started with NestJS",
          "slug": "getting-started-with-nestjs",
          "excerpt": "A beginner guide to building scalable backend APIs with NestJS.",
          "coverImageUrl": "https://example.com/assets/nestjs-guide.png",
          "tags": ["nestjs", "backend", "typescript"],
          "isPublished": true,
          "publishedAt": "2026-06-07T08:00:00.000Z",
          "readTimeMinutes": 5,
          "viewsCount": 142,
          "createdAt": "2026-06-07T07:55:00.000Z",
          "updatedAt": "2026-06-07T08:00:00.000Z",
          "category": {
            "id": "e0e4709d-e35f-4a0d-b873-455b85a3fa38",
            "name": "Backend Development",
            "slug": "backend-development"
          }
        }
      ],
      "meta": {
        "page": 1,
        "limit": 10,
        "total": 1,
        "totalPages": 1
      }
    }
    ```

---

### 2. Get Published Article by Slug (Public)
Retrieves a single published article including full content.
> [!NOTE]
> Each successful fetch of this endpoint atomically increments the `viewsCount` of the article by 1 and returns the updated count.

* **Endpoint:** `GET /blog/:slug`
* **Authentication:** None
* **Path Parameters:**
  - `slug` (Required, string): The unique URL slug of the article.

#### Responses
*   **`200 OK`** — Success. Returns full article details and populated category object.
    ```json
    {
      "id": "c1f76d49-43c2-4876-96cb-5192131e5f8f",
      "title": "Getting Started with NestJS",
      "slug": "getting-started-with-nestjs",
      "excerpt": "A beginner guide to building scalable backend APIs with NestJS.",
      "content": "<p>NestJS is a progressive Node.js framework for building efficient, reliable and scalable server-side applications.</p>",
      "coverImageUrl": "https://example.com/assets/nestjs-guide.png",
      "tags": ["nestjs", "backend", "typescript"],
      "categoryId": "e0e4709d-e35f-4a0d-b873-455b85a3fa38",
      "isPublished": true,
      "publishedAt": "2026-06-07T08:00:00.000Z",
      "readTimeMinutes": 5,
      "viewsCount": 143,
      "createdAt": "2026-06-07T07:55:00.000Z",
      "updatedAt": "2026-06-07T08:00:00.000Z",
      "category": {
        "id": "e0e4709d-e35f-4a0d-b873-455b85a3fa38",
        "name": "Backend Development",
        "slug": "backend-development",
        "description": "All about server-side engineering.",
        "color": "#e0234e",
        "icon": "server",
        "order": 1,
        "createdAt": "2026-06-06T12:00:00.000Z",
        "updatedAt": "2026-06-06T12:00:00.000Z"
      }
    }
    ```
*   **`404 Not Found`** — The article with the specified slug does not exist or is not published.
    ```json
    {
      "message": "Published article with slug \"getting-started-with-nestjs\" not found",
      "error": "Not Found",
      "statusCode": 404
    }
    ```

---

### 3. List All Articles (Admin)
Retrieves a paginated list of all articles (both drafts and published). Supports title search, publish status filtering, sorting, and tag/category filters.

* **Endpoint:** `GET /admin/blog`
* **Authentication:** Required (Cookie: `sanad_auth_token`)
* **Role Required:** `ADMIN`
* **Headers:** Requires credentials support (`credentials: 'include'`).

#### Query Parameters ([FindAllArticlesQueryDto](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/blog/dto/find-all-articles-query.dto.ts))
Inherits parameters from [PaginationQueryDto](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/common/dto/pagination-query.dto.ts).

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :---: | :--- | :--- |
| `page` | `number` | No | `1` | Page number to fetch (minimum `1`) |
| `limit` | `number` | No | `10` | Items per page (minimum `1`, maximum `1000`) |
| `sortBy` | `string` | No | `'createdAt'` | Sort field: `'createdAt'`, `'updatedAt'`, `'amount'`, `'viewsCount'`, `'publishedAt'`, `'title'` |
| `order` | `string` | No | `'DESC'` | Sort direction: `'ASC'` or `'DESC'` |
| `categoryId` | `string` (UUID) | No | None | Filter by category ID |
| `tag` | `string` | No | None | Filter by tag name (case-insensitive) |
| `search` | `string` | No | None | Case-insensitive title search (matches anywhere in the title via ILIKE) |
| `isPublished` | `boolean` | No | None | Filter by publish status (`true` / `1` or `false` / `0`) |

#### Responses
*   **`200 OK`** — Success. Returns metadata and array of articles.
    ```json
    {
      "data": [
        {
          "id": "c1f76d49-43c2-4876-96cb-5192131e5f8f",
          "title": "Getting Started with NestJS",
          "slug": "getting-started-with-nestjs",
          "content": "<p>NestJS content...</p>",
          "excerpt": "A beginner guide...",
          "coverImageUrl": "https://example.com/assets/nestjs-guide.png",
          "tags": ["nestjs", "backend"],
          "categoryId": "e0e4709d-e35f-4a0d-b873-455b85a3fa38",
          "isPublished": false,
          "publishedAt": null,
          "readTimeMinutes": 5,
          "viewsCount": 0,
          "createdAt": "2026-06-07T07:55:00.000Z",
          "updatedAt": "2026-06-07T07:55:00.000Z",
          "category": {
            "id": "e0e4709d-e35f-4a0d-b873-455b85a3fa38",
            "name": "Backend Development",
            "slug": "backend-development",
            "description": "All about server-side engineering.",
            "color": "#e0234e",
            "icon": "server",
            "order": 1,
            "createdAt": "2026-06-06T12:00:00.000Z",
            "updatedAt": "2026-06-06T12:00:00.000Z"
          }
        }
      ],
      "meta": {
        "page": 1,
        "limit": 10,
        "total": 1,
        "totalPages": 1
      }
    }
    ```
*   **`401 Unauthorized`** — Cookie is missing or token is invalid.
    ```json
    {
      "message": "Unauthorized",
      "statusCode": 401
    }
    ```
*   **`403 Forbidden`** — User is authenticated but does not possess the `ADMIN` role.
    ```json
    {
      "message": "Forbidden resource",
      "error": "Forbidden",
      "statusCode": 403
    }
    ```

---

### 4. Create Article (Admin)
Creates a new article in draft mode (`isPublished: false`, `publishedAt: null`).
> [!NOTE]
> - **Read Time Calculation**: The backend automatically calculates `readTimeMinutes` based on the word count of `content` (approx. 200 words per minute, stripped of HTML tags).
> - **Slug Auto-generation**: The article `slug` is automatically generated from the `title` and guaranteed to be unique.
> - **Tag Normalization**: Input tags are normalized (trimmed, converted to lowercase, and empty entries are filtered out).

* **Endpoint:** `POST /admin/blog`
* **Authentication:** Required (Cookie: `sanad_auth_token`)
* **Role Required:** `ADMIN`
* **Headers:** `Content-Type: application/json`

#### Request Body ([CreateArticleDto](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/blog/dto/create-article.dto.ts))
| Field | Type | Required | Validation Rules | Description |
| :--- | :--- | :---: | :--- | :--- |
| `title` | `string` | Yes | Non-empty, max 300 characters | The title of the article |
| `content` | `string` | Yes | Non-empty | The full body content (HTML or Markdown) |
| `excerpt` | `string` | No | Optional string | A brief summary (required later to publish) |
| `coverImageUrl` | `string` | No | Optional, must be a valid URL format | Main article banner image URL |
| `tags` | `string[]` | No | Optional, array of strings | Categorization tags |
| `categoryId` | `string` | No | Optional, must be a valid UUID format | The ID of the associated category |

#### Responses
*   **`201 Created`** — Success. Returns the newly created article.
    ```json
    {
      "id": "c1f76d49-43c2-4876-96cb-5192131e5f8f",
      "title": "Getting Started with NestJS",
      "slug": "getting-started-with-nestjs",
      "content": "<p>NestJS content...</p>",
      "excerpt": "A beginner guide...",
      "coverImageUrl": "https://example.com/assets/nestjs-guide.png",
      "tags": ["nestjs", "backend"],
      "categoryId": "e0e4709d-e35f-4a0d-b873-455b85a3fa38",
      "isPublished": false,
      "publishedAt": null,
      "readTimeMinutes": 5,
      "viewsCount": 0,
      "createdAt": "2026-06-07T07:55:00.000Z",
      "updatedAt": "2026-06-07T07:55:00.000Z"
    }
    ```
*   **`400 Bad Request`** — Validation failed (e.g. invalid UUID format or missing required fields).
    ```json
    {
      "message": [
        "title must be longer than or equal to 1 characters",
        "categoryId must be a UUID"
      ],
      "error": "Bad Request",
      "statusCode": 400
    }
    ```

---

### 5. Update Article (Admin)
Updates one or more fields of an existing article.
> [!NOTE]
> - If the `title` is modified, the backend automatically regenerates and ensures uniqueness of the `slug`.
> - If `content` is updated, the backend recalculates `readTimeMinutes`.

* **Endpoint:** `PATCH /admin/blog/:id`
* **Authentication:** Required (Cookie: `sanad_auth_token`)
* **Role Required:** `ADMIN`
* **Path Parameters:**
  - `id` (Required, string): Valid UUID of the article.
* **Headers:** `Content-Type: application/json`

#### Request Body ([UpdateArticleDto](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/blog/dto/update-article.dto.ts))
Supports the same fields as `CreateArticleDto`, but all fields are optional.

#### Responses
*   **`200 OK`** — Success. Returns the updated article.
    ```json
    {
      "id": "c1f76d49-43c2-4876-96cb-5192131e5f8f",
      "title": "Getting Started with NestJS (Updated)",
      "slug": "getting-started-with-nestjs-updated",
      "content": "<p>NestJS content...</p>",
      "excerpt": "A beginner guide...",
      "coverImageUrl": "https://example.com/assets/nestjs-guide.png",
      "tags": ["nestjs", "backend", "typescript"],
      "categoryId": "e0e4709d-e35f-4a0d-b873-455b85a3fa38",
      "isPublished": false,
      "publishedAt": null,
      "readTimeMinutes": 6,
      "viewsCount": 0,
      "createdAt": "2026-06-07T07:55:00.000Z",
      "updatedAt": "2026-06-07T08:05:00.000Z"
    }
    ```
*   **`400 Bad Request`** — Invalid UUID path parameter, or invalid body payload.
    ```json
    {
      "message": "Validation failed (uuid is expected)",
      "error": "Bad Request",
      "statusCode": 400
    }
    ```
*   **`404 Not Found`** — The article with the specified ID does not exist.
    ```json
    {
      "message": "Article with ID \"c1f76d49-43c2-4876-96cb-5192131e5f8f\" not found",
      "error": "Not Found",
      "statusCode": 404
    }
    ```

---

### 6. Toggle Publish Status (Admin)
Publishes a draft article or unpublishes an already published article.
> [!IMPORTANT]
> **Publishing Constraint**:
> An article **cannot** be published if the `excerpt` is missing, empty, or only contains whitespace. The backend will reject the request if the article lacks an excerpt.

* **Endpoint:** `PATCH /admin/blog/:id/publish`
* **Authentication:** Required (Cookie: `sanad_auth_token`)
* **Role Required:** `ADMIN`
* **Path Parameters:**
  - `id` (Required, string): Valid UUID of the article.

#### Responses
*   **`200 OK`** — Success. Returns publish details status.
    ```json
    {
      "id": "c1f76d49-43c2-4876-96cb-5192131e5f8f",
      "isPublished": true,
      "publishedAt": "2026-06-07T08:10:00.000Z",
      "message": "Article published successfully"
    }
    ```
    OR (when unpublishing):
    ```json
    {
      "id": "c1f76d49-43c2-4876-96cb-5192131e5f8f",
      "isPublished": false,
      "publishedAt": "2026-06-07T08:10:00.000Z",
      "message": "Article unpublished successfully"
    }
    ```
*   **`400 Bad Request`** — Attempting to publish an article that has no excerpt.
    ```json
    {
      "message": "Excerpt is required before publishing an article",
      "error": "Bad Request",
      "statusCode": 400
    }
    ```
*   **`404 Not Found`** — Article with the specified ID does not exist.
    ```json
    {
      "message": "Article with ID \"c1f76d49-43c2-4876-96cb-5192131e5f8f\" not found",
      "error": "Not Found",
      "statusCode": 404
    }
    ```

---

### 7. Delete Article (Admin)
Permanently deletes an article from the database.

* **Endpoint:** `DELETE /admin/blog/:id`
* **Authentication:** Required (Cookie: `sanad_auth_token`)
* **Role Required:** `ADMIN`
* **Path Parameters:**
  - `id` (Required, string): Valid UUID of the article.

#### Responses
*   **`200 OK`** — Success.
    ```json
    {
      "message": "Article deleted successfully"
    }
    ```
*   **`404 Not Found`** — Article with the specified ID does not exist.
    ```json
    {
      "message": "Article with ID \"c1f76d49-43c2-4876-96cb-5192131e5f8f\" not found",
      "error": "Not Found",
      "statusCode": 404
    }
    ```
