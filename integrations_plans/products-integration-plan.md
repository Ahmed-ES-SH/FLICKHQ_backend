# Products Module — Frontend Integration Plan

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
7. [Stock Management](#7-stock-management)
8. [Caching & Invalidation Strategy](#8-caching--invalidation-strategy)
9. [Example Usage (Next.js / React)](#9-example-usage-nextjs--react)
10. [Gotchas & Edge Cases](#10-gotchas--edge-cases)

---

## 1. API Endpoint Map

### 1.1 Admin Endpoints (JWT + `ADMIN` role required)

| Method | Path | Description | Auth | Request Body | Success Response | Error Codes |
|--------|------|-------------|------|-------------|------------------|-------------|
| `POST` | `/admin/products` | Create product | Required | [`CreateProductDto`](#createproductdto) | [`Product`](#product) | `400`, `401`, `403`, `409` |
| `GET` | `/admin/products` | List all products | Required | _query params_ | [`PaginatedProducts`](#paginatedproducts) | `401`, `403` |
| `GET` | `/admin/products/:id` | Get product by ID | Required | _none_ | [`Product`](#product) | `401`, `403`, `404` |
| `PATCH` | `/admin/products/:id` | Update product | Required | [`UpdateProductDto`](#updateproductdto) | [`Product`](#product) | `400`, `401`, `403`, `404`, `409` |
| `DELETE` | `/admin/products/:id` | Soft-delete product | Required | _none_ | [`DeleteResponse`](#deleteresponse) | `401`, `403`, `404` |
| `PATCH` | `/admin/products/:id/toggle-publish` | Toggle publish status | Required | _none_ | [`TogglePublishResponse`](#togglepublishresponse) | `401`, `403`, `404` |

### 1.2 Public Endpoints (No auth required)

| Method | Path | Description | Auth | Request Body | Success Response | Error Codes |
|--------|------|-------------|------|-------------|------------------|-------------|
| `GET` | `/products` | List published products | None | _query params_ | [`PaginatedProducts`](#paginatedproducts) | — |
| `GET` | `/products/:slug` | Get product by slug | None | _none_ | [`Product`](#product) | `404` |
| `GET` | `/products/category/:categorySlug` | Products by category | None | _query params_ | [`PaginatedProducts`](#paginatedproducts) | `404` |

### 1.3 Query Parameters

#### Admin List (`GET /admin/products`)

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `page` | `number` | `1` | — | Page number (≥ 1) |
| `limit` | `number` | `10` | `100` | Items per page |
| `search` | `string` | — | — | Search by title or description (ILIKE) |
| `categoryId` | `UUID` | — | — | Filter by category ID |
| `minPrice` | `number` | — | — | Minimum price filter (≥ 0) |
| `maxPrice` | `number` | — | — | Maximum price filter (≥ 0) |
| `minRating` | `number` | — | `5` | Minimum rating filter (0–5) |
| `tags` | `string` | — | — | Filter by tag (comma-separated, e.g. `electronics,sale`) |
| `inStockOnly` | `boolean` | `false` | — | Only show in-stock products |
| `sortBy` | `string` | `createdAt` | — | One of: `price`, `rating`, `createdAt`, `title`, `stock` |
| `sortOrder` | `string` | `DESC` | — | `ASC` or `DESC` |

#### Public List (`GET /products`)

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `page` | `number` | `1` | — | Page number (≥ 1) |
| `limit` | `number` | `10` | `100` | Items per page |
| `search` | `string` | — | — | Search by title or description |
| `categoryId` | `UUID` | — | — | Filter by category ID |
| `categorySlug` | `string` | — | — | Filter by category slug |
| `minPrice` | `number` | — | — | Minimum price filter (≥ 0) |
| `maxPrice` | `number` | — | — | Maximum price filter (≥ 0) |
| `minRating` | `number` | — | `5` | Minimum rating filter (0–5) |
| `tags` | `string` | — | — | Filter by tag (comma-separated) |
| `inStockOnly` | `boolean` | `false` | — | Only show in-stock products |
| `sortBy` | `string` | `createdAt` | — | Same allowed fields as admin |
| `sortOrder` | `string` | `DESC` | — | `ASC` or `DESC` |

> **Note:** Public endpoints always return only **published** products (`isPublished = true`).

---

## 2. TypeScript Types & Interfaces

### 2.1 Core Entities

```typescript
// ─── Product (full, from admin endpoints) ───────────────────────────────
export interface Product {
  id: string;                        // UUID
  title: string;                     // max 300 chars
  slug: string;                      // unique, auto-generated from title
  description: string;               // full HTML/text description
  shortDescription: string | null;   // optional summary
  price: number;                     // decimal(10,2) — never Float
  discountPercentage: number;        // decimal(5,2), 0–100
  discountedPrice: number;           // auto-computed from price & discount
  stock: number;                     // integer, ≥ 0
  sku: string;                       // unique, max 50 chars
  minimumOrderQuantity: number;      // integer, ≥ 1
  availabilityStatus: string;        // "In Stock" | "Low Stock" | "Out of Stock"
  categoryId: string | null;
  category: Category | null;
  tags: string[];                    // normalized: lowercase, trimmed
  brand: string | null;              // max 100 chars
  weight: number | null;             // decimal(8,2)
  dimensions: ProductDimensions | null;
  images: string[];                  // array of URLs
  thumbnail: string | null;          // URL
  warrantyInformation: string | null;
  shippingInformation: string | null;
  returnPolicy: string | null;
  reviews: ProductReview[];          // stored as JSONB
  rating: number;                    // decimal(3,2), auto-computed from reviews
  barcode: string | null;
  qrCode: string | null;             // URL
  isPublished: boolean;
  deletedAt: Date | null;            // soft-delete timestamp
  createdAt: Date;
  updatedAt: Date;
}

// ─── Category (nested relation) ─────────────────────────────────────────
export interface Category {
  id: string;
  name: string;
  slug: string;
}

// ─── Product Dimensions ─────────────────────────────────────────────────
export interface ProductDimensions {
  width: number;   // cm
  height: number;  // cm
  depth: number;   // cm
}

// ─── Product Review (JSONB embedded) ────────────────────────────────────
export interface ProductReview {
  rating: number;        // 1–5
  comment: string;
  date: string;          // ISO date string
  reviewerName: string;
  reviewerEmail: string; // ⚠️ PII — consider excluding from public responses
}
```

### 2.2 Request DTOs

```typescript
// ─── CreateProductDto ───────────────────────────────────────────────────
export interface CreateProductDto {
  title: string;                    // required, max 300 chars
  slug?: string;                    // optional, auto-generated if omitted
  description: string;              // required
  shortDescription?: string;
  price: number;                    // required, ≥ 0, max 2 decimal places
  discountPercentage?: number;      // optional, 0–100, default 0
  stock?: number;                   // optional, integer ≥ 0, default 0
  sku: string;                      // required, unique, max 50 chars
  minimumOrderQuantity?: number;    // optional, integer ≥ 1, default 1
  availabilityStatus?: string;      // optional, max 50 chars, default "In Stock"
  categoryId?: string;              // optional, UUID
  tags?: string[];                  // optional, each item is a string
  brand?: string;                   // optional, max 100 chars
  weight?: number;                  // optional, ≥ 0
  dimensions?: ProductDimensions;   // optional, each dimension ≥ 0
  images?: string[];                // optional, each must be valid URL
  thumbnail?: string;               // optional, must be valid URL
  warrantyInformation?: string;
  shippingInformation?: string;
  returnPolicy?: string;
  reviews?: ProductReview[];        // optional
  barcode?: string;
  qrCode?: string;                  // optional, must be valid URL
  isPublished?: boolean;            // optional, default false
}

// ─── UpdateProductDto (all fields optional, same shape) ─────────────────
export type UpdateProductDto = Partial<CreateProductDto>;
```

### 2.3 Response Wrappers

```typescript
// ─── Paginated Response ─────────────────────────────────────────────────
export interface PaginatedProducts {
  data: Product[];
  total: number;
  totalPages: number;
  page: number;
  limit: number;
}

// ─── Toggle Publish Response ────────────────────────────────────────────
export interface TogglePublishResponse {
  id: string;
  isPublished: boolean;
  message: string; // "Product published successfully" | "Product unpublished successfully"
}

// ─── Delete Response ────────────────────────────────────────────────────
export interface DeleteResponse {
  message: string; // "Product deleted successfully"
}
```

### 2.4 Error Response Shape (Global)

```typescript
// ─── Standard Error (from GlobalExceptionFilter) ────────────────────────
export interface ApiError {
  statusCode: number;
  message: string | string[];
  errors?: Array<{ field: string; message: string }>;
  timestamp: string;   // ISO 8601
  path: string;        // request URL
}
```

### 2.5 Query Parameter Types

```typescript
// ─── Product Sort Fields ────────────────────────────────────────────────
export type ProductSortField = 'price' | 'rating' | 'createdAt' | 'title' | 'stock';

// ─── Sort Order ─────────────────────────────────────────────────────────
export type SortOrder = 'ASC' | 'DESC';

// ─── Filter Products Query ──────────────────────────────────────────────
export interface FilterProductsQuery {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  categorySlug?: string;   // public only
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  tags?: string;           // comma-separated string
  inStockOnly?: boolean;
  sortBy?: ProductSortField;
  sortOrder?: SortOrder;
}
```

---

## 3. API Client Setup

### 3.1 Base Axios Instance

```typescript
// lib/api/client.ts
import axios, { AxiosError } from 'axios';
import type { ApiError } from '@/types/products';

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

### 3.2 Products API Functions

```typescript
// lib/api/products.ts
import api from './client';
import type {
  Product,
  CreateProductDto,
  UpdateProductDto,
  PaginatedProducts,
  TogglePublishResponse,
  DeleteResponse,
  FilterProductsQuery,
} from '@/types/products';

// ─── Admin ──────────────────────────────────────────────────────────────

export async function adminCreateProduct(dto: CreateProductDto): Promise<Product> {
  const { data } = await api.post<Product>('/admin/products', dto);
  return data;
}

export async function adminUpdateProduct(
  id: string,
  dto: UpdateProductDto,
): Promise<Product> {
  const { data } = await api.patch<Product>(`/admin/products/${id}`, dto);
  return data;
}

export async function adminTogglePublish(id: string): Promise<TogglePublishResponse> {
  const { data } = await api.patch<TogglePublishResponse>(`/admin/products/${id}/toggle-publish`);
  return data;
}

export async function adminDeleteProduct(id: string): Promise<DeleteResponse> {
  const { data } = await api.delete<DeleteResponse>(`/admin/products/${id}`);
  return data;
}

export async function adminListProducts(
  query: FilterProductsQuery = {},
): Promise<PaginatedProducts> {
  const { data } = await api.get<PaginatedProducts>('/admin/products', { params: query });
  return data;
}

export async function adminGetProduct(id: string): Promise<Product> {
  const { data } = await api.get<Product>(`/admin/products/${id}`);
  return data;
}

// ─── Public ─────────────────────────────────────────────────────────────

export async function publicListProducts(
  query: FilterProductsQuery = {},
): Promise<PaginatedProducts> {
  const { data } = await api.get<PaginatedProducts>('/products', { params: query });
  return data;
}

export async function publicGetProductBySlug(slug: string): Promise<Product> {
  const { data } = await api.get<Product>(`/products/${slug}`);
  return data;
}

export async function publicGetProductsByCategory(
  categorySlug: string,
  query: FilterProductsQuery = {},
): Promise<PaginatedProducts> {
  const { data } = await api.get<PaginatedProducts>(
    `/products/category/${categorySlug}`,
    { params: query },
  );
  return data;
}
```

---

## 4. React Query Hooks

### 4.1 Query Keys Factory

```typescript
// lib/api/products-keys.ts
export const productsKeys = {
  all: ['products'] as const,
  lists: () => [...productsKeys.all, 'list'] as const,
  list: (filters: Record<string, unknown>) =>
    [...productsKeys.lists(), { filters }] as const,
  details: () => [...productsKeys.all, 'detail'] as const,
  detail: (id: string) => [...productsKeys.details(), id] as const,
  detailBySlug: (slug: string) => [...productsKeys.details(), 'slug', slug] as const,
  adminLists: () => [...productsKeys.all, 'admin', 'list'] as const,
  adminList: (filters: Record<string, unknown>) =>
    [...productsKeys.adminLists(), { filters }] as const,
  adminDetail: (id: string) => [...productsKeys.all, 'admin', 'detail', id] as const,
};
```

### 4.2 Public Hooks (for product catalog pages)

```typescript
// hooks/use-products.ts
import { useQuery } from '@tanstack/react-query';
import { productsKeys } from '@/lib/api/products-keys';
import { publicListProducts, publicGetProductBySlug } from '@/lib/api/products';
import type { FilterProductsQuery } from '@/types/products';

export function usePublishedProducts(query: FilterProductsQuery = {}) {
  return useQuery({
    queryKey: productsKeys.list(query),
    queryFn: () => publicListProducts(query),
    staleTime: 60_000, // 1 minute — catalog content is relatively static
  });
}

export function useProductBySlug(slug: string) {
  return useQuery({
    queryKey: productsKeys.detailBySlug(slug),
    queryFn: () => publicGetProductBySlug(slug),
    staleTime: 5 * 60_000, // 5 minutes
  });
}
```

### 4.3 Admin Hooks (for product management dashboard)

```typescript
// hooks/use-admin-products.ts
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { productsKeys } from '@/lib/api/products-keys';
import {
  adminListProducts,
  adminCreateProduct,
  adminUpdateProduct,
  adminTogglePublish,
  adminDeleteProduct,
  adminGetProduct,
} from '@/lib/api/products';
import type {
  FilterProductsQuery,
  CreateProductDto,
  UpdateProductDto,
} from '@/types/products';

export function useAdminProducts(query: FilterProductsQuery = {}) {
  return useQuery({
    queryKey: productsKeys.adminList(query),
    queryFn: () => adminListProducts(query),
    staleTime: 30_000,
  });
}

export function useAdminProduct(id: string) {
  return useQuery({
    queryKey: productsKeys.adminDetail(id),
    queryFn: () => adminGetProduct(id),
    enabled: !!id,
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminCreateProduct,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productsKeys.adminLists() });
      qc.invalidateQueries({ queryKey: productsKeys.lists() });
    },
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateProductDto }) =>
      adminUpdateProduct(id, dto),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: productsKeys.adminLists() });
      qc.invalidateQueries({ queryKey: productsKeys.lists() });
      qc.invalidateQueries({ queryKey: productsKeys.details() });
      qc.invalidateQueries({ queryKey: productsKeys.adminDetail(id) });
    },
  });
}

export function useTogglePublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminTogglePublish,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productsKeys.adminLists() });
      qc.invalidateQueries({ queryKey: productsKeys.lists() });
    },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminDeleteProduct,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: productsKeys.adminLists() });
      qc.invalidateQueries({ queryKey: productsKeys.lists() });
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
| `404` | Product not found (by ID or slug) | Show "Not Found" page |
| `409` | Duplicate SKU or slug | Show "SKU/Slug already exists" error |
| `500` | Server error | Show generic error toast |

