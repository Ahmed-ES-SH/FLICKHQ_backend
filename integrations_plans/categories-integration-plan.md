# Categories Module — Frontend Integration Plan

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
7. [Category Reordering](#7-category-reordering)
8. [Caching & Invalidation Strategy](#8-caching--invalidation-strategy)
9. [Example Usage (Next.js / React)](#9-example-usage-nextjs--react)
10. [Gotchas & Edge Cases](#10-gotchas--edge-cases)

---

## 1. API Endpoint Map

### 1.1 Admin Endpoints (JWT + `ADMIN` role required)

| Method | Path | Description | Auth | Request Body | Success Response | Error Codes |
|--------|------|-------------|------|-------------|------------------|-------------|
| `POST` | `/admin/categories` | Create category | Required | [`CreateCategoryDto`](#createcategorydto) | [`Category`](#category) | `400`, `401`, `403`, `409` |
| `GET` | `/admin/categories` | List all categories | Required | _query params_ | [`PaginatedCategories`](#paginatedcategories) | `401`, `403` |
| `GET` | `/admin/categories/:id` | Get category by ID | Required | _none_ | [`Category`](#category) | `401`, `403`, `404` |
| `PATCH` | `/admin/categories/:id` | Update category | Required | [`UpdateCategoryDto`](#updatecategorydto) | [`Category`](#category) | `400`, `401`, `403`, `404`, `409` |
| `DELETE` | `/admin/categories/:id` | Delete category | Required | _none_ | [`DeleteResponse`](#deleteresponse) | `401`, `403`, `404` |
| `POST` | `/admin/categories/reorder` | Bulk reorder categories | Required | [`ReorderCategoriesDto`](#reordercategoriesdto) | [`Category[]`](#category) | `400`, `401`, `403`, `404` |

### 1.2 Public Endpoints (No auth required)

| Method | Path | Description | Auth | Request Body | Success Response | Error Codes |
|--------|------|-------------|------|-------------|------------------|-------------|
| `GET` | `/categories` | List all categories | None | _none_ | [`Category[]`](#category) | — |
| `GET` | `/categories/:slug` | Get category by slug | None | _none_ | [`Category`](#category) | `404` |

### 1.3 Query Parameters

#### Admin List (`GET /admin/categories`)

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `page` | `number` | `1` | — | Page number (≥ 1) |
| `limit` | `number` | `10` | `100` | Items per page |
| `search` | `string` | — | — | Search by name (ILIKE, case-insensitive) |
| `sortBy` | `string` | `order` | — | One of: `name`, `order`, `createdAt` |
| `sortOrder` | `string` | `ASC` | — | `ASC` or `DESC` |

---

## 2. TypeScript Types & Interfaces

### 2.1 Core Entities

```typescript
// ─── Category ─────────────────────────────────────────────────────────────
export interface Category {
  id: string;              // UUID
  name: string;            // max 100 chars, unique
  slug: string;            // max 120 chars, unique, auto-generated from name
  description: string | null;
  color: string | null;    // hex color code (e.g., "#FF5733")
  icon: string | null;     // icon name (max 50 chars)
  order: number;           // display order (integer, ≥ 0)
  createdAt: Date;
  updatedAt: Date;
}

// ─── Category with usage counts (internal/admin detail) ───────────────────
export interface CategoryWithCounts extends Category {
  articlesCount: number;   // number of articles in this category
  productsCount: number;   // number of products in this category
}
```

### 2.2 Request DTOs

```typescript
// ─── CreateCategoryDto ────────────────────────────────────────────────────
export interface CreateCategoryDto {
  name: string;            // required, max 100 chars
  slug?: string;           // optional, auto-generated if omitted
                           // must match: /^[a-z0-9-]+$/
  description?: string;    // optional
  color?: string;          // optional, hex code (e.g., "#FF5733")
  icon?: string;           // optional, max 50 chars
  order?: number;          // optional, integer ≥ 0, default 0
}

// ─── UpdateCategoryDto (all fields optional, same shape) ──────────────────
export type UpdateCategoryDto = Partial<CreateCategoryDto>;
```

### 2.3 Reorder DTO

```typescript
// ─── ReorderCategoryItemDto ───────────────────────────────────────────────
export interface ReorderCategoryItemDto {
  id: string;              // UUID of the category
  order: number;           // new order value (integer ≥ 0)
}

// ─── ReorderCategoriesDto ─────────────────────────────────────────────────
export interface ReorderCategoriesDto {
  categories: ReorderCategoryItemDto[];  // array of all categories with new order
}
```

### 2.4 Response Wrappers

```typescript
// ─── Paginated Response ───────────────────────────────────────────────────
export interface PaginatedCategories {
  data: Category[];
  total: number;
  totalPages: number;
  page: number;
  limit: number;
}

// ─── Delete Response ──────────────────────────────────────────────────────
export interface DeleteResponse {
  message: string;  // "Category deleted successfully"
}
```

### 2.5 Error Response Shape (Global)

```typescript
// ─── Standard Error (from GlobalExceptionFilter) ──────────────────────────
export interface ApiError {
  statusCode: number;
  message: string | string[];
  errors?: Array<{ field: string; message: string }>;
  timestamp: string;   // ISO 8601
  path: string;        // request URL
}
```

### 2.6 Query Parameter Types

```typescript
// ─── Category Sort Fields ─────────────────────────────────────────────────
export type CategorySortField = 'name' | 'order' | 'createdAt';

// ─── Sort Order ───────────────────────────────────────────────────────────
export type SortOrder = 'ASC' | 'DESC';

// ─── Filter Categories Query ──────────────────────────────────────────────
export interface FilterCategoriesQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: CategorySortField;
  sortOrder?: SortOrder;
}
```

---

## 3. API Client Setup

### 3.1 Base Axios Instance

```typescript
// lib/api/client.ts
import axios, { AxiosError } from 'axios';
import type { ApiError } from '@/types/categories';

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

### 3.2 Categories API Functions

```typescript
// lib/api/categories.ts
import api from './client';
import type {
  Category,
  CreateCategoryDto,
  UpdateCategoryDto,
  ReorderCategoriesDto,
  PaginatedCategories,
  DeleteResponse,
  FilterCategoriesQuery,
} from '@/types/categories';

// ─── Admin ────────────────────────────────────────────────────────────────

export async function adminCreateCategory(
  dto: CreateCategoryDto,
): Promise<Category> {
  const { data } = await api.post<Category>('/admin/categories', dto);
  return data;
}

export async function adminUpdateCategory(
  id: string,
  dto: UpdateCategoryDto,
): Promise<Category> {
  const { data } = await api.patch<Category>(`/admin/categories/${id}`, dto);
  return data;
}

export async function adminDeleteCategory(id: string): Promise<DeleteResponse> {
  const { data } = await api.delete<DeleteResponse>(`/admin/categories/${id}`);
  return data;
}

export async function adminListCategories(
  query: FilterCategoriesQuery = {},
): Promise<PaginatedCategories> {
  const { data } = await api.get<PaginatedCategories>('/admin/categories', {
    params: query,
  });
  return data;
}

export async function adminGetCategory(id: string): Promise<Category> {
  const { data } = await api.get<Category>(`/admin/categories/${id}`);
  return data;
}

export async function adminReorderCategories(
  dto: ReorderCategoriesDto,
): Promise<Category[]> {
  const { data } = await api.post<Category[]>(
    '/admin/categories/reorder',
    dto,
  );
  return data;
}

// ─── Public ───────────────────────────────────────────────────────────────

export async function publicListCategories(): Promise<Category[]> {
  const { data } = await api.get<Category[]>('/categories');
  return data;
}

export async function publicGetCategoryBySlug(slug: string): Promise<Category> {
  const { data } = await api.get<Category>(`/categories/${slug}`);
  return data;
}
```

---

## 4. React Query Hooks

### 4.1 Query Keys Factory

```typescript
// lib/api/categories-keys.ts
export const categoriesKeys = {
  all: ['categories'] as const,
  lists: () => [...categoriesKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) =>
    [...categoriesKeys.lists(), { filters }] as const,
  details: () => [...categoriesKeys.all, 'detail'] as const,
  detail: (id: string) => [...categoriesKeys.details(), id] as const,
  detailBySlug: (slug: string) =>
    [...categoriesKeys.details(), 'slug', slug] as const,
  adminLists: () => [...categoriesKeys.all, 'admin', 'list'] as const,
  adminList: (filters: Record<string, unknown>) =>
    [...categoriesKeys.adminLists(), { filters }] as const,
  adminDetail: (id: string) =>
    [...categoriesKeys.all, 'admin', 'detail', id] as const,
};
```

### 4.2 Public Hooks (for category navigation, filters, etc.)

```typescript
// hooks/use-categories.ts
import { useQuery } from '@tanstack/react-query';
import { categoriesKeys } from '@/lib/api/categories-keys';
import {
  publicListCategories,
  publicGetCategoryBySlug,
} from '@/lib/api/categories';

/** Fetch all categories (for navigation, dropdowns, filters) */
export function useCategories() {
  return useQuery({
    queryKey: categoriesKeys.lists(),
    queryFn: publicListCategories,
    staleTime: 5 * 60_000, // 5 minutes — categories change rarely
  });
}

/** Fetch a single category by slug (for category detail pages) */
export function useCategoryBySlug(slug: string) {
  return useQuery({
    queryKey: categoriesKeys.detailBySlug(slug),
    queryFn: () => publicGetCategoryBySlug(slug),
    staleTime: 5 * 60_000,
    enabled: !!slug,
  });
}
```

### 4.3 Admin Hooks (for category management dashboard)

```typescript
// hooks/use-admin-categories.ts
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { categoriesKeys } from '@/lib/api/categories-keys';
import {
  adminListCategories,
  adminCreateCategory,
  adminUpdateCategory,
  adminDeleteCategory,
  adminGetCategory,
  adminReorderCategories,
} from '@/lib/api/categories';
import type {
  FilterCategoriesQuery,
  CreateCategoryDto,
  UpdateCategoryDto,
  ReorderCategoriesDto,
} from '@/types/categories';

export function useAdminCategories(query: FilterCategoriesQuery = {}) {
  return useQuery({
    queryKey: categoriesKeys.adminList(query),
    queryFn: () => adminListCategories(query),
    staleTime: 30_000,
  });
}

export function useAdminCategory(id: string) {
  return useQuery({
    queryKey: categoriesKeys.adminDetail(id),
    queryFn: () => adminGetCategory(id),
    enabled: !!id,
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminCreateCategory,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: categoriesKeys.adminLists() });
      qc.invalidateQueries({ queryKey: categoriesKeys.lists() });
    },
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateCategoryDto }) =>
      adminUpdateCategory(id, dto),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: categoriesKeys.adminLists() });
      qc.invalidateQueries({ queryKey: categoriesKeys.lists() });
      qc.invalidateQueries({ queryKey: categoriesKeys.details() });
      qc.invalidateQueries({ queryKey: categoriesKeys.adminDetail(id) });
    },
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminDeleteCategory,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: categoriesKeys.adminLists() });
      qc.invalidateQueries({ queryKey: categoriesKeys.lists() });
    },
  });
}

export function useReorderCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminReorderCategories,
    onSuccess: () => {
      // Reorder affects all lists
      qc.invalidateQueries({ queryKey: categoriesKeys.adminLists() });
      qc.invalidateQueries({ queryKey: categoriesKeys.lists() });
    },
  });
}
```

---

## 5. Error Handling & Validation Mapping

### 5.1 HTTP Status Codes & Meanings

| Status | When | Frontend Action |
|--------|------|-----------------|
| `400` | Validation failure | Show inline form errors from `message` array |
| `401` | Missing or expired JWT | Redirect to login |
| `403` | User lacks `ADMIN` role | Show "Unauthorized" page |
| `404` | Category not found (by ID) | Show "Not Found" page |
| `409` | Duplicate name or slug | Show "Name/Slug already exists" error |
| `500` | Server error | Show generic error toast |

### 5.2 Validation Error Parsing

The backend returns validation errors in this shape:

```json
{
  "statusCode": 400,
  "message": [
    "name should not be empty",
    "name must be shorter than or equal to 100 characters"
  ],
  "timestamp": "2026-05-20T12:00:00.000Z",
  "path": "/admin/categories"
}
```

**Frontend helper to map to form errors:**

```typescript
// lib/api/error-utils.ts
import type { ApiError } from '@/types/categories';

