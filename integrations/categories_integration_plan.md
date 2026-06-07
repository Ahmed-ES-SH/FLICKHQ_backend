# Categories Module Frontend Integration Plan

This document is a comprehensive integration guide for the frontend developer connecting to the NestJS Backend **Categories** APIs. It maps to the backend files in [src/categories](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories).

---

## 🔑 Core Authentication & Authorization

The categories module exposes two route groups:

1. **Public Routes (`/categories/*`)** — Accessible by any client (no auth required). Used for showing navigation/filter chips on the public site. Controlled by [categories.public.controller.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/categories.public.controller.ts).
2. **Admin Routes (`/admin/categories/*`)** — Restricted to administrators only. Controlled by [categories.controller.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/categories.controller.ts).
   - **Authentication Requirement**: Requests must include the cookie named `sanad_auth_token` containing a valid JWT.
   - **Role Requirement**: The authenticated user's role must be `ADMIN`.
   - **API Client Setup**: Ensure your API client (e.g., Axios or Fetch) is configured to send cookies (`withCredentials: true` or `credentials: 'include'`).

> **Note**: There is no separate "delete cascade" endpoint. Deleting a category automatically sets the `categoryId` of any referencing articles to `NULL` (the DB-level `onDelete: 'SET NULL'` on the `Article → Category` relation). A warning is logged server-side when this happens.

---

## 📊 Endpoint Summary Table

| HTTP Method | Route | Auth Required | Role Required | Description |
| :--- | :--- | :---: | :---: | :--- |
| **GET** | `/categories` | ❌ No | None | List all categories (ordered by `order` ASC, then `name` ASC) |
| **GET** | `/categories/:slug` | ❌ No | None | Retrieve a single category by its slug |
| **GET** | `/admin/categories` | ✅ Yes | `ADMIN` | List categories with pagination, search, and sort filters |
| **POST** | `/admin/categories` | ✅ Yes | `ADMIN` | Create a new category |
| **GET** | `/admin/categories/:id` | ✅ Yes | `ADMIN` | Retrieve a single category by its UUID |
| **PATCH** | `/admin/categories/:id` | ✅ Yes | `ADMIN` | Partially update a category |
| **DELETE** | `/admin/categories/:id` | ✅ Yes | `ADMIN` | Permanently delete a category (unlinks articles) |
| **POST** | `/admin/categories/reorder` | ✅ Yes | `ADMIN` | Bulk reorder many categories atomically |

---

## 📂 Data Models

### Category Structure
Mapped from [Category](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/schema/category.schema.ts) and serialized by [CategoryResponseDto](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/dto/category-response.dto.ts).

| Field | Type | Nullable | Description |
| :--- | :--- | :---: | :--- |
| `id` | `string` (UUID) | ❌ No | Server-generated unique identifier |
| `name` | `string` | ❌ No | Display name. Required, max 100 characters, **unique** |
| `slug` | `string` | ❌ No | URL-friendly slug. Lowercase letters, digits, and hyphens only. Max 120 chars, **unique**. Auto-generated from `name` when not provided on create |
| `description` | `string` | ✅ Yes | Free-form description |
| `color` | `string` | ✅ Yes | Hex color code matching `^#[0-9A-Fa-f]{6}$` (e.g. `#FF5733`). Max 7 chars |
| `icon` | `string` | ✅ Yes | Icon identifier (font-icon class or symbol name). Max 50 chars |
| `order` | `number` | ❌ No | Integer used for display ordering. Default `0`, min `0` |
| `createdAt` | `string` (ISO Date) | ❌ No | Server-generated creation timestamp |
| `updatedAt` | `string` (ISO Date) | ❌ No | Server-generated last update timestamp |

> **Serialization note**: The `articles` relation (OneToMany) is decorated with `@Exclude()` in the schema, so it is **never** returned to clients. Do not rely on it being present in responses.

---

## 🛠️ Endpoint Specifications

### 1. List All Categories (Public)
Returns the **full, unpaginated** list of categories. Use it for navigation menus, filter chips, and footer link builders.

* **Endpoint:** `GET /categories`
* **Authentication:** None
* **Headers:** `Accept: application/json`
* **Query Parameters:** None (no filters, no pagination, no sort)

#### Default Ordering
Categories are returned sorted by `order` ASC, then `name` ASC.