### 5.2 Validation Error Parsing

The backend returns validation errors in this shape:

```json
{
  "statusCode": 400,
  "message": [
    "title must be shorter than or equal to 300 characters",
    "price must not be less than 0"
  ],
  "timestamp": "2026-05-20T12:00:00.000Z",
  "path": "/admin/products"
}
```

**Frontend helper to map to form errors:**

```typescript
// lib/api/error-utils.ts
import type { ApiError } from '@/types/products';

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
| `title` | Required, max 300 chars | `"title must be shorter than or equal to 300 characters"` |
| `description` | Required | `"description should not be empty"` |
| `price` | Required, ≥ 0, max 2 decimals | `"price must not be less than 0"` |
| `sku` | Required, unique, max 50 chars | `"sku should not be empty"` |
| `discountPercentage` | 0–100, max 2 decimals | `"discountPercentage must not be greater than 100"` |
| `stock` | Integer, ≥ 0 | `"stock must be an integer number"` |
| `categoryId` | Valid UUID if provided | `"categoryId must be a UUID"` |
| `images[]` | Each must be valid URL | `"each value in images must be a URL address"` |
| `isPublished` | Boolean if provided | `"isPublished must be a boolean value"` |
| `page` | Min 1 | `"page must not be less than 1"` |
| `limit` | Min 1, Max 100 | `"limit must not be greater than 100"` |
| `sortBy` | Whitelisted fields only | `"sortBy must be one of the following values: ..."` |

---

## 6. Pagination & Filtering

### 6.1 URL State Pattern (Next.js App Router)

```typescript
// app/admin/products/page.tsx
'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useAdminProducts } from '@/hooks/use-admin-products';