export function parseValidationErrors(error: ApiError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  if (Array.isArray(error.message)) {
    error.message.forEach((msg) => {
      const match = msg.match(/^(\w+)\s/);
      if (match) {
        fieldErrors[match[1]] = msg;
      }
    });
  } else if (typeof error.message === 'string') {
    fieldErrors._global = error.message;
  }

  return fieldErrors;
}
```

### 5.3 Known Backend Validation Rules

| Field | Rule | Error Message Pattern |
|-------|------|----------------------|
| `name` | Required, max 100 chars | `"name must be shorter than or equal to 100 characters"` |
| `slug` | Optional, max 120 chars, lowercase alphanumeric + hyphens | `"slug must contain only lowercase letters, numbers, and hyphens"` |
| `color` | Optional, must be valid hex code | `"color must be a valid hex color code (e.g., #FF5733)"` |
| `icon` | Optional, max 50 chars | `"icon must be shorter than or equal to 50 characters"` |
| `order` | Optional, integer ≥ 0 | `"order must not be less than 0"` |
| `description` | Optional, no length limit | — |
| `page` | Min 1 | `"page must not be less than 1"` |
| `limit` | Min 1, Max 100 | `"limit must not be greater than 100"` |
| `sortBy` | Whitelisted: `name`, `order`, `createdAt` | `"sortBy must be one of the following values: ..."` |
| `sortOrder` | `ASC` or `DESC` | `"sortOrder must be one of the following values: ..."` |

---

## 6. Pagination & Filtering

### 6.1 URL State Pattern (Next.js App Router)

```typescript
// app/admin/categories/page.tsx
'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useAdminCategories } from '@/hooks/use-admin-categories';