#### Response
*   **`200 OK`** — Success. Returns an array of categories.
    ```json
    [
      {
        "id": "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d",
        "name": "Web Development",
        "slug": "web-development",
        "description": "All articles about web development",
        "color": "#3498db",
        "icon": "code",
        "order": 1,
        "createdAt": "2025-12-01T10:00:00.000Z",
        "updatedAt": "2025-12-15T12:30:00.000Z"
      },
      {
        "id": "8b7c6d5e-4f3a-2b1c-0d9e-8f7a6b5c4d3e",
        "name": "Design",
        "slug": "design",
        "description": "UI/UX and graphic design topics",
        "color": "#e74c3c",
        "icon": "palette",
        "order": 2,
        "createdAt": "2025-12-02T09:15:00.000Z",
        "updatedAt": "2025-12-10T08:45:00.000Z"
      }
    ]
    ```

---

### 2. Get a Category by Slug (Public)
Retrieve the full details of a single category using its slug. Use it for category landing pages (`/blog/category/web-development`).

* **Endpoint:** `GET /categories/:slug`
* **Authentication:** None
* **Path Parameters:**

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `slug` | `string` | ✅ Yes | The category's unique slug (e.g. `web-development`) |

#### Response
*   **`200 OK`** — Category found.
    ```json
    {
      "id": "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d",
      "name": "Web Development",
      "slug": "web-development",
      "description": "All articles about web development",
      "color": "#3498db",
      "icon": "code",
      "order": 1,
      "createdAt": "2025-12-01T10:00:00.000Z",
      "updatedAt": "2025-12-15T12:30:00.000Z"
    }
    ```
*   **`404 Not Found`** — No category matches the provided slug.
    ```json
    {
      "statusCode": 404,
      "message": "Category not found",
      "error": "Not Found"
    }
    ```

---

### 3. List Categories (Admin, Paginated)
List categories with pagination, search, and sort — used by the admin management table.

* **Endpoint:** `GET /admin/categories`
* **Authentication:** ✅ Bearer JWT (admin)
* **Headers:** `Accept: application/json`

#### Query Parameters ([FilterCategoriesQueryDto](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/dto/filter-categories-query.dto.ts))

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :---: | :--- | :--- |
| `page` | `number` | No | `1` | Page number (min `1`) |
| `limit` | `number` | No | `10` | Items per page (min `1`, max `100`) |
| `search` | `string` | No | `undefined` | Case-insensitive partial match on `name` (uses `ILIKE %search%`) |
| `sortBy` | `enum` | No | `order` | One of: `name`, `order`, `createdAt` |
| `sortOrder` | `enum` | No | `ASC` | One of: `ASC`, `DESC` |

#### Response
*   **`200 OK`** — Paginated list. The `data` array contains full category objects.
    ```json
    {
      "data": [
        {
          "id": "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d",
          "name": "Web Development",
          "slug": "web-development",
          "description": "All articles about web development",
          "color": "#3498db",
          "icon": "code",
          "order": 1,
          "createdAt": "2025-12-01T10:00:00.000Z",
          "updatedAt": "2025-12-15T12:30:00.000Z"
        },
        {
          "id": "8b7c6d5e-4f3a-2b1c-0d9e-8f7a6b5c4d3e",
          "name": "Design",
          "slug": "design",
          "description": null,
          "color": null,
          "icon": null,
          "order": 2,
          "createdAt": "2025-12-02T09:15:00.000Z",
          "updatedAt": "2025-12-02T09:15:00.000Z"
        }
      ],
      "total": 12,
      "totalPages": 2,
      "page": 1,
      "limit": 10
    }
    ```
*   **`400 Bad Request`** — Invalid query (e.g. `limit=0`, `sortBy=foo`).
    ```json
    {
      "statusCode": 400,
      "message": [
        "limit must not be less than 1",
        "sortBy must be one of: name, order, createdAt"
      ],
      "error": "Bad Request"
    }
    ```
*   **`401 Unauthorized`** — Missing or invalid JWT.
*   **`403 Forbidden`** — Authenticated user is not `ADMIN`.

---

### 4. Create Category (Admin)
Create a new category.

* **Endpoint:** `POST /admin/categories`
* **Authentication:** ✅ Bearer JWT (admin)
* **Content-Type:** `application/json`

#### Request Body ([CreateCategoryDto](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/dto/create-category.dto.ts))

