# User Lists Module — Frontend Integration Plan

This document is a comprehensive integration guide for the frontend developer connecting to the NestJS Backend **User Lists** APIs.

---

## Overview

The Lists module provides a personal media list system for users to organize movies and TV shows. Every user gets **3 system lists** auto-created on signup (via `AuthService`):

| System List | Slug        | List Key    | Editable? | Deletable? |
| :---------- | :---------- | :---------- | :-------: | :--------: |
| Favorites   | `favorites` | `favorites` |    No     |     No     |
| Watchlist   | `watchlist` | `watchlist` |    No     |     No     |
| Watched     | `watched`   | `watched`   |    No     |     No     |

Users can also create **unlimited custom lists** with full CRUD + item management.

### Authentication

All endpoints require a valid JWT token passed via the `flick_auth_token` HttpOnly cookie (configurable via the `AUTH_TOKEN` env var). Ensure `credentials: 'include'` is set on the API client (e.g., `withCredentials: true` in axios, `credentials: 'include'` in fetch).

The `user` object on the request provides a numeric `id` field — all list operations are scoped to the authenticated user.

### Base URL

```
/lists
```

---

## Enums

### MediaType

| Value   | Description    |
| :------ | :------------- |
| `movie` | Movie media    |
| `tv`    | TV Show media  |

```typescript
enum MediaType {
  MOVIE = 'movie',
  TV = 'tv',
}
```

### SystemListKey

| Value       | Description        |
| :---------- | :----------------- |
| `favorites` | Favorites system list |
| `watchlist` | Watchlist system list |
| `watched`   | Watched system list   |

```typescript
enum SystemListKey {
  FAVORITES = 'favorites',
  WATCHLIST = 'watchlist',
  WATCHED = 'watched',
}
```

---

## Response Types

### ListResponseDto