export default function AdminCategoriesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const page = Number(searchParams.get('page')) || 1;
  const limit = Number(searchParams.get('limit')) || 10;
  const search = searchParams.get('search') || undefined;
  const sortBy = searchParams.get('sortBy') as any || 'order';
  const sortOrder = searchParams.get('sortOrder') as any || 'ASC';

  const { data, isLoading } = useAdminCategories({
    page,
    limit,
    search,
    sortBy,
    sortOrder,
  });

  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null) params.delete(key);
    else params.set(key, value);
    router.replace(`${pathname}?${params.toString()}`);
  };

  // ... render table with data?.data, pagination from data
}
```

### 6.2 Pagination Helper Component

```typescript
// components/Pagination.tsx
interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center gap-2">
      <button
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button
        disabled={page === totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
```

---

## 7. Category Reordering

### 7.1 How It Works

The `/admin/categories/reorder` endpoint accepts an array of **all** categories with their new `order` values. The backend performs the update atomically inside a database transaction.

### 7.2 Frontend Reorder Flow

```typescript
// hooks/use-category-reorder.ts
import { useState, useCallback } from 'react';
import { useReorderCategories } from '@/hooks/use-admin-categories';
import type { Category, ReorderCategoryItemDto } from '@/types/categories';

export function useCategoryReorder(initialCategories: Category[]) {
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const reorderMutation = useReorderCategories();

  const moveCategory = useCallback(
    (id: string, direction: 'up' | 'down') => {
      setCategories((prev) => {
        const index = prev.findIndex((c) => c.id === id);
        if (index === -1) return prev;

        const swapIndex = direction === 'up' ? index - 1 : index + 1;
        if (swapIndex < 0 || swapIndex >= prev.length) return prev;

        const newCategories = [...prev];
        // Swap order values
        const tempOrder = newCategories[index].order;
        newCategories[index] = {
          ...newCategories[index],
          order: newCategories[swapIndex].order,
        };
        newCategories[swapIndex] = {
          ...newCategories[swapIndex],
          order: tempOrder,
        };
        return newCategories;
      });
    },
    [],
  );

  const saveOrder = useCallback(async () => {
    const dto = {
      categories: categories.map(
        (c) => ({ id: c.id, order: c.order }) satisfies ReorderCategoryItemDto,
      ),
    };
    await reorderMutation.mutateAsync(dto);
  }, [categories, reorderMutation]);

  return {
    categories,
    moveCategory,
    saveOrder,
    isSaving: reorderMutation.isPending,
  };
}
```

### 7.3 Drag-and-Drop Reorder Example

```typescript
// app/admin/categories/reorder/page.tsx
'use client';

import { useAdminCategories } from '@/hooks/use-admin-categories';
import { useCategoryReorder } from '@/hooks/use-category-reorder';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Category } from '@/types/categories';