| Field | Type | Required | Constraints | Description |
| :--- | :--- | :---: | :--- | :--- |
| `name` | `string` | ✅ Yes | Non-empty, max 100 chars, **unique** | Display name |
| `slug` | `string` | No | Lowercase letters, digits, hyphens only, max 120, **unique** | URL slug. If omitted, the server auto-generates it from `name` (e.g. `Web Development` → `web-development`) |
| `description` | `string` | No | — | Free-form description |
| `color` | `string` | No | Hex format `^#[0-9A-Fa-f]{6}$`, max 7 chars | Brand color (e.g. `#FF5733`) |
| `icon` | `string` | No | Max 50 chars | Icon identifier |
| `order` | `number` | No | Integer, min `0`, default `0` | Display order |

#### Example Request
```json
{
  "name": "Mobile Development",
  "description": "Articles about iOS and Android development",
  "color": "#27ae60",
  "icon": "smartphone",
  "order": 3
}
```

#### Response
*   **`201 Created`** — Category created.
    ```json
    {
      "id": "7c6d5e4f-3a2b-1c0d-9e8f-7a6b5c4d3e2f",
      "name": "Mobile Development",
      "slug": "mobile-development",
      "description": "Articles about iOS and Android development",
      "color": "#27ae60",
      "icon": "smartphone",
      "order": 3,
      "createdAt": "2026-01-05T11:22:33.000Z",
      "updatedAt": "2026-01-05T11:22:33.000Z"
    }
    ```
*   **`400 Bad Request`** — Validation failure.
    ```json
    {
      "statusCode": 400,
      "message": [
        "name should not be empty",
        "color must be a valid hex color code (e.g., #FF5733)"
      ],
      "error": "Bad Request"
    }
    ```
*   **`409 Conflict`** — `name` or `slug` already exists.
    ```json
    {
      "statusCode": 409,
      "message": "Category with this name already exists",
      "error": "Conflict"
    }
    ```

---

### 5. Get Category by ID (Admin)
Fetch a single category by its UUID.

* **Endpoint:** `GET /admin/categories/:id`
* **Authentication:** ✅ Bearer JWT (admin)
* **Path Parameters:**

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `id` | `string` (UUID) | ✅ Yes | Category UUID. Validated by `ParseUUIDPipe` |

#### Response
*   **`200 OK`** — Category found.
    ```json
    {
      "id": "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d",
      "name": "Web Development",
      "slug": "web-development",
      "description": "All articles about web development",
      "color": "#3498db",
      "icon": "code",
      "order": 1,
      "createdAt": "2025-12-01T10:00:00.000Z",
      "updatedAt": "2025-12-15T12:30:00.000Z"
    }
    ```
*   **`400 Bad Request`** — `id` is not a valid UUID.
    ```json
    {
      "statusCode": 400,
      "message": "Validation failed (uuid is expected)",
      "error": "Bad Request"
    }
    ```
*   **`404 Not Found`** — Category does not exist.
    ```json
    {
      "statusCode": 404,
      "message": "Category not found",
      "error": "Not Found"
    }
    ```

---

### 6. Update Category (Admin)
Partially update any field of a category. All fields are optional.

* **Endpoint:** `PATCH /admin/categories/:id`
* **Authentication:** ✅ Bearer JWT (admin)
* **Content-Type:** `application/json`

#### Path Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `id` | `string` (UUID) | ✅ Yes | Category UUID |

#### Request Body ([UpdateCategoryDto](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/dto/update-category.dto.ts))
Inherits all fields of [CreateCategoryDto](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/dto/create-category.dto.ts) as **optional**.

| Field | Type | Required | Notes |
| :--- | :--- | :---: | :--- |
| `name` | `string` | No | If changed and `slug` is **not** provided, the server auto-regenerates the slug from the new name |
| `slug` | `string` | No | If explicitly provided, the slug is updated as-is (does not regenerate from `name`) |
| `description` | `string` | No | Pass a new string to update |
| `color` | `string` | No | Must remain a valid hex code |
| `icon` | `string` | No | — |
| `order` | `number` | No | — |

#### Example Request — Change name only (slug regenerates)
```json
{
  "name": "Web & Frontend"
}
```
Resulting slug will be `web-frontend`.

#### Example Request — Change slug explicitly
```json
{
  "name": "Web & Frontend",
  "slug": "web-frontend-custom"
}
```
Resulting slug will be `web-frontend-custom` (slug is **not** regenerated when explicitly provided).