The shape returned for any list object.

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "My Watchlist",
  "slug": "my-watchlist",
  "listKey": "custom:d9e8f7c6-5432-1098-abcd-ef0987654321",
  "isSystem": false,
  "itemCount": 12,
  "createdAt": "2026-06-08T10:00:00.000Z",
  "updatedAt": "2026-06-08T12:30:00.000Z"
}
```

| Field       | Type                | Description                                                         |
| :---------- | :------------------ | :------------------------------------------------------------------ |
| `id`        | `string (UUID)`     | Unique list identifier                                              |
| `name`      | `string`            | Display name of the list (max 80 chars)                             |
| `slug`      | `string`            | URL-safe slug (max 100 chars, lowercase + hyphens)                  |
| `listKey`   | `string`            | System key (`favorites`, `watchlist`, `watched`) or `custom:<uuid>` |
| `isSystem`  | `boolean`           | `true` for system lists, `false` for custom lists                   |
| `itemCount` | `number`            | Total number of items in the list                                   |
| `createdAt` | `string (ISO 8601)` | Creation timestamp                                                  |
| `updatedAt` | `string (ISO 8601)` | Last update timestamp                                               |

### ListItemResponseDto

The shape returned for any item within a list.

```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "mediaType": "movie",
  "tmdbId": 550,
  "title": "Fight Club",
  "posterPath": "/pB8BM7pdSp6B6Ih7QI4S2t0POoT.jpg",
  "releaseDate": "1999-10-15",
  "voteAverage": 8.4,
  "addedAt": "2026-06-08T10:05:00.000Z"
}
```

| Field         | Type                | Nullable | Description                                                              |
| :------------ | :------------------ | :------: | :----------------------------------------------------------------------- |
| `id`          | `string (UUID)`     |    No    | Unique item identifier                                                   |
| `mediaType`   | `"movie" \| "tv"`   |    No    | Media type (enum: `movie`, `tv`)                                         |
| `tmdbId`      | `number`            |    No    | TMDB database ID                                                         |
| `title`       | `string`            |    No    | Media title (fetched from TMDB)                                          |
| `posterPath`  | `string \| null`    |   Yes    | TMDB poster relative path (see poster URL construction below)            |
| `releaseDate` | `string \| null`    |   Yes    | Release date (`YYYY-MM-DD`) or first air date                            |
| `voteAverage` | `number \| null`    |   Yes    | TMDB vote average (0–10)                                                 |
| `addedAt`     | `string (ISO 8601)` |    No    | Timestamp when the item was added to the list                            |

### PaginatedResult\<T\>

Wraps all list and item responses that return multiple records.

```json
{
  "data": [],
  "total": 50,
  "page": 1,
  "perPage": 20,
  "lastPage": 3
}
```

| Field      | Type     | Description                            |
| :--------- | :------- | :------------------------------------- |
| `data`     | `T[]`    | Array of items for the current page    |
| `total`    | `number` | Total number of items across all pages |
| `page`     | `number` | Current page number (1-indexed)        |
| `perPage`  | `number` | Items per page                         |
| `lastPage` | `number` | Total number of pages                  |

---

## Endpoint Summary Table

| HTTP Method | Route                                 | Description                                    | Status Codes        |
| :---------- | :------------------------------------ | :--------------------------------------------- | :------------------ |
| **POST**    | `/lists`                              | Create a new custom list                       | `201`, `400`, `409` |
| **GET**     | `/lists`                              | Get all lists for the current user (paginated) | `200`               |
| **GET**     | `/lists/:id`                          | Get a single list with its items (paginated)   | `200`, `404`        |
| **PATCH**   | `/lists/:id`                          | Rename/update a custom list                    | `200`, `403`, `404`, `409` |
| **DELETE**  | `/lists/:id`                          | Delete a custom list and its items             | `200`, `403`, `404` |
| **POST**    | `/lists/:id/items`                    | Add an item (movie/tv) to a list               | `201`, `400`, `404` |
| **DELETE**  | `/lists/:id/items/:mediaType/:tmdbId` | Remove an item from a list                     | `200`, `404`        |

---

## Endpoint Specifications

### 1. Create a Custom List

- **Endpoint:** `POST /lists`
- **Authentication:** Required
- **Content-Type:** `application/json`

#### Request Body (`CreateListDto`)

| Field  | Type     | Required | Validation                             | Description                                          |
| :----- | :------- | :------: | :------------------------------------- | :--------------------------------------------------- |
| `name` | `string` |   Yes    | Max 80 chars, non-empty                | Display name of the list                             |
| `slug` | `string` |    No    | Max 100 chars, pattern: `^[a-z0-9-]+$` | Custom URL slug. Auto-generated from name if omitted |

> **Slug auto-generation:** If `slug` is omitted, the backend generates one from the `name` by lowercasing, replacing spaces with hyphens, and removing special chars. If the generated slug collides with an existing one, a numeric suffix is appended (e.g., `my-list`, `my-list-1`, `my-list-2`).

#### Request Example

```json
{
  "name": "Best Sci-Fi Movies",
  "slug": "best-sci-fi"
}
```

#### Responses

- **`201 Created`** — List created successfully.

  ```json
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "Best Sci-Fi Movies",
    "slug": "best-sci-fi",
    "listKey": "custom:c9d8e7f6-5432-1098-abcd-ef0987654321",
    "isSystem": false,
    "itemCount": 0,
    "createdAt": "2026-06-08T10:00:00.000Z",
    "updatedAt": "2026-06-08T10:00:00.000Z"
  }
  ```

- **`409 Conflict`** — Slug already exists or slug is reserved.

  | Scenario                            | Message                                          |
  | :---------------------------------- | :----------------------------------------------- |
  | Slug reserved for system lists      | `"This slug is reserved for system lists"`       |
  | Slug already taken (unique violation)| `"A list with this slug already exists"`         |
  | Name collision (unique slug generated) | Same slug collision path — auto-retried by code |

  ```json
  {
    "message": "A list with this slug already exists",
    "error": "Conflict",
    "statusCode": 409
  }
  ```

  ```json
  {
    "message": "This slug is reserved for system lists",
    "error": "Conflict",
    "statusCode": 409
  }
  ```

- **`400 Bad Request`** — Validation failed (e.g., name too long, invalid slug format).

  ```json
  {
    "message": ["name must be shorter than or equal to 80 characters"],
    "error": "Bad Request",
    "statusCode": 400
  }
  ```

---

### 2. Get All Lists (Paginated)

- **Endpoint:** `GET /lists`
- **Authentication:** Required

#### Query Parameters (`FilterListsDto`)

| Param     | Type     | Required | Default | Valid      | Description    |
| :-------- | :------- | :------: | :------ | :--------- | :------------- |
| `page`    | `number` |    No    | `1`     | Min: 1     | Page number    |
| `perPage` | `number` |    No    | `20`    | Min: 1, Max: 100 | Items per page |

#### Request Example

```
GET /lists?page=1&perPage=10
```

#### Responses

- **`200 OK`** — Paginated lists. System lists always appear first (sorted by `isSystem DESC`, then `createdAt DESC`).

  ```json
  {
    "data": [
      {
        "id": "11111111-1111-1111-1111-111111111111",
        "name": "Favorites",
        "slug": "favorites",
        "listKey": "favorites",
        "isSystem": true,
        "itemCount": 25,
        "createdAt": "2026-06-01T00:00:00.000Z",
        "updatedAt": "2026-06-08T10:00:00.000Z"
      },
      {
        "id": "22222222-2222-2222-2222-222222222222",
        "name": "Watchlist",
        "slug": "watchlist",
        "listKey": "watchlist",
        "isSystem": true,
        "itemCount": 8,
        "createdAt": "2026-06-01T00:00:00.000Z",
        "updatedAt": "2026-06-08T10:00:00.000Z"
      },
      {
        "id": "33333333-3333-3333-3333-333333333333",
        "name": "Watched",
        "slug": "watched",
        "listKey": "watched",
        "isSystem": true,
        "itemCount": 42,
        "createdAt": "2026-06-01T00:00:00.000Z",
        "updatedAt": "2026-06-08T10:00:00.000Z"
      },
      {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "name": "Best Sci-Fi Movies",
        "slug": "best-sci-fi",
        "listKey": "custom:c9d8e7f6-5432-1098-abcd-ef0987654321",
        "isSystem": false,
        "itemCount": 12,
        "createdAt": "2026-06-08T10:00:00.000Z",
        "updatedAt": "2026-06-08T12:30:00.000Z"
      }
    ],
    "total": 4,
    "page": 1,
    "perPage": 10,
    "lastPage": 1
  }
  ```

> **Note:** `itemCount` is computed via a separate aggregation query (COUNT per list ID). This is the total number of items in each list, regardless of pagination.

---

### 3. Get a Single List with Items

- **Endpoint:** `GET /lists/:id`
- **Authentication:** Required

#### Path Parameters

| Param | Type            | Description |
| :---- | :-------------- | :---------- |
| `id`  | `string (UUID)` | The list ID |

#### Query Parameters (`FilterListItemsDto`)

| Param       | Type     | Required | Default     | Valid Values                                                     | Description                |
| :---------- | :------- | :------: | :---------- | :--------------------------------------------------------------- | :------------------------- |
| `page`      | `number` |    No    | `1`         | Min: 1                                                           | Page number                |
| `perPage`   | `number` |    No    | `20`        | Min: 1, Max: 100                                                 | Items per page             |
| `mediaType` | `string` |    No    | —           | `"movie"` or `"tv"`                                              | Filter items by media type |
| `sortBy`    | `string` |    No    | `"addedAt"` | `"addedAt"`, `"title"`, `"releaseDate"`, `"voteAverage"`         | Sort field                 |
| `order`     | `string` |    No    | `"DESC"`    | `"ASC"`, `"DESC"`                                                | Sort direction             |

#### Request Example

```
GET /lists/a1b2c3d4-e5f6-7890-abcd-ef1234567890?mediaType=movie&sortBy=voteAverage&order=DESC&page=1&perPage=5
```

#### Responses

- **`200 OK`** — List with paginated items. The response object has two top-level keys: `list` and `items`.

  ```json
  {
    "list": {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "name": "Best Sci-Fi Movies",
      "slug": "best-sci-fi",
      "listKey": "custom:c9d8e7f6-5432-1098-abcd-ef0987654321",
      "isSystem": false,
      "itemCount": 12,
      "createdAt": "2026-06-08T10:00:00.000Z",
      "updatedAt": "2026-06-08T12:30:00.000Z"
    },
    "items": {
      "data": [
        {
          "id": "item-uuid-1",
          "mediaType": "movie",
          "tmdbId": 27205,
          "title": "Inception",
          "posterPath": "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
          "releaseDate": "2010-07-16",
          "voteAverage": 8.4,
          "addedAt": "2026-06-08T10:05:00.000Z"
        },
        {
          "id": "item-uuid-2",
          "mediaType": "movie",
          "tmdbId": 550,
          "title": "Fight Club",
          "posterPath": "/pB8BM7pdSp6B6Ih7QI4S2t0POoT.jpg",
          "releaseDate": "1999-10-15",
          "voteAverage": 8.4,
          "addedAt": "2026-06-08T10:06:00.000Z"
        }
      ],
      "total": 12,
      "page": 1,
      "perPage": 5,
      "lastPage": 3
    }
  }
  ```

- **`404 Not Found`** — List does not exist or does not belong to the user.

  ```json
  {
    "message": "List not found",
    "error": "Not Found",
    "statusCode": 404
  }
  ```

> **Important:** The `itemCount` in `list` reflects the **total** items in the list (not filtered by `mediaType`), even when the `mediaType` filter is applied to the items sub-query.

---

### 4. Update a Custom List (Rename / Re-slug)

- **Endpoint:** `PATCH /lists/:id`
- **Authentication:** Required
- **Content-Type:** `application/json`

> **System lists** (`isSystem: true`) cannot be renamed or re-slung. Returns `403 Forbidden`.

#### Path Parameters

| Param | Type            | Description |
| :---- | :-------------- | :---------- |
| `id`  | `string (UUID)` | The list ID |

#### Request Body (`UpdateListDto`)

All fields are optional — only send the fields you want to update.

| Field  | Type     | Required | Validation                             | Description      |
| :----- | :------- | :------: | :------------------------------------- | :--------------- |
| `name` | `string` |    No    | Max 80 chars, non-empty if provided    | New display name |
| `slug` | `string` |    No    | Max 100 chars, pattern: `^[a-z0-9-]+$` | New URL slug     |

#### Request Example

```json
{
  "name": "Top 10 Sci-Fi",
  "slug": "top-10-sci-fi"
}
```

#### Responses

- **`200 OK`** — List updated successfully.

  ```json
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "Top 10 Sci-Fi",
    "slug": "top-10-sci-fi",
    "listKey": "custom:c9d8e7f6-5432-1098-abcd-ef0987654321",
    "isSystem": false,
    "itemCount": 12,
    "createdAt": "2026-06-08T10:00:00.000Z",
    "updatedAt": "2026-06-08T13:00:00.000Z"
  }
  ```

- **`403 Forbidden`** — Attempting to modify a system list.

  ```json
  {
    "message": "Cannot modify system lists",
    "error": "Forbidden",
    "statusCode": 403
  }
  ```

- **`404 Not Found`** — List does not exist.

  ```json
  {
    "message": "List not found",
    "error": "Not Found",
    "statusCode": 404
  }
  ```

- **`409 Conflict`** — New slug is reserved or already taken.

  ```json
  {
    "message": "A list with this slug already exists",
    "error": "Conflict",
    "statusCode": 409
  }
  ```

> **Note:** If `name` is updated without changing `slug`, the slug stays the same. The slug is NOT auto-regenerated when the name changes.

---

### 5. Delete a Custom List

- **Endpoint:** `DELETE /lists/:id`
- **Authentication:** Required
- **Response Body:** Empty

> **System lists** (`isSystem: true`) cannot be deleted. Returns `403 Forbidden`. Deleting a custom list removes all its items via DB cascade (`onDelete: 'CASCADE'`).

#### Path Parameters

| Param | Type            | Description |
| :---- | :-------------- | :---------- |
| `id`  | `string (UUID)` | The list ID |

#### Request Example

```
DELETE /lists/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