export default function AdminProductsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const page = Number(searchParams.get('page')) || 1;
  const limit = Number(searchParams.get('limit')) || 10;
  const search = searchParams.get('search') || undefined;
  const categoryId = searchParams.get('categoryId') || undefined;
  const minPrice = searchParams.get('minPrice')
    ? Number(searchParams.get('minPrice'))
    : undefined;
  const maxPrice = searchParams.get('maxPrice')
    ? Number(searchParams.get('maxPrice'))
    : undefined;
  const inStockOnly = searchParams.get('inStockOnly') === 'true' || undefined;
  const sortBy = searchParams.get('sortBy') as any || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') as any || 'DESC';

  const { data, isLoading } = useAdminProducts({
    page,
    limit,
    search,
    categoryId,
    minPrice,
    maxPrice,
    inStockOnly,
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

## 7. Stock Management

### 7.1 Stock Adjustment (Internal Use)

The `adjustStock` endpoint is **not exposed via HTTP** — it's an internal service method called by the Orders/Payments module after a successful purchase. The frontend should **not** call this directly.

### 7.2 Displaying Stock Status

Use the `availabilityStatus` field for UI badges:

```typescript
function StockBadge({ stock, availabilityStatus }: { stock: number; availabilityStatus: string }) {
  const variants: Record<string, string> = {
    'In Stock': 'bg-green-100 text-green-800',
    'Low Stock': 'bg-yellow-100 text-yellow-800',
    'Out of Stock': 'bg-red-100 text-red-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${variants[availabilityStatus]}`}>
      {availabilityStatus} ({stock} available)
    </span>
  );
}
```

### 7.3 Bulk Stock Update (Admin Import)

`bulkUpdateStock` is also an **internal service method** used during CSV/bulk import operations. Not exposed via HTTP.

---

## 8. Caching & Invalidation Strategy

### 8.1 Cache Durations

| Query Type | `staleTime` | Rationale |
|------------|-------------|-----------|
| Public product list | `60_000` (1 min) | Catalog content changes infrequently |
| Public product detail | `300_000` (5 min) | Single product is very stable |
| Admin product list | `30_000` (30 sec) | Admin needs fresher data |

### 8.2 Invalidation Rules

| Mutation | Invalidates |
|----------|-------------|
| `createProduct` | `productsKeys.adminLists()`, `productsKeys.lists()` |
| `updateProduct` | `productsKeys.adminLists()`, `productsKeys.lists()`, `productsKeys.details()`, `productsKeys.adminDetail(id)` |
| `togglePublish` | `productsKeys.adminLists()`, `productsKeys.lists()` |
| `deleteProduct` | `productsKeys.adminLists()`, `productsKeys.lists()` |

### 8.3 Optimistic Updates (Optional)

For `togglePublish`, consider optimistic updates:

```typescript
export function useTogglePublishOptimistic() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: adminTogglePublish,
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: productsKeys.adminLists() });
      const previous = qc.getQueryData(productsKeys.adminLists());

      qc.setQueryData(productsKeys.adminLists(), (old: PaginatedProducts | undefined) => {
        if (!old) return old;
        return {
          ...old,
          data: old.data.map((p) =>
            p.id === id ? { ...p, isPublished: !p.isPublished } : p,
          ),
        };
      });

      return { previous };
    },
    onError: (_err, _id, context) => {
      qc.setQueryData(productsKeys.adminLists(), context?.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: productsKeys.adminLists() });
    },
  });
}
```

---

## 9. Example Usage (Next.js / React)

### 9.1 Public Product Catalog Page

```typescript
// app/products/page.tsx
'use client';