#### Response
*   **`200 OK`** — Updated.
    ```json
    {
      "id": "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d",
      "name": "Web & Frontend",
      "slug": "web-frontend",
      "description": "All articles about web development",
      "color": "#3498db",
      "icon": "code",
      "order": 1,
      "createdAt": "2025-12-01T10:00:00.000Z",
      "updatedAt": "2026-01-05T11:22:33.000Z"
    }
    ```
*   **`400 Bad Request`** — Invalid UUID or invalid field value.
*   **`404 Not Found`** — Category not found.
*   **`409 Conflict`** — New `name` or `slug` collides with another category.
    ```json
    {
      "statusCode": 409,
      "message": "Category with this slug already exists",
      "error": "Conflict"
    }
    ```

---

### 7. Delete Category (Admin)
Permanently delete a category. **The relation with articles is `onDelete: SET NULL`** — articles pointing to this category will have their `categoryId` set to `NULL`.

* **Endpoint:** `DELETE /admin/categories/:id`
* **Authentication:** ✅ Bearer JWT (admin)

#### Path Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `id` | `string` (UUID) | ✅ Yes | Category UUID |

#### Response
*   **`200 OK`** — Category deleted.
    ```json
    {
      "message": "Category deleted successfully"
    }
    ```
*   **`400 Bad Request`** — Invalid UUID.
*   **`404 Not Found`** — Category not found.

> **Frontend tip**: Before calling `DELETE`, fetch the articles that depend on the category (or display a confirmation) so the user understands that articles will become uncategorized. The server only logs a warning; the actual unlinking happens at the DB level.

---

### 8. Bulk Reorder Categories (Admin)
Atomically update the `order` field of many categories in a single transaction. Use it from a drag-and-drop admin UI.

* **Endpoint:** `POST /admin/categories/reorder`
* **Authentication:** ✅ Bearer JWT (admin)
* **Content-Type:** `application/json`

> **Important**: This endpoint is bound to `POST /admin/categories/reorder`. Because the controller's path is `admin/categories` and this handler uses a literal segment (`@Post('reorder')`), it must be matched **before** the `GET /admin/categories/:id` style — but in practice, since it is `POST` and the others are `GET/PATCH/DELETE`, there is no collision.

#### Request Body ([ReorderCategoriesDto](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/dto/reorder-categories.dto.ts))

| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `categories` | `ReorderCategoryItemDto[]` | ✅ Yes | Array of `{ id, order }` pairs. Must include all categories you want to reorder. The server validates that **all** provided IDs exist |

##### `ReorderCategoryItemDto`

| Field | Type | Required | Constraints |
| :--- | :--- | :---: | :--- |
| `id` | `string` (UUID) | ✅ Yes | Must be a valid UUID |
| `order` | `number` | ✅ Yes | Integer, min `0` |

#### Example Request
```json
{
  "categories": [
    { "id": "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d", "order": 2 },
    { "id": "8b7c6d5e-4f3a-2b1c-0d9e-8f7a6b5c4d3e", "order": 0 },
    { "id": "7c6d5e4f-3a2b-1c0d-9e8f-7a6b5c4d3e2f", "order": 1 }
  ]
}
```

#### Response
*   **`200 OK`** — Categories reordered. Returns the updated categories **sorted by the requested `order` ascending**.
    ```json
    [
      {
        "id": "8b7c6d5e-4f3a-2b1c-0d9e-8f7a6b5c4d3e",
        "name": "Design",
        "slug": "design",
        "description": null,
        "color": null,
        "icon": null,
        "order": 0,
        "createdAt": "2025-12-02T09:15:00.000Z",
        "updatedAt": "2025-12-02T09:15:00.000Z"
      },
      {
        "id": "7c6d5e4f-3a2b-1c0d-9e8f-7a6b5c4d3e2f",
        "name": "Mobile Development",
        "slug": "mobile-development",
        "description": "Articles about iOS and Android development",
        "color": "#27ae60",
        "icon": "smartphone",
        "order": 1,
        "createdAt": "2026-01-05T11:22:33.000Z",
        "updatedAt": "2026-01-05T11:22:33.000Z"
      },
      {
        "id": "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d",
        "name": "Web Development",
        "slug": "web-development",
        "description": "All articles about web development",
        "color": "#3498db",
        "icon": "code",
        "order": 2,
        "createdAt": "2025-12-01T10:00:00.000Z",
        "updatedAt": "2026-01-05T11:22:33.000Z"
      }
    ]
    ```