#### Responses

- **`200 OK`** — List deleted successfully. Response body is empty (204-like but explicitly 200).

- **`403 Forbidden`** — Attempting to delete a system list.

  ```json
  {
    "message": "Cannot delete system lists",
    "error": "Forbidden",
    "statusCode": 403
  }
  ```

- **`404 Not Found`** — List does not exist.

  ```json
  {
    "message": "List not found",
    "error": "Not Found",
    "statusCode": 404
  }
  ```

---

### 6. Add an Item to a List

- **Endpoint:** `POST /lists/:id/items`
- **Authentication:** Required
- **Content-Type:** `application/json`

The item's metadata (title, poster, release date, vote average) is **automatically fetched from TMDB** and cached for 60 seconds. The frontend only needs to supply `mediaType` and `tmdbId`.

> **Idempotent:** If the item already exists in the list, the existing item is returned — no duplicate is created. The response status is **always `201`** (the endpoint is decorated with `@HttpCode(HttpStatus.CREATED)`) regardless of whether the item was newly added or already existed.

#### Path Parameters

| Param | Type            | Description |
| :---- | :-------------- | :---------- |
| `id`  | `string (UUID)` | The list ID |

#### Request Body (`AddItemDto`)

| Field       | Type     | Required | Validation                  | Description                         |
| :---------- | :------- | :------: | :-------------------------- | :---------------------------------- |
| `mediaType` | `string` |   Yes    | Must be `"movie"` or `"tv"` | The media type                      |
| `tmdbId`    | `number` |   Yes    | Min: 1, integer             | The TMDB ID of the movie or TV show |