import { usePublishedProducts } from '@/hooks/use-products';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Pagination } from '@/components/Pagination';

export default function ProductsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const page = Number(searchParams.get('page')) || 1;
  const limit = Number(searchParams.get('limit')) || 12;
  const categorySlug = searchParams.get('category') || undefined;
  const minPrice = searchParams.get('minPrice')
    ? Number(searchParams.get('minPrice'))
    : undefined;
  const maxPrice = searchParams.get('maxPrice')
    ? Number(searchParams.get('maxPrice'))
    : undefined;
  const inStockOnly = searchParams.get('inStockOnly') === 'true' || undefined;

  const { data, isLoading, error } = usePublishedProducts({
    page,
    limit,
    categorySlug,
    minPrice,
    maxPrice,
    inStockOnly,
  });

  if (isLoading) return <ProductGridSkeleton />;
  if (error) return <ErrorMessage error={error} />;
  if (!data?.data.length) return <EmptyState />;

  return (
    <main>
      <h1>Products</h1>
      <FilterSidebar />
      <ProductGrid products={data.data} />
      <Pagination
        page={data.page}
        totalPages={data.totalPages}
        onPageChange={(p) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set('page', String(p));
          router.replace(`${pathname}?${params.toString()}`);
        }}
      />
    </main>
  );
}
```

### 9.2 Admin Product Form (Create/Edit)

```typescript
// app/admin/products/new/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateProduct } from '@/hooks/use-admin-products';
import { parseValidationErrors } from '@/lib/api/error-utils';
import type { CreateProductDto } from '@/types/products';

