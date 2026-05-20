# Blog Module — Frontend Integration Plan

> **Backend:** NestJS v11 · TypeORM · PostgreSQL
> **Last Updated:** 2026-05-20
> **Audience:** Frontend / Full-Stack Developers

---

## Table of Contents

1. [API Endpoint Map](#1-api-endpoint-map)
2. [TypeScript Types & Interfaces](#2-typescript-types--interfaces)
3. [API Client Setup](#3-api-client-setup)
4. [React Query Hooks](#4-react-query-hooks)
5. [Error Handling & Validation Mapping](#5-error-handling--validation-mapping)
6. [Pagination & Filtering](#6-pagination--filtering)
7. [Cover Image Handling](#7-cover-image-handling)
8. [Caching & Invalidation Strategy](#8-caching--invalidation-strategy)
9. [Example Usage (Next.js / React)](#9-example-usage-nextjs--react)
10. [Gotchas & Edge Cases](#10-gotchas--edge-cases)

---

## 1. API Endpoint Map

### 1.1 Admin Endpoints (JWT + `ADMIN` role required)

| Method | Path | Description | Auth | Request Body | Success Response | Error Codes |
|--------|------|-------------|------|-------------|------------------|-------------|
| `POST` | `/admin/blog` | Create article | Required | [`CreateArticleDto`](#createarticledto) | [`Article`](#article) | `400`, `401`, `403` |
| `PATCH` | `/admin/blog/:id` | Update article | Required | [`UpdateArticleDto`](#updatearticledto) | [`Article`](#article) | `400`, `401`, `403`, `404` |
| `PATCH` | `/admin/blog/:id/publish` | Toggle publish | Required | _none_ | [`TogglePublishResponse`](#togglepublishresponse) | `400`, `401`, `403`, `404` |
| `DELETE` | `/admin/blog/:id` | Delete article | Required | _none_ | [`DeleteResponse`](#deleteresponse) | `401`, `403`, `404` |
| `GET` | `/admin/blog` | List all articles | Required | _query params_ | [`PaginatedArticles`](#paginatedarticles) | `401`, `403` |

### 1.2 Public Endpoints (No auth required)

| Method | Path | Description | Auth | Request Body | Success Response | Error Codes |
|--------|------|-------------|------|-------------|------------------|-------------|
| `GET` | `/blog` | List published articles | None | _query params_ | [`PaginatedArticles`](#paginatedarticles) | — |
| `GET` | `/blog/:slug` | Get article by slug | None | _none_ | [`Article`](#article) | `404` |

### 1.3 Query Parameters

#### Admin List (`GET /admin/blog`)

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `page` | `number` | `1` | — | Page number (≥ 1) |
| `limit` | `number` | `10` | `1000` | Items per page |
| `sortBy` | `string` | `createdAt` | — | One of: `createdAt`, `updatedAt`, `viewsCount`, `publishedAt`, `title` |
| `order` | `string` | `DESC` | — | `ASC` or `DESC` |
| `categoryId` | `UUID` | — | — | Filter by category |
| `tag` | `string` | — | — | Filter by tag (case-insensitive) |
| `search` | `string` | — | — | Search by title (ILIKE) |
| `isPublished` | `boolean` | — | — | Filter by publish status |

#### Public List (`GET /blog`)

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `page` | `number` | `1` | — | Page number (≥ 1) |
| `limit` | `number` | `10` | `1000` | Items per page |
| `sortBy` | `string` | `createdAt` | — | Same allowed fields as admin |
| `order` | `string` | `DESC` | — | `ASC` or `DESC` |
| `categoryId` | `UUID` | — | — | Filter by category |
| `tag` | `string` | — | — | Filter by tag (case-insensitive) |

> **Note:** Public endpoints do **not** support `search` or `isPublished` filters. They always return only published articles.

---

## 2. TypeScript Types & Interfaces

### 2.1 Core Entities

```typescript
// ─── Article (full, from admin endpoints) ───────────────────────────────
export interface Article {
  id: string;              // UUID
  title: string;           // max 300 chars
  slug: string;            // unique, auto-generated from title
  excerpt: string | null;  // optional, required before publishing
  content: string;         // HTML content
  coverImageUrl: string | null;
  tags: string[];          // normalized: lowercase, trimmed, deduplicated
  categoryId: string | null;
  category: Category | null;
  isPublished: boolean;
  publishedAt: Date | null;
  readTimeMinutes: number; // auto-calculated (200 wpm)
  viewsCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Category (nested relation) ─────────────────────────────────────────
export interface Category {
  id: string;
  name: string;
  slug: string;
}
```

### 2.2 Request DTOs

```typescript
// ─── CreateArticleDto ───────────────────────────────────────────────────
export interface CreateArticleDto {
  title: string;           // required, max 300 chars
  content: string;         // required, HTML string
  excerpt?: string;        // optional
  coverImageUrl?: string;  // optional, must be valid URL
  tags?: string[];         // optional, each item is a string
  categoryId?: string;     // optional, UUID
}

// ─── UpdateArticleDto (all fields optional, same shape) ─────────────────
export type UpdateArticleDto = Partial<CreateArticleDto>;
```

### 2.3 Response Wrappers

```typescript
// ─── Paginated Response ─────────────────────────────────────────────────
export interface PaginatedArticles {
  data: Article[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── Toggle Publish Response ────────────────────────────────────────────
export interface TogglePublishResponse {
  id: string;
  isPublished: boolean;
  publishedAt: Date | null;
  message: string; // "Article published successfully" | "Article unpublished successfully"
}

// ─── Delete Response ────────────────────────────────────────────────────
export interface DeleteResponse {
  message: string; // "Article deleted successfully"
}
```

### 2.4 Error Response Shape (Global)

```typescript
// ─── Standard Error (from GlobalExceptionFilter) ────────────────────────
export interface ApiError {
  statusCode: number;
  message: string;
  errors?: Array<{ field: string; message: string }>; // validation errors
  timestamp: string;   // ISO 8601
  path: string;        // request URL
}
```

### 2.5 Query Parameter Types

```typescript
// ─── Admin List Query ───────────────────────────────────────────────────
export interface AdminArticlesQuery {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'viewsCount' | 'publishedAt' | 'title';
  order?: 'ASC' | 'DESC';
  categoryId?: string;
  tag?: string;
  search?: string;
  isPublished?: boolean;
}

// ─── Public List Query ──────────────────────────────────────────────────
export interface PublicArticlesQuery {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'viewsCount' | 'publishedAt' | 'title';
  order?: 'ASC' | 'DESC';
  categoryId?: string;
  tag?: string;
}
```

---

## 3. API Client Setup

### 3.1 Base Axios Instance

```typescript
// lib/api/client.ts
import axios, { AxiosError } from 'axios';
import type { ApiError } from '@/types/blog';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token from cookies/localStorage
api.interceptors.request.use((config) => {
  const token = getAuthToken(); // your auth helper
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Normalize error shape
api.interceptors.response.use(
  (res) => res,
  (error: AxiosError<ApiError>) => {
    const apiError: ApiError = error.response?.data ?? {
      statusCode: error.response?.status ?? 500,
      message: error.message ?? 'Unknown error',
      timestamp: new Date().toISOString(),
      path: error.config?.url ?? '',
    };
    return Promise.reject(apiError);
  },
);

export default api;
```

### 3.2 Blog API Functions

```typescript
// lib/api/blog.ts
import api from './client';
import type {
  Article,
  CreateArticleDto,
  UpdateArticleDto,
  PaginatedArticles,
  TogglePublishResponse,
  DeleteResponse,
  AdminArticlesQuery,
  PublicArticlesQuery,
} from '@/types/blog';

// ─── Admin ──────────────────────────────────────────────────────────────

export async function adminCreateArticle(dto: CreateArticleDto): Promise<Article> {
  const { data } = await api.post<Article>('/admin/blog', dto);
  return data;
}

export async function adminUpdateArticle(
  id: string,
  dto: UpdateArticleDto,
): Promise<Article> {
  const { data } = await api.patch<Article>(`/admin/blog/${id}`, dto);
  return data;
}

export async function adminTogglePublish(id: string): Promise<TogglePublishResponse> {
  const { data } = await api.patch<TogglePublishResponse>(`/admin/blog/${id}/publish`);
  return data;
}

export async function adminDeleteArticle(id: string): Promise<DeleteResponse> {
  const { data } = await api.delete<DeleteResponse>(`/admin/blog/${id}`);
  return data;
}

export async function adminListArticles(
  query: AdminArticlesQuery = {},
): Promise<PaginatedArticles> {
  const { data } = await api.get<PaginatedArticles>('/admin/blog', { params: query });
  return data;
}

// ─── Public ─────────────────────────────────────────────────────────────

export async function publicListArticles(
  query: PublicArticlesQuery = {},
): Promise<PaginatedArticles> {
  const { data } = await api.get<PaginatedArticles>('/blog', { params: query });
  return data;
}

export async function publicGetArticleBySlug(slug: string): Promise<Article> {
  const { data } = await api.get<Article>(`/blog/${slug}`);
  return data;
}
```

---

## 4. React Query Hooks

### 4.1 Query Keys Factory

```typescript
// lib/api/blog-keys.ts
export const blogKeys = {
  all: ['blog'] as const,
  lists: () => [...blogKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) =>
    [...blogKeys.lists(), { filters }] as const,
  details: () => [...blogKeys.all, 'detail'] as const,
  detail: (slug: string) => [...blogKeys.details(), slug] as const,
  adminLists: () => [...blogKeys.all, 'admin', 'list'] as const,
  adminList: (filters: Record<string, unknown>) =>
    [...blogKeys.adminLists(), { filters }] as const,
};
```

### 4.2 Public Hooks (for blog pages)

```typescript
// hooks/use-blog.ts
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { blogKeys } from '@/lib/api/blog-keys';
import { publicListArticles, publicGetArticleBySlug } from '@/lib/api/blog';
import type { PublicArticlesQuery } from '@/types/blog';

export function usePublishedArticles(query: PublicArticlesQuery = {}) {
  return useQuery({
    queryKey: blogKeys.list(query),
    queryFn: () => publicListArticles(query),
    staleTime: 60_000, // 1 minute — blog content is relatively static
  });
}

export function useArticleBySlug(slug: string) {
  return useQuery({
    queryKey: blogKeys.detail(slug),
    queryFn: () => publicGetArticleBySlug(slug),
    staleTime: 5 * 60_000, // 5 minutes
  });
}
```

### 4.3 Admin Hooks (for CMS/dashboard)

```typescript
// hooks/use-admin-blog.ts
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { blogKeys } from '@/lib/api/blog-keys';
import {
  adminListArticles,
  adminCreateArticle,
  adminUpdateArticle,
  adminTogglePublish,
  adminDeleteArticle,
} from '@/lib/api/blog';
import type {
  AdminArticlesQuery,
  CreateArticleDto,
  UpdateArticleDto,
} from '@/types/blog';

export function useAdminArticles(query: AdminArticlesQuery = {}) {
  return useQuery({
    queryKey: blogKeys.adminList(query),
    queryFn: () => adminListArticles(query),
    staleTime: 30_000,
  });
}

export function useCreateArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminCreateArticle,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: blogKeys.adminLists() });
      qc.invalidateQueries({ queryKey: blogKeys.lists() });
    },
  });
}

export function useUpdateArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateArticleDto }) =>
      adminUpdateArticle(id, dto),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: blogKeys.adminLists() });
      qc.invalidateQueries({ queryKey: blogKeys.lists() });
      qc.invalidateQueries({ queryKey: blogKeys.details() });
    },
  });
}

export function useTogglePublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminTogglePublish,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: blogKeys.adminLists() });
      qc.invalidateQueries({ queryKey: blogKeys.lists() });
      qc.invalidateQueries({ queryKey: blogKeys.details() });
    },
  });
}

export function useDeleteArticle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminDeleteArticle,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: blogKeys.adminLists() });
      qc.invalidateQueries({ queryKey: blogKeys.lists() });
    },
  });
}
```

---

## 5. Error Handling & Validation Mapping

### 5.1 HTTP Status Codes & Meanings

| Status | When | Frontend Action |
|--------|------|-----------------|
| `400` | Validation failure, missing excerpt on publish | Show inline form errors from `errors[]` array |
| `401` | Missing or expired JWT | Redirect to login |
| `403` | User lacks `ADMIN` role | Show "Unauthorized" page |
| `404` | Article not found (by ID or slug) | Show "Not Found" page |
| `409` | Slug conflict (rare — auto-generated slugs handle this) | Retry or show generic error |
| `500` | Server error | Show generic error toast |

### 5.2 Validation Error Parsing

The backend returns validation errors in this shape:

```json
{
  "statusCode": 400,
  "message": [
    "title must be shorter than or equal to 300 characters",
    "coverImageUrl must be a URL address"
  ],
  "timestamp": "2026-05-20T12:00:00.000Z",
  "path": "/admin/blog"
}
```

**Frontend helper to map to form errors:**

```typescript
// lib/api/error-utils.ts
import type { ApiError } from '@/types/blog';

export function parseValidationErrors(error: ApiError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  if (Array.isArray(error.errors)) {
    // Structured errors: [{ field: 'title', message: '...' }]
    error.errors.forEach((e) => {
      fieldErrors[e.field] = e.message;
    });
  } else if (Array.isArray(error.message)) {
    // NestJS default: ["title must be...", "content must be..."]
    error.message.forEach((msg) => {
      // Extract field name from message like "title must be..."
      const match = msg.match(/^(\w+)\s/);
      if (match) {
        fieldErrors[match[1]] = msg;
      }
    });
  } else if (typeof error.message === 'string') {
    // Single error message (e.g., "Excerpt is required before publishing")
    fieldErrors._global = error.message;
  }

  return fieldErrors;
}
```

### 5.3 Known Backend Validation Rules

| Field | Rule | Error Message Pattern |
|-------|------|----------------------|
| `title` | Required, max 300 chars | `"title must be shorter than or equal to 300 characters"` |
| `content` | Required | `"content should not be empty"` |
| `coverImageUrl` | Must be valid URL if provided | `"coverImageUrl must be a URL address"` |
| `tags[]` | Each item must be a string | `"each value in tags must be a string"` |
| `categoryId` | Must be valid UUID if provided | `"categoryId must be a UUID"` |
| `excerpt` | Required before publishing | `"Excerpt is required before publishing an article"` (400 on togglePublish) |
| `page` | Min 1 | `"page must not be less than 1"` |
| `limit` | Min 1, Max 1000 | `"limit must not be greater than 1000"` |
| `sortBy` | Whitelisted fields only | `"sortBy must be one of the following values: ..."` |

---

## 6. Pagination & Filtering

### 6.1 URL State Pattern (Next.js App Router)

```typescript
// app/admin/blog/page.tsx
'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useAdminArticles } from '@/hooks/use-admin-blog';

export default function AdminBlogPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const page = Number(searchParams.get('page')) || 1;
  const limit = Number(searchParams.get('limit')) || 10;
  const search = searchParams.get('search') || undefined;
  const tag = searchParams.get('tag') || undefined;
  const categoryId = searchParams.get('categoryId') || undefined;
  const isPublished = searchParams.get('isPublished');
  const sortBy = (searchParams.get('sortBy') as any) || 'createdAt';
  const order = (searchParams.get('order') as any) || 'DESC';

  const { data, isLoading } = useAdminArticles({
    page,
    limit,
    search,
    tag,
    categoryId,
    isPublished: isPublished !== null ? isPublished === 'true' : undefined,
    sortBy,
    order,
  });

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null) params.delete(key);
    else params.set(key, value);
    router.replace(`${pathname}?${params.toString()}`);
  };

  // ... render table with data?.data, pagination from data?.meta
}
```

### 6.2 Pagination Helper Component

```typescript
// components/Pagination.tsx
interface PaginationProps {
  meta: { page: number; limit: number; total: number; totalPages: number };
  onPageChange: (page: number) => void;
}

export function Pagination({ meta, onPageChange }: PaginationProps) {
  if (meta.totalPages <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <button
        disabled={meta.page === 1}
        onClick={() => onPageChange(meta.page - 1)}
      >
        Previous
      </button>
      <span>
        Page {meta.page} of {meta.totalPages} ({meta.total} total)
      </span>
      <button
        disabled={meta.page === meta.totalPages}
        onClick={() => onPageChange(meta.page + 1)}
      >
        Next
      </button>
    </div>
  );
}
```

### 6.3 Filter State Management

```typescript
// hooks/use-article-filters.ts
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback } from 'react';

interface UseArticleFiltersReturn {
  filters: {
    search?: string;
    tag?: string;
    categoryId?: string;
    isPublished?: boolean;
  };
  setFilter: (key: string, value: string | null) => void;
  clearFilters: () => void;
}

export function useArticleFilters(): UseArticleFiltersReturn {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const setFilter = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', '1'); // reset to page 1 on filter change
    if (value === null) params.delete(key);
    else params.set(key, value);
    router.replace(`${pathname}?${params.toString()}`);
  }, [searchParams, router, pathname]);

  const clearFilters = useCallback(() => {
    router.replace(pathname);
  }, [router, pathname]);

  return {
    filters: {
      search: searchParams.get('search') || undefined,
      tag: searchParams.get('tag') || undefined,
      categoryId: searchParams.get('categoryId') || undefined,
      isPublished: searchParams.has('isPublished')
        ? searchParams.get('isPublished') === 'true'
        : undefined,
    },
    setFilter,
    clearFilters,
  };
}
```

---

## 7. Cover Image Handling

### 7.1 Current Backend Behavior

- `coverImageUrl` is a **string URL field**, not a file upload endpoint.
- The frontend is responsible for uploading images to a storage service (S3, Cloudinary, etc.) and passing the resulting URL.
- On article deletion, the backend **logs a warning** but does **not** delete the cover image from storage:
  ```
  Cover image purge deferred { url: "..." }
  ```

### 7.2 Recommended Frontend Flow

```
1. User selects image in form
2. Frontend uploads to storage service → receives URL
3. Frontend passes URL in CreateArticleDto / UpdateArticleDto
4. On article delete: optionally trigger storage cleanup via separate job
```

### 7.3 Implementation Example

```typescript
// hooks/use-cover-image-upload.ts
import { useState } from 'react';

interface UseCoverImageUploadReturn {
  coverImageUrl: string | null;
  isUploading: boolean;
  error: string | null;
  upload: (file: File) => Promise<void>;
  remove: () => void;
}

export function useCoverImageUpload(): UseCoverImageUploadReturn {
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setIsUploading(true);
    setError(null);
    try {
      // Replace with your actual upload service
      const url = await uploadToStorage(file);
      setCoverImageUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const remove = () => setCoverImageUrl(null);

  return { coverImageUrl, isUploading, error, upload, remove };
}

async function uploadToStorage(file: File): Promise<string> {
  // Example: upload to S3/Cloudinary via presigned URL or direct API
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  if (!res.ok) throw new Error('Upload failed');
  const { url } = await res.json();
  return url;
}
```

### 7.4 Form Integration

```typescript
// In your article form:
const { coverImageUrl, isUploading, upload, remove } = useCoverImageUpload();

// When submitting:
const dto: CreateArticleDto = {
  title,
  content,
  excerpt: excerpt || undefined,
  coverImageUrl: coverImageUrl || undefined,
  tags: tagsArray,
  categoryId: selectedCategoryId || undefined,
};
```

---

## 8. Caching & Invalidation Strategy

### 8.1 Cache Durations

| Query Type | `staleTime` | Rationale |
|------------|-------------|-----------|
| Public article list | `60_000` (1 min) | Blog content changes infrequently |
| Public article detail | `300_000` (5 min) | Single article is very stable |
| Admin article list | `30_000` (30 sec) | Admin needs fresher data |

### 8.2 Invalidation Rules

| Mutation | Invalidates |
|----------|-------------|
| `createArticle` | `blogKeys.adminLists()`, `blogKeys.lists()` |
| `updateArticle` | `blogKeys.adminLists()`, `blogKeys.lists()`, `blogKeys.details()` |
| `togglePublish` | `blogKeys.adminLists()`, `blogKeys.lists()`, `blogKeys.details()` |
| `deleteArticle` | `blogKeys.adminLists()`, `blogKeys.lists()` |

### 8.3 Optimistic Updates (Optional)

For `togglePublish`, consider optimistic updates:

```typescript
export function useTogglePublishOptimistic() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: adminTogglePublish,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: blogKeys.adminLists() });
      const previous = qc.getQueryData(blogKeys.adminLists());

      // Optimistically toggle in the list
      qc.setQueryData(blogKeys.adminLists(), (old: PaginatedArticles | undefined) => {
        if (!old) return old;
        return {
          ...old,
          data: old.data.map((a) =>
            a.id === id
              ? { ...a, isPublished: !a.isPublished, publishedAt: a.isPublished ? null : new Date() }
              : a,
          ),
        };
      });

      return { previous };
    },
    onError: (_err, _id, context) => {
      qc.setQueryData(blogKeys.adminLists(), context?.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: blogKeys.adminLists() });
    },
  });
}
```

### 8.4 Prefetching (Next.js Server Components)

```typescript
// app/blog/[slug]/page.tsx
import { QueryClient, dehydrate, HydrationBoundary } from '@tanstack/react-query';
import { blogKeys } from '@/lib/api/blog-keys';
import { publicGetArticleBySlug } from '@/lib/api/blog';

export async function generateStaticParams() {
  // Return slugs for SSG if desired
}

export default async function ArticlePage({ params }: { params: { slug: string } }) {
  const queryClient = new QueryClient();

  await queryClient.prefetchQuery({
    queryKey: blogKeys.detail(params.slug),
    queryFn: () => publicGetArticleBySlug(params.slug),
    staleTime: 5 * 60_000,
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ArticleClient slug={params.slug} />
    </HydrationBoundary>
  );
}
```

---

## 9. Example Usage (Next.js / React)

### 9.1 Public Blog Listing Page

```typescript
// app/blog/page.tsx
import { Suspense } from 'react';
import { BlogList } from '@/components/blog/blog-list';
import { BlogFilters } from '@/components/blog/blog-filters';

export default function BlogPage() {
  return (
    <main>
      <h1>Blog</h1>
      <BlogFilters />
      <Suspense fallback={<ArticleListSkeleton />}>
        <BlogList />
      </Suspense>
    </main>
  );
}

// app/blog/page.tsx (client component)
'use client';

import { usePublishedArticles } from '@/hooks/use-blog';
import { useArticleFilters } from '@/hooks/use-article-filters';
import { Pagination } from '@/components/Pagination';
import { useSearchParams } from 'next/navigation';

export function BlogList() {
  const searchParams = useSearchParams();
  const page = Number(searchParams.get('page')) || 1;
  const limit = Number(searchParams.get('limit')) || 10;
  const tag = searchParams.get('tag') || undefined;
  const categoryId = searchParams.get('categoryId') || undefined;

  const { data, isLoading, error } = usePublishedArticles({
    page, limit, tag, categoryId,
  });

  if (isLoading) return <ArticleListSkeleton />;
  if (error) return <ErrorMessage error={error} />;
  if (!data?.data.length) return <EmptyState />;

  return (
    <>
      <ArticleGrid articles={data.data} />
      <Pagination meta={data.meta} onPageChange={(p) => setParam('page', String(p))} />
    </>
  );
}
```

### 9.2 Admin Article Form (Create/Edit)

```typescript
// app/admin/blog/new/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateArticle } from '@/hooks/use-admin-blog';
import { useCoverImageUpload } from '@/hooks/use-cover-image-upload';
import { parseValidationErrors } from '@/lib/api/error-utils';
import type { CreateArticleDto } from '@/types/blog';

export default function NewArticlePage() {
  const router = useRouter();
  const createMutation = useCreateArticle();
  const { coverImageUrl, isUploading, upload, remove: removeCover } = useCoverImageUpload();
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormErrors({});

    const formData = new FormData(e.currentTarget);
    const dto: CreateArticleDto = {
      title: formData.get('title') as string,
      content: formData.get('content') as string,
      excerpt: (formData.get('excerpt') as string) || undefined,
      coverImageUrl: coverImageUrl || undefined,
      tags: (formData.get('tags') as string)
        ?.split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      categoryId: (formData.get('categoryId') as string) || undefined,
    };

    try {
      await createMutation.mutateAsync(dto);
      router.push('/admin/blog');
    } catch (err: any) {
      setFormErrors(parseValidationErrors(err));
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Title */}
      <input name="title" required maxLength={300} />
      {formErrors.title && <span className="error">{formErrors.title}</span>}

      {/* Content (Rich Text Editor) */}
      <RichTextEditor name="content" />
      {formErrors.content && <span className="error">{formErrors.content}</span>}

      {/* Excerpt */}
      <textarea name="excerpt" />

      {/* Cover Image */}
      <CoverImageUploader
        onUpload={upload}
        onRemove={removeCover}
        currentUrl={coverImageUrl}
        isUploading={isUploading}
      />

      {/* Tags */}
      <input name="tags" placeholder="tag1, tag2, tag3" />

      {/* Category */}
      <CategorySelect name="categoryId" />

      {formErrors._global && <Alert variant="error">{formErrors._global}</Alert>}

      <button type="submit" disabled={createMutation.isPending}>
        {createMutation.isPending ? 'Saving...' : 'Create Article'}
      </button>
    </form>
  );
}
```

### 9.3 Admin Article List with Actions

```typescript
// app/admin/blog/page.tsx
'use client';

import { useAdminArticles, useTogglePublish, useDeleteArticle } from '@/hooks/use-admin-blog';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Pagination } from '@/components/Pagination';

export default function AdminBlogPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const page = Number(searchParams.get('page')) || 1;
  const limit = Number(searchParams.get('limit')) || 10;
  const search = searchParams.get('search') || undefined;
  const isPublished = searchParams.get('isPublished');

  const { data, isLoading } = useAdminArticles({
    page, limit, search,
    isPublished: isPublished !== null ? isPublished === 'true' : undefined,
  });

  const togglePublish = useTogglePublish();
  const deleteArticle = useDeleteArticle();

  const handleTogglePublish = async (id: string) => {
    await togglePublish.mutateAsync(id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure? This cannot be undone.')) return;
    await deleteArticle.mutateAsync(id);
  };

  if (isLoading) return <TableSkeleton />;

  return (
    <div>
      <SearchBar />
      <FilterTabs />
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Views</th>
            <th>Published</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data?.data.map((article) => (
            <tr key={article.id}>
              <td>{article.title}</td>
              <td>
                <Badge variant={article.isPublished ? 'green' : 'gray'}>
                  {article.isPublished ? 'Published' : 'Draft'}
                </Badge>
              </td>
              <td>{article.viewsCount}</td>
              <td>{article.publishedAt ? new Date(article.publishedAt).toLocaleDateString() : '—'}</td>
              <td>
                <button onClick={() => handleTogglePublish(article.id)}>
                  {article.isPublished ? 'Unpublish' : 'Publish'}
                </button>
                <Link href={`/admin/blog/${article.id}/edit`}>Edit</Link>
                <button onClick={() => handleDelete(article.id)} disabled={deleteArticle.isPending}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data && <Pagination meta={data.meta} onPageChange={(p) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('page', String(p));
        router.replace(`${pathname}?${params.toString()}`);
      }} />}
    </div>
  );
}
```

---

## 10. Gotchas & Edge Cases

### 10.1 Slug Auto-Generation

- The backend **auto-generates slugs** from the title using `generateUniqueSlug()`.
- The frontend **should not** send a `slug` field — it's computed server-side.
- If the title changes during an update, the slug is **regenerated** (with uniqueness check).
- **Implication:** After updating a title, the article's URL changes. Update any cached references.

### 10.2 Read Time Calculation

- `readTimeMinutes` is **auto-calculated** on create/update (200 words per minute, HTML tags stripped).
- The frontend should **not** send `readTimeMinutes` — it's ignored.
- Display it as read-only metadata.

### 10.3 Tags Normalization

- Tags are **normalized server-side**: trimmed, lowercased, empty strings removed.
- Frontend can send any casing/format; the backend handles normalization via `@BeforeInsert()` / `@BeforeUpdate()`.

### 10.4 Publish Toggle Requires Excerpt

- Calling `PATCH /admin/blog/:id/publish` on an unpublished article **will fail with 400** if `excerpt` is empty/null.
- **Frontend guard:** Disable the "Publish" button until an excerpt is provided.

### 10.5 Views Count Increment

- `GET /blog/:slug` **increments `viewsCount`** atomically via `repository.increment()`.
- The response includes the **updated count** (re-fetched after increment).
- **Do not** call this endpoint on hover or prefetch — only on actual page views.
- For Next.js: use `export const dynamic = 'force-dynamic'` on the article page to prevent SSG from inflating counts at build time.

### 10.6 Cover Image Orphaning

- Deleting an article **does not delete** the cover image from storage.
- The backend logs: `"Cover image purge deferred"`.
- **Recommendation:** Implement a background cleanup job or handle cover image deletion on the frontend after article deletion confirmation.

### 10.7 Boolean Query Param Parsing

- The backend uses `@Transform()` to parse `isPublished` from query strings.
- Accepted values: `'true'`, `true`, `1`, `'1'`.
- **Frontend:** Always send `?isPublished=true` or `?isPublished=false` as strings in query params.

### 10.8 Category Relation

- Articles include the `category` relation in list and detail responses.
- If `categoryId` is set but the category is deleted (via `SET NULL` cascade), `category` will be `null` but `categoryId` remains.
- **Frontend:** Handle `article.category === null` gracefully in UI.

### 10.9 Sort Field Whitelist

- The backend **whitelists** sortable fields: `createdAt`, `updatedAt`, `viewsCount`, `publishedAt`, `title`.
- Any other sort field defaults to `createdAt`.
- **Frontend:** Only expose these fields as sortable columns in the admin table.

---

## Appendix A: Complete File Structure (Frontend)

```
frontend/
├── types/
│   └── blog.ts                 # All TypeScript interfaces
├── lib/
│   └── api/
│       ├── client.ts           # Axios instance
│       ├── blog.ts             # API functions
│       ├── blog-keys.ts        # React Query keys
│       └── error-utils.ts      # Error parsing helpers
├── hooks/
│   ├── use-blog.ts             # Public query hooks
│   ├── use-admin-blog.ts       # Admin mutation hooks
│   ├── use-article-filters.ts  # URL-based filter state
│   └── use-cover-image-upload.ts
├── components/
│   ├── blog/
│   │   ├── blog-list.tsx
│   │   ├── blog-filters.tsx
│   │   └── article-card.tsx
│   ├── admin/
│   │   ├── article-form.tsx
│   │   └── article-table.tsx
│   └── Pagination.tsx
└── app/
    ├── blog/
    │   ├── page.tsx            # Public listing
    │   └── [slug]/
    │       └── page.tsx        # Public detail
    └── admin/
        └── blog/
            ├── page.tsx        # Admin listing
            ├── new/
            │   └── page.tsx    # Create form
            └── [id]/
                └── edit/
                    └── page.tsx # Edit form
```

---

## Appendix B: Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│  BLOG MODULE — QUICK REFERENCE                                  │
├─────────────────────────────────────────────────────────────────┤
│  Admin Base:  POST/PATCH/DELETE/GET /admin/blog                 │
│  Public Base: GET /blog, GET /blog/:slug                        │
│  Auth:        JWT + ADMIN role (admin), None (public)           │
│  Pagination:  ?page=1&limit=10&sortBy=createdAt&order=DESC     │
│  Filters:     ?categoryId=&tag=&search=&isPublished=            │
│  Max limit:   1000                                              │
│  Sort fields: createdAt, updatedAt, viewsCount, publishedAt,   │
│               title                                             │
│  Error shape: { statusCode, message, errors?, timestamp, path } │
│  List shape:  { data: Article[], meta: { page, limit, total,   │
│               totalPages } }                                    │
│  Slug:        Auto-generated, changes on title update           │
│  Read time:   Auto-calculated (200 wpm)                         │
│  Tags:        Auto-normalized (lowercase, trimmed)              │
│  Publish:     Requires excerpt, toggles isPublished + publishedAt│
│  Views:       Incremented on each GET /blog/:slug               │
│  Cover img:   URL string, not deleted on article removal        │
└─────────────────────────────────────────────────────────────────┘
```