#### Request Example

```json
{
  "mediaType": "movie",
  "tmdbId": 27205
}
```

#### Responses

- **`201 Created`** — Item added successfully (or already existed — idempotent). Response body is a `ListItemResponseDto`.

  ```json
  {
    "id": "item-uuid-new",
    "mediaType": "movie",
    "tmdbId": 27205,
    "title": "Inception",
    "posterPath": "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
    "releaseDate": "2010-07-16",
    "voteAverage": 8.4,
    "addedAt": "2026-06-08T14:00:00.000Z"
  }
  ```

  If the item already existed, the returned `addedAt` will reflect the **original** timestamp when it was first added.

- **`404 Not Found`** — List does not exist.

  ```json
  {
    "message": "List not found",
    "error": "Not Found",
    "statusCode": 404
  }
  ```

- **`400 Bad Request`** — TMDB media not found or has no title.

  ```json
  {
    "message": "Media not found or has no title",
    "error": "Bad Request",
    "statusCode": 400
  }
  ```

- **`503 Service Unavailable`** — TMDB API is unreachable or returns an error.

  ```json
  {
    "message": "Failed to fetch media from TMDB: <error detail>",
    "error": "Service Unavailable",
    "statusCode": 503
  }
  ```

> **Note:** Unlike the Swagger annotation in the code (which lists `409` for duplicate items), the actual service **does not throw a 409**. It returns the existing item with a `201` status. The frontend should distinguish between newly added vs. already existing items by comparing the `addedAt` timestamp or tracking locally.