export default function NewProductPage() {
  const router = useRouter();
  const createMutation = useCreateProduct();
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormErrors({});

    const formData = new FormData(e.currentTarget);
    const dto: CreateProductDto = {
      title: formData.get('title') as string,
      description: formData.get('description') as string,
      shortDescription: (formData.get('shortDescription') as string) || undefined,
      price: Number(formData.get('price')),
      sku: formData.get('sku') as string,
      discountPercentage: formData.get('discountPercentage')
        ? Number(formData.get('discountPercentage'))
        : undefined,
      stock: formData.get('stock') ? Number(formData.get('stock')) : undefined,
      categoryId: (formData.get('categoryId') as string) || undefined,
      tags: (formData.get('tags') as string)
        ?.split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      brand: (formData.get('brand') as string) || undefined,
      images: [], // handle image uploads separately
    };

    try {
      await createMutation.mutateAsync(dto);
      router.push('/admin/products');
    } catch (err: any) {
      setFormErrors(parseValidationErrors(err));
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input name="title" required maxLength={300} placeholder="Product title" />
      {formErrors.title && <span className="error">{formErrors.title}</span>}

      <textarea name="description" required placeholder="Full description" />
      {formErrors.description && <span className="error">{formErrors.description}</span>}

      <input name="price" type="number" step="0.01" min="0" required />
      {formErrors.price && <span className="error">{formErrors.price}</span>}

      <input name="sku" required maxLength={50} placeholder="SKU" />
      {formErrors.sku && <span className="error">{formErrors.sku}</span>}

      <input name="tags" placeholder="tag1, tag2, tag3" />

      <CategorySelect name="categoryId" />

      {formErrors._global && <Alert variant="error">{formErrors._global}</Alert>}

      <button type="submit" disabled={createMutation.isPending}>
        {createMutation.isPending ? 'Saving...' : 'Create Product'}
      </button>
    </form>
  );
}
```

### 9.3 Admin Product List with Actions

```typescript
// app/admin/products/page.tsx
'use client';