*   **`400 Bad Request`** — Invalid array, invalid UUID, or invalid `order`.
    ```json
    {
      "statusCode": 400,
      "message": [
        "each value in categories must be a UUID",
        "order must not be less than 0"
      ],
      "error": "Bad Request"
    }
    ```
*   **`404 Not Found`** — One or more provided category IDs do not exist.
    ```json
    {
      "statusCode": 404,
      "message": "Categories not found: 11111111-2222-3333-4444-555555555555",
      "error": "Not Found"
    }
    ```

> **Atomicity**: The reorder is performed inside a single DB transaction. If any update fails, all updates are rolled back.

---

## ⚠️ Error Cases Summary

| Status | When it happens | Typical message |
| :--- | :--- | :--- |
| `400 Bad Request` | Invalid UUID in path, invalid query (e.g. `limit=0`, `sortBy=foo`), invalid body field | Validation messages from `class-validator` |
| `401 Unauthorized` | Missing or invalid JWT (admin routes only) | `Unauthorized` |
| `403 Forbidden` | Authenticated user is not `ADMIN` (admin routes only) | `Forbidden resource` |
| `404 Not Found` | Category ID/slug does not exist (any GET-by-id/slug) | `Category not found` |
| `404 Not Found` | One or more IDs in a reorder payload do not exist | `Categories not found: <id1>, <id2>` |
| `409 Conflict` | Creating or updating a category with a `name` or `slug` that already exists | `Category with this name already exists` / `Category with this slug already exists` |

---

## 💡 Integration Tips

1. **Slug auto-generation**: Always prefer omitting `slug` on create. The server's slugifier lowercases, trims, removes non-`\w\s-` characters, collapses whitespace/underscores into single hyphens, and trims leading/trailing hyphens. E.g. `Hello, World!` → `hello-world`.
2. **Slug regeneration on update**: If you change only `name` and want the URL to follow, simply **omit** `slug` in the PATCH body. If you want to keep a custom slug, send both `name` and `slug` together.
3. **Unique constraints**: Both `name` and `slug` are unique at the DB level. Always handle `409 Conflict` from the frontend and surface a friendly message ("This category name is already in use").
4. **Hex color validation**: The regex `^#[0-9A-Fa-f]{6}$` is strict — no short form (`#FFF`), no `rgb(...)`, no named colors. Use a `<input type="color">` picker in the admin UI to guarantee compliance.
5. **Public vs admin listing**:
   - Use `GET /categories` for **public** UIs — it is un-paginated, ordered, and includes every category.
   - Use `GET /admin/categories` for the **admin table** — it supports pagination, search, and sort.
6. **Reorder strategy**: After the admin rearranges categories, send a **single** `POST /admin/categories/reorder` call with the full new ordering. Don't issue many `PATCH` calls — the bulk endpoint is atomic and faster.
7. **Delete warning**: Before deleting a category, the admin UI should ideally display "X articles will become uncategorized" by calling the blog module's article list filtered by `categoryId`.
8. **Cookies for auth**: All admin endpoints rely on the `sanad_auth_token` cookie. Make sure your client sends cookies on cross-origin requests (configure `withCredentials: true` for Axios or `credentials: 'include'` for Fetch).
9. **Swagger**: The live OpenAPI docs are mounted at `/api/docs` — every endpoint listed above is documented there with the same schemas.

---

## 📁 Related Backend Files

- Controller (Admin): [src/categories/categories.controller.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/categories.controller.ts)
- Controller (Public): [src/categories/categories.public.controller.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/categories.public.controller.ts)
- Service: [src/categories/categories.service.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/categories.service.ts)
- Module: [src/categories/categories.module.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/categories.module.ts)
- Schema: [src/categories/schema/category.schema.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/schema/category.schema.ts)
- DTOs:
  - [create-category.dto.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/dto/create-category.dto.ts)
  - [update-category.dto.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/dto/update-category.dto.ts)
  - [filter-categories-query.dto.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/dto/filter-categories-query.dto.ts)
  - [reorder-categories.dto.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/dto/reorder-categories.dto.ts)
  - [category-response.dto.ts](file:///media/a-dev/01DCF07F273A0960/my-files/projects/boilerplate_backend/src/categories/dto/category-response.dto.ts)