---

### 7. Remove an Item from a List

- **Endpoint:** `DELETE /lists/:id/items/:mediaType/:tmdbId`
- **Authentication:** Required
- **Response Body:** Empty

#### Path Parameters

| Param       | Type            | Description                       |
| :---------- | :-------------- | :-------------------------------- |
| `id`        | `string (UUID)` | The list ID                       |
| `mediaType` | `string`        | Must be `"movie"` or `"tv"`       |
| `tmdbId`    | `number`        | The TMDB ID of the item to remove |

#### Request Example

```
DELETE /lists/a1b2c3d4-e5f6-7890-abcd-ef1234567890/items/movie/27205
```

#### Responses

- **`200 OK`** — Item removed successfully. Response body is empty.

- **`404 Not Found`** — List does not exist or the item is not in the list.

  ```json
  {
    "message": "Item not found in list",
    "error": "Not Found",
    "statusCode": 404
  }
  ```

  > The endpoint first looks up the list; if the list isn't found, the message is `"List not found"`. If the item isn't in the list, the message is `"Item not found in list"`.

---

## Frontend Integration Workflows

### 1. Load All User Lists (Dashboard)

```
1. GET /lists?page=1&perPage=50
2. Render system lists (Favorites, Watchlist, Watched) prominently
3. Render custom lists below
4. Show item count badge on each list card
```