import { useAdminProducts, useTogglePublish, useDeleteProduct } from '@/hooks/use-admin-products';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Pagination } from '@/components/Pagination';

export default function AdminProductsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const page = Number(searchParams.get('page')) || 1;
  const limit = Number(searchParams.get('limit')) || 10;
  const search = searchParams.get('search') || undefined;

  const { data, isLoading } = useAdminProducts({ page, limit, search });
  const togglePublish = useTogglePublish();
  const deleteProduct = useDeleteProduct();

  const handleTogglePublish = async (id: string) => {
    await togglePublish.mutateAsync(id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure? This will soft-delete the product.')) return;
    await deleteProduct.mutateAsync(id);
  };

  if (isLoading) return <TableSkeleton />;

  return (
    <div>
      <SearchBar />
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>SKU</th>
            <th>Price</th>
            <th>Stock</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data?.data.map((product) => (
            <tr key={product.id}>
              <td>{product.title}</td>
              <td>{product.sku}</td>
              <td>${Number(product.price).toFixed(2)}</td>
              <td>{product.stock}</td>
              <td>
                <Badge variant={product.isPublished ? 'green' : 'gray'}>
                  {product.isPublished ? 'Published' : 'Draft'}
                </Badge>
              </td>
              <td>
                <button onClick={() => handleTogglePublish(product.id)}>
                  {product.isPublished ? 'Unpublish' : 'Publish'}
                </button>
                <Link href={`/admin/products/${product.id}/edit`}>Edit</Link>
                <button onClick={() => handleDelete(product.id)} disabled={deleteProduct.isPending}>
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

---

## 10. Gotchas & Edge Cases

### 10.1 Slug Auto-Generation

- The backend **auto-generates slugs** from the title using `generateUniqueSlug()`.
- The frontend **should not** send a `slug` field unless explicitly overriding — it's computed server-side.
- If the title changes during an update, the slug is **regenerated** (with uniqueness check).
- **Implication:** After updating a title, the product's public URL changes. Update any cached references.

### 10.2 Pricing — Decimal, Not Float

- `price`, `discountPercentage`, and `discountedPrice` are stored as `DECIMAL` in PostgreSQL.
- The frontend receives them as **numbers** (TypeORM converts them).
- Always use `Number(product.price).toFixed(2)` when displaying prices to avoid floating-point display issues.
- `discountedPrice` is **auto-computed** by the backend via `@BeforeInsert()` / `@BeforeUpdate()` hooks.

### 10.3 Tags Normalization

- Tags are **normalized server-side**: trimmed, lowercased, empty strings removed.
- Frontend can send any casing/format; the backend handles normalization via `@BeforeInsert()` / `@BeforeUpdate()`.
- The `tags` query parameter is a **comma-separated string**, not an array.

### 10.4 Soft Delete

- Products are **soft-deleted** (not permanently removed). The `deletedAt` field is set on deletion.
- Soft-deleted products are **excluded** from all queries automatically by TypeORM.
- **Frontend:** Deleted products will simply disappear from lists. No special handling needed.

### 10.5 Stock Adjustment is Internal

- `adjustStock` is **not an HTTP endpoint** — it's called internally by the Orders module.
- Stock changes happen automatically when orders are placed.
- **Frontend:** Don't attempt to modify stock directly. Use the product update endpoint for manual corrections.

### 10.6 Reviews Stored as JSONB

- Product reviews are stored as a **JSONB array** on the product entity, not in a separate table.
- The `rating` field is **auto-computed** from the reviews array.
- **Implication:** Adding a review requires updating the entire product. For high-volume review systems, consider normalizing to a separate table later.

### 10.7 Sort Field Whitelist

- The backend **whitelists** sortable fields: `price`, `rating`, `createdAt`, `title`, `stock`.
- Any other sort field defaults to `createdAt`.
- **Frontend:** Only expose these fields as sortable columns in the admin table.

### 10.8 Category Relation

- Products include the `category` relation in list and detail responses.
- If `categoryId` is set but the category is deleted (via `SET NULL` cascade), `category` will be `null` but `categoryId` remains.
- **Frontend:** Handle `product.category === null` gracefully in UI.

### 10.9 Boolean Query Param Parsing

- The backend uses `@Type(() => Boolean)` to parse `inStockOnly` from query strings.
- Accepted values: `'true'`, `true`, `1`, `'1'`.
- **Frontend:** Always send `?inStockOnly=true` as a string in query params.

### 10.10 Image URLs

- `images` and `thumbnail` are **string URL fields**, not file upload endpoints.
- The frontend is responsible for uploading images to a storage service (S3, Cloudinary, etc.) and passing the resulting URLs.

### 10.11 PII in Reviews

- `ProductReview` includes `reviewerEmail` which is PII.
- The `ProductResponseDto` currently exposes it via `@Expose()`.
- **Recommendation:** Consider excluding `reviewerEmail` from public API responses or anonymizing it.

---

## Appendix A: Complete File Structure (Frontend)

```
frontend/
├── types/
│   └── products.ts               # All TypeScript interfaces
├── lib/
│   └── api/
│       ├── client.ts             # Axios instance
│       ├── products.ts           # API functions
│       ├── products-keys.ts      # React Query keys
│       └── error-utils.ts        # Error parsing helpers
├── hooks/
│   ├── use-products.ts           # Public query hooks
│   └── use-admin-products.ts     # Admin mutation hooks
├── components/
│   ├── products/
│   │   ├── product-grid.tsx
│   │   ├── product-card.tsx
│   │   ├── product-filters.tsx
│   │   └── stock-badge.tsx
│   ├── admin/
│   │   ├── product-form.tsx
│   │   └── product-table.tsx
│   └── Pagination.tsx
└── app/
    ├── products/
    │   ├── page.tsx              # Public catalog listing
    │   └── [slug]/
    │       └── page.tsx          # Public product detail
    └── admin/
        └── products/
            ├── page.tsx          # Admin listing
            ├── new/
            │   └── page.tsx      # Create form
            └── [id]/
                └── edit/
                    └── page.tsx  # Edit form
```

---

## Appendix B: Quick Reference Card

```
┌─────────────────────────────────────────────────────────────────┐
│  PRODUCTS MODULE — QUICK REFERENCE                              │
├─────────────────────────────────────────────────────────────────┤
│  Admin Base:  POST/PATCH/DELETE/GET /admin/products             │
│  Public Base: GET /products, GET /products/:slug,               │
│               GET /products/category/:categorySlug              │
│  Auth:        JWT + ADMIN role (admin), None (public)           │
│  Pagination:  ?page=1&limit=10&sortBy=createdAt&sortOrder=DESC │
│  Filters:     ?categoryId=&search=&minPrice=&maxPrice=          │
│               &minRating=&tags=&inStockOnly=                    │
│  Max limit:   100                                               │
│  Sort fields: price, rating, createdAt, title, stock            │
│  Error shape: { statusCode, message, errors?, timestamp, path } │
│  List shape:  { data: Product[], total, totalPages, page, limit}│
│  Slug:        Auto-generated, changes on title update           │
│  Pricing:     DECIMAL, discountedPrice auto-computed            │
│  Tags:        Auto-normalized (lowercase, trimmed)              │
│  Reviews:     JSONB array, rating auto-computed                 │
│  Delete:      Soft-delete (deletedAt set)                       │
│  Stock:       Internal only (adjustStock, bulkUpdateStock)      │
│  Publish:     Toggles isPublished boolean                       │
└─────────────────────────────────────────────────────────────────┘
```