function SortableCategoryItem({ category }: { category: Category }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: category.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div className="flex items-center gap-3 p-3 border rounded">
        <span className="cursor-grab">⋮⋮</span>
        <span className="flex-1">{category.name}</span>
        <span className="text-sm text-gray-500">Order: {category.order}</span>
      </div>
    </div>
  );
}

export default function ReorderCategoriesPage() {
  const { data, isLoading } = useAdminCategories({ sortBy: 'order' });
  const reorderMutation = useReorderCategories();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = data!.data.findIndex((c: Category) => c.id === active.id);
    const newIndex = data!.data.findIndex((c: Category) => c.id === over.id);
    const reordered = arrayMove(data!.data, oldIndex, newIndex);

    // Recalculate order values
    const withNewOrder = reordered.map((c: Category, i: number) => ({
      ...c,
      order: i,
    }));

    // Optimistic update
    reorderMutation.mutate({
      categories: withNewOrder.map((c: Category) => ({
        id: c.id,
        order: c.order,
      })),
    });
  };

  if (isLoading) return <div>Loading...</div>;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={data!.data.map((c: Category) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        {data!.data.map((category: Category) => (
          <SortableCategoryItem key={category.id} category={category} />
        ))}
      </SortableContext>
    </DndContext>
  );
}
```

---

## 8. Caching & Invalidation Strategy

### 8.1 Cache Durations

| Query Type | `staleTime` | Rationale |
|------------|-------------|-----------|
| Public category list | `300_000` (5 min) | Categories change very rarely |
| Public category detail | `300_000` (5 min) | Single category is very stable |
| Admin category list | `30_000` (30 sec) | Admin needs fresher data |

### 8.2 Invalidation Rules

| Mutation | Invalidates |
|----------|-------------|
| `createCategory` | `categoriesKeys.adminLists()`, `categoriesKeys.lists()` |
| `updateCategory` | `categoriesKeys.adminLists()`, `categoriesKeys.lists()`, `categoriesKeys.details()`, `categoriesKeys.adminDetail(id)` |
| `deleteCategory` | `categoriesKeys.adminLists()`, `categoriesKeys.lists()` |
| `reorderCategories` | `categoriesKeys.adminLists()`, `categoriesKeys.lists()` |

### 8.3 Prefetching Categories (for navigation)

```typescript
// In your layout or root provider:
import { useQueryClient } from '@tanstack/react-query';
import { categoriesKeys } from '@/lib/api/categories-keys';
import { publicListCategories } from '@/lib/api/categories';