**Key detail:** The `isSystem` flag is available on each list. Use it to:
- Disable delete/rename actions on system lists
- Show a system icon/badge for system lists
- Sort system lists first (the backend already sorts them first)

### 2. View List Items

```
1. GET /lists/:id?page=1&perPage=20&sortBy=addedAt&order=DESC
2. Display list metadata (name, itemCount)
3. Render items grid/list with poster, title, rating, release date
4. Support pagination (load more / infinite scroll)
5. Optional: Add filter chips for mediaType (movie / tv)
6. Optional: Add sort controls (by title, rating, release date, date added)
```

### 3. Create a New List

```
1. User opens "Create List" modal/form
2. User enters list name (required, max 80 chars)
3. User optionally enters custom slug (max 100 chars, pattern: ^[a-z0-9-]+$)
4. POST /lists { name, slug? }
5. On 201: add new list to UI, show success toast
6. On 409: show "slug already taken" or "reserved slug" error
7. On 400: show field-level validation errors
```

### 4. Add Media to a List

```
1. User clicks "Add to List" on a movie/TV card (e.g., on a detail page)
2. Show dropdown of user's lists (fetch from GET /lists if not cached)
3. User selects target list
4. POST /lists/:listId/items { mediaType: "movie"|"tv", tmdbId: 550 }
5. On 201 success: show success toast, increment item count in UI
   - To detect duplicates locally, track which item IDs are already in which list
6. On 503: show "Media service temporarily unavailable" message
7. On 400: show "Media not found" error
```

### 5. Remove Media from a List

```
1. User clicks remove icon on an item inside a list view
2. Confirm with dialog: "Remove [Title] from [List Name]?"
3. DELETE /lists/:listId/items/:mediaType/:tmdbId
4. On 200: remove item from UI, decrement item count
5. On 404: item was already removed (reconcile UI)
```

### 6. Update or Delete a Custom List

```
1. User clicks edit icon on a custom list (hide for system lists)
2. PATCH /lists/:id { name: "New Name" } — optional fields
3. On 200: update list name in UI
4. User clicks delete icon on a custom list (hide for system lists)
5. Confirm with dialog: "Delete [List Name]? This cannot be undone."
6. DELETE /lists/:id
7. On 200: remove list from UI, navigate to /lists
8. On 403: show "System lists cannot be modified/deleted" (should not happen if UI hides actions)
```

---

## TMDB Poster URL Construction

The `posterPath` returned by the API is a **relative path**. Construct the full URL using the TMDB image base URL:

```typescript
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

// For posters (w500 is recommended for list/grid views):
const posterUrl = item.posterPath
  ? `${TMDB_IMAGE_BASE}/w500${item.posterPath}`
  : '/placeholder-poster.png';

// Example: https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QI4S2t0POoT.jpg

// For larger displays / backdrops:
const backdropUrl = item.posterPath
  ? `${TMDB_IMAGE_BASE}/w1280${item.posterPath}`
  : null;
```

**TMDB image sizes available:**
| Size | Use Case               |
| :--- | :--------------------- |
| w92  | Thumbnails             |
| w154 | Small cards            |
| w185 | List items             |
| w342 | Grid items             |
| w500 | Default poster view    |
| w780 | Detail view            |
| original | Full resolution    |

If `posterPath` is `null`, show a placeholder image.

---

## Error Handling Reference

| Status Code | Meaning                 | Frontend Action                                  |
| :---------- | :---------------------- | :----------------------------------------------- |
| `200`       | Success                 | Process response                                 |
| `201`       | Created                 | Process response, update UI                      |
| `400`       | Validation error        | Show field-level errors or toast                 |
| `403`       | Forbidden (system list) | Show "Cannot modify/delete system lists"         |
| `404`       | Not found               | Show "List not found" or "Item not found"        |
| `409`       | Conflict (slug)         | Show "Slug already taken" or "Reserved slug"     |
| `503`       | TMDB unavailable        | Show "Media service temporarily unavailable"     |

### Common Error Body Shape

```json
{
  "message": "string | string[]",
  "error": "string",
  "statusCode": number
}
```

- Validation errors (400) return `message` as a **string array** (one per failed constraint).
- Business logic errors (404, 403, 409) return `message` as a **single string**.
- Service errors (503) return `message` as a **single string** with detail.

---

## Frontend Code Reference (Axios Example)

```typescript
import { apiClient } from '@/lib/axios'; // your configured axios instance

// ── Types ──────────────────────────────────────────────────────────

interface ListResponse {
  id: string;
  name: string;
  slug: string;
  listKey: string;
  isSystem: boolean;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ListItemResponse {
  id: string;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  posterPath: string | null;
  releaseDate: string | null;
  voteAverage: number | null;
  addedAt: string;
}

interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  lastPage: number;
}

interface SingleListWithItems {
  list: ListResponse;
  items: PaginatedResult<ListItemResponse>;
}

// ── Enums ───────────────────────────────────────────────────────────

const MediaType = {
  MOVIE: 'movie' as const,
  TV: 'tv' as const,
} as const;

const SystemListKey = {
  FAVORITES: 'favorites' as const,
  WATCHLIST: 'watchlist' as const,
  WATCHED: 'watched' as const,
} as const;

// ── API Client ──────────────────────────────────────────────────────

export const listsApi = {
  /** Create a new custom list */
  create(data: { name: string; slug?: string }) {
    return apiClient.post<ListResponse>('/lists', data);
  },

  /** Get all lists for the current user */
  getAll(params?: { page?: number; perPage?: number }) {
    return apiClient.get<PaginatedResult<ListResponse>>('/lists', { params });
  },

  /** Get a single list with its items (paginated, filterable, sortable) */
  getById(
    id: string,
    params?: {
      page?: number;
      perPage?: number;
      mediaType?: 'movie' | 'tv';
      sortBy?: 'addedAt' | 'title' | 'releaseDate' | 'voteAverage';
      order?: 'ASC' | 'DESC';
    },
  ) {
    return apiClient.get<SingleListWithItems>(`/lists/${id}`, { params });
  },

  /** Update (rename/re-slug) a custom list */
  update(id: string, data: { name?: string; slug?: string }) {
    return apiClient.patch<ListResponse>(`/lists/${id}`, data);
  },

  /** Delete a custom list (and all its items) */
  remove(id: string) {
    return apiClient.delete<void>(`/lists/${id}`);
  },

  /** Add an item to a list (idempotent — returns existing item if already present) */
  addItem(listId: string, data: { mediaType: 'movie' | 'tv'; tmdbId: number }) {
    return apiClient.post<ListItemResponse>(`/lists/${listId}/items`, data);
  },

  /** Remove an item from a list */
  removeItem(listId: string, mediaType: string, tmdbId: number) {
    return apiClient.delete<void>(`/lists/${listId}/items/${mediaType}/${tmdbId}`);
  },
};
```