export function CategoriesPrefetcher() {
  const qc = useQueryClient();

  useEffect(() => {
    qc.prefetchQuery({
      queryKey: categoriesKeys.lists(),
      queryFn: publicListCategories,
      staleTime: 5 * 60_000,
    });
  }, [qc]);

  return null;
}
```

---

## 9. Example Usage (Next.js / React)

### 9.1 Public Category Navigation (Sidebar/Header)

```typescript
// components/CategoryNav.tsx
'use client';

import Link from 'next/link';
import { useCategories } from '@/hooks/use-categories';

export function CategoryNav() {
  const { data: categories, isLoading } = useCategories();

  if (isLoading) return <NavSkeleton />;
  if (!categories?.length) return null;

  return (
    <nav>
      <ul>
        {categories.map((cat) => (
          <li key={cat.id}>
            <Link href={`/products?category=${cat.slug}`}>
              {cat.icon && <Icon name={cat.icon} />}
              <span>{cat.name}</span>
              {cat.color && (
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: cat.color }}
                />
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

### 9.2 Admin Category List with Actions

```typescript
// app/admin/categories/page.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import {
  useAdminCategories,
  useDeleteCategory,
} from '@/hooks/use-admin-categories';
import { parseValidationErrors } from '@/lib/api/error-utils';
import { Pagination } from '@/components/Pagination';

export default function AdminCategoriesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const page = Number(searchParams.get('page')) || 1;
  const limit = Number(searchParams.get('limit')) || 10;
  const search = searchParams.get('search') || undefined;

  const { data, isLoading } = useAdminCategories({ page, limit, search });
  const deleteCategory = useDeleteCategory();

  const handleDelete = async (id: string, name: string) => {
    if (
      !confirm(
        `Delete "${name}"? Products and articles in this category will have their category set to NULL.`,
      )
    )
      return;
    await deleteCategory.mutateAsync(id);
  };

  if (isLoading) return <TableSkeleton />;

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1>Categories</h1>
        <Link href="/admin/categories/new">
          <button>Create Category</button>
        </Link>
      </div>

      <SearchBar />

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Slug</th>
            <th>Order</th>
            <th>Color</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data?.data.map((category) => (
            <tr key={category.id}>
              <td>{category.name}</td>
              <td>{category.slug}</td>
              <td>{category.order}</td>
              <td>
                {category.color && (
                  <span
                    className="inline-block w-6 h-6 rounded border"
                    style={{ backgroundColor: category.color }}
                  />
                )}
              </td>
              <td>
                <Link href={`/admin/categories/${category.id}/edit`}>
                  Edit
                </Link>
                <button
                  onClick={() => handleDelete(category.id, category.name)}
                  disabled={deleteCategory.isPending}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data && (
        <Pagination
          page={data.page}
          totalPages={data.totalPages}
          onPageChange={(p) => {
            const params = new URLSearchParams(searchParams.toString());
            params.set('page', String(p));
            router.replace(`${pathname}?${params.toString()}`);
          }}
        />
      )}
    </div>
  );
}
```

### 9.3 Admin Category Form (Create/Edit)

```typescript
// app/admin/categories/new/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateCategory } from '@/hooks/use-admin-categories';
import { parseValidationErrors } from '@/lib/api/error-utils';
import type { CreateCategoryDto } from '@/types/categories';

export default function NewCategoryPage() {
  const router = useRouter();
  const createMutation = useCreateCategory();
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormErrors({});

    const formData = new FormData(e.currentTarget);
    const dto: CreateCategoryDto = {
      name: formData.get('name') as string,
      description: (formData.get('description') as string) || undefined,
      color: (formData.get('color') as string) || undefined,
      icon: (formData.get('icon') as string) || undefined,
      order: formData.get('order')
        ? Number(formData.get('order'))
        : undefined,
      // slug is optional — backend auto-generates from name
    };

    try {
      await createMutation.mutateAsync(dto);
      router.push('/admin/categories');
    } catch (err: any) {
      setFormErrors(parseValidationErrors(err));
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>Name *</label>
        <input name="name" required maxLength={100} />
        {formErrors.name && (
          <span className="error">{formErrors.name}</span>
        )}
      </div>

      <div>
        <label>Description</label>
        <textarea name="description" />
      </div>

      <div>
        <label>Color</label>
        <input name="color" type="color" />
        <small>Format: #RRGGBB (e.g., #FF5733)</small>
        {formErrors.color && (
          <span className="error">{formErrors.color}</span>
        )}
      </div>

      <div>
        <label>Icon</label>
        <input name="icon" maxLength={50} placeholder="e.g., laptop" />
      </div>

      <div>
        <label>Display Order</label>
        <input name="order" type="number" min="0" defaultValue="0" />
      </div>

      {formErrors._global && (
        <Alert variant="error">{formErrors._global}</Alert>
      )}

      <button type="submit" disabled={createMutation.isPending}>
        {createMutation.isPending ? 'Saving...' : 'Create Category'}
      </button>
    </form>
  );
}
```

---

## 10. Gotchas & Edge Cases

### 10.1 Slug Auto-Generation

- The backend **auto-generates slugs** from the name if `slug` is not provided.
- Slug generation: `name.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '')`
- Example: `"My Category!"` → `"my-category"`
- If you provide a `slug`, it **must** match `/^[a-z0-9-]+$/` (lowercase letters, numbers, hyphens only).
- **Implication:** The frontend should not send a `slug` field unless the user explicitly wants to override the auto-generated value.

### 10.2 Slug Regeneration on Name Change

- When updating a category's name **without** providing an explicit `slug`, the backend **regenerates the slug** from the new name.
- If you provide an explicit `slug` during update, it will be used as-is.
- **Implication:** After updating a name, the category's public URL (`/categories/:slug`) changes. Update any cached references or links.

### 10.3 Name & Slug Uniqueness

- Both `name` and `slug` have **unique constraints** in the database.
- Attempting to create/update with a duplicate name or slug returns `409 Conflict`.
- The error message distinguishes between name and slug conflicts:
  - `"Category with this name already exists"`
  - `"Category with this slug already exists"`

### 10.4 Category Deletion Cascades to SET NULL

- When a category is deleted, all related **articles** and **products** have their `categoryId` set to `NULL` (not deleted).
- The backend logs a warning with the count of affected entities before deletion.
- **Frontend:** Warn the user before deletion: _"X articles and Y products will have their category set to NULL."_

### 10.5 Reorder Requires All Categories

- The `/admin/categories/reorder` endpoint expects the **complete list** of categories with their new order values.
- If any category ID in the request doesn't exist, it returns `404` with the missing IDs.
- **Frontend:** When implementing drag-and-drop reorder, send the entire reordered list, not just the moved item.

### 10.6 Sort Field Whitelist

- The backend **whitelists** sortable fields: `name`, `order`, `createdAt`.
- Any invalid sort field defaults to `order`.
- The sort column is mapped through a whitelist on the backend — **no SQL injection is possible**.
- **Frontend:** Only expose these fields as sortable columns in the admin table.

### 10.7 Hex Color Validation

- The `color` field must be a valid hex color code matching `/^#[0-9A-Fa-f]{6}$/`.
- Examples: `#FF5733` ✅, `#fff` ❌, `FF5733` ❌ (missing `#`).
- **Frontend:** Use a color picker that outputs 6-digit hex codes with the `#` prefix.

### 10.8 Public vs Admin Endpoints

| Aspect | Admin (`/admin/categories`) | Public (`/categories`) |
|--------|----------------------------|------------------------|
| Auth | JWT + ADMIN role | None |
| Pagination | Yes (`page`, `limit`) | No — returns all |
| Sorting | Yes (`sortBy`, `sortOrder`) | No — fixed: `order ASC, name ASC` |
| Search | Yes (`search`) | No |
| Response | Paginated wrapper | Flat array |

### 10.9 Category Response Excludes Relations

- The `CategoryResponseDto` uses `@Expose()` from `class-transformer`.
- Relations (`articles`, `products`) are marked with `@Exclude()` on the entity and are **never** returned in API responses.
- To get usage counts, use the internal `getByIdWithCounts` method (not exposed via HTTP).

### 10.10 Order Field is Not Auto-Managed

- The `order` field is a plain integer — the backend does **not** auto-manage gaps or renumbering.
- You can use any integer values (0, 1, 2 or 0, 10, 20 or 100, 200, 300).
- The reorder endpoint sets exact values — gaps are fine.
- **Frontend:** When inserting a new category between two existing ones, you can either:
  1. Use the reorder endpoint to renumber all categories
  2. Calculate a midpoint value (e.g., between 10 and 20 → use 15)

---

## Appendix A: Complete File Structure (Frontend)

```
frontend/
├── types/
│   └── categories.ts             # All TypeScript interfaces
├── lib/
│   └── api/
│       ├── client.ts             # Axios instance
│       ├── categories.ts         # API functions
│       └── categories-keys.ts    # React Query keys
├── hooks/
│   ├── use-categories.ts         # Public query hooks
│   ├── use-admin-categories.ts   # Admin mutation hooks
│   └── use-category-reorder.ts   # Reorder logic helper
├── components/
│   ├── categories/
│   │   ├── category-nav.tsx      # Public navigation
│   │   └── color-picker.tsx      # Hex color input
│   ├── admin/
│   │   ├── category-form.tsx     # Create/Edit form
│   │   ├── category-table.tsx    # Admin listing
│   │   └── category-reorder.tsx  # Drag-and-drop reorder
│   └── Pagination.tsx
└── app/
    ├── admin/
    │   └── categories/
    │       ├── page.tsx          # Admin listing
    │       ├── new/
    │       │   └── page.tsx      # Create form
    │       ├── [id]/
    │       │   └── edit/
    │       │       └── page.tsx  # Edit form
    │       └── reorder/
    │           └── page.tsx      # Drag-and-drop reorder
    └── categories/
        └── [slug]/
            └── page.tsx          # Public category detail
```

---

## Appendix B: Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│  CATEGORIES MODULE — QUICK REFERENCE                            │
├─────────────────────────────────────────────────────────────────┤
│  Admin Base:  POST/PATCH/DELETE/GET /admin/categories           │
│               POST /admin/categories/reorder                    │
│  Public Base: GET /categories, GET /categories/:slug            │
│  Auth:        JWT + ADMIN role (admin), None (public)           │
│  Pagination:  ?page=1&limit=10&sortBy=order&sortOrder=ASC      │
│  Filters:     ?search=                                         │
│  Max limit:   100                                               │
│  Sort fields: name, order, createdAt                            │
│  Error shape: { statusCode, message, errors?, timestamp, path } │
│  List shape:  { data: Category[], total, totalPages, page,      │
│               limit }                                           │
│  Public list:  Flat Category[] array (no pagination)            │
│  Slug:        Auto-generated from name, regenerates on rename   │
│  Slug format: /^[a-z0-9-]+$/ (lowercase, numbers, hyphens)     │
│  Color:       Hex code #RRGGBB (e.g., #FF5733)                  │
│  Uniqueness:  Both name AND slug are unique                     │
│  Delete:      CASCADE SET NULL on articles & products           │
│  Reorder:     Send ALL categories with new order values         │
│  Relations:   articles, products excluded from responses        │
└─────────────────────────────────────────────────────────────────┘
```