---

## Database Schema Reference (for Debugging / Understanding)

### `user_lists` table

| Column       | Type                    | Constraints                  |
| :----------- | :---------------------- | :--------------------------- |
| `id`         | `uuid`                  | PK, auto-generated           |
| `user_id`    | `int`                   | FK to users table            |
| `name`       | `varchar(80)`           | Not null                     |
| `slug`       | `varchar(100)`          | Unique per user (composite)  |
| `list_key`   | `varchar(40)`           | Unique per user (composite)  |
| `is_system`  | `boolean`               | Default `false`              |
| `created_at` | `timestamp`             | Auto-set                     |
| `updated_at` | `timestamp`             | Auto-updated                 |

**Indexes:** Unique composite on `(user_id, list_key)`, unique composite on `(user_id, slug)`.

### `user_list_items` table

| Column        | Type                    | Constraints                  |
| :------------ | :---------------------- | :--------------------------- |
| `id`          | `uuid`                  | PK, auto-generated           |
| `list_id`     | `uuid`                  | FK to user_lists, CASCADE    |
| `user_id`     | `int`                   | Denormalized for query perf  |
| `media_type`  | `enum` (`movie`, `tv`)  | Not null                     |
| `tmdb_id`     | `int`                   | Not null                     |
| `title`       | `varchar(500)`          | TMDB snapshot                |
| `poster_path` | `varchar(255)`          | Nullable                     |
| `release_date`| `date`                  | Nullable                     |
| `vote_average`| `numeric(4,1)`          | Nullable                     |
| `added_at`    | `timestamp`             | Auto-set                     |

**Indexes:** Unique composite on `(list_id, media_type, tmdb_id)`.

---

## Quick Reference: All Routes

```
POST   /lists                                      → Create custom list
GET    /lists                                      → List all user lists (paginated)
GET    /lists/:id                                  → Get list + items (paginated, filterable, sortable)
PATCH  /lists/:id                                  → Update custom list (name and/or slug)
DELETE /lists/:id                                  → Delete custom list + cascade items
POST   /lists/:id/items                            → Add item to list (idempotent, always 201)
DELETE /lists/:id/items/:mediaType/:tmdbId         → Remove specific item from list
```

---

## Key Behavioral Notes for the Frontend

1. **System lists are immutable.** The `isSystem: true` flag means the list cannot be renamed, re-slung, or deleted. Always disable edit/delete UI controls for system lists.

2. **`addItem` is idempotent with a `201` status.** Both new and duplicate items return HTTP `201`. If you need to distinguish, compare locally whether the item was already rendered. The Swagger annotation in the backend mentions a `409` for duplicates, but the actual implementation returns the existing item with `201` — no error.

3. **Slug uniqueness is per-user.** Two different users can have the same slug. The unique constraint is `(user_id, slug)`.

4. **`itemCount` on GET `/lists/:id` is unfiltered.** Even when `mediaType` filter is applied to items, the `itemCount` field shows the total number of items in the list (not filtered).

5. **TMDB data is cached server-side for 60 seconds.** The same media title fetched within 60 seconds will return cached data, reducing TMDB API calls.

6. **Deleting a list cascades to all its items.** When you `DELETE /lists/:id`, all items are removed automatically by the database.

7. **Nullable fields on items:** `posterPath`, `releaseDate`, and `voteAverage` can be `null` — always handle these cases in rendering.
