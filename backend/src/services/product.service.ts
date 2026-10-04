/**
 * Product business rules.
 *
 * Products are **catalog definitions only**. Nothing here computes or stores
 * stock, availability, reorder points, risk or demand — those belong to the
 * future inventory and intelligence modules and must be derivable from stock
 * movements rather than frozen on the product row.
 *
 * Deletion is a **soft delete** (deactivate). See `deactivateProduct` for why.
 */

import { ConflictError, NotFoundError } from '../errors.js';
import {
  createProduct,
  findProductById,
  listProducts,
  skuExists,
  updateProduct,
  type ListProductsResult,
  type ProductWithCategory,
} from '../repositories/product.repository.js';
import { assertCategoryBelongsToBusiness } from './category.service.js';
import type { CreateProductInput, ListProductsQuery, UpdateProductInput } from './product.schemas.js';

export async function listProductsForBusiness(
  businessId: string,
  query: ListProductsQuery,
): Promise<ListProductsResult & { page: number; limit: number; totalPages: number }> {
  const page = query.page;
  const limit = query.limit;

  const result = await listProducts(businessId, {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    limit,
    offset: (page - 1) * limit,
  });

  return {
    ...result,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(result.total / limit)),
  };
}

export async function getProduct(
  businessId: string,
  productId: string,
): Promise<ProductWithCategory> {
  const product = await findProductById(businessId, productId);
  if (!product) throw new NotFoundError('Product not found.');
  return product;
}

export async function createProductForBusiness(
  businessId: string,
  input: CreateProductInput,
): Promise<ProductWithCategory> {
  // Validate the category *before* the SKU check so a bad category always
  // reports the same way, whether or not the SKU also clashes.
  await assertCategoryBelongsToBusiness(businessId, input.categoryId ?? '');

  if (await skuExists(businessId, input.sku)) {
    throw new ConflictError('A product with this SKU already exists.', 'SKU_TAKEN');
  }

  return createProduct({
    businessId,
    categoryId: input.categoryId ?? null,
    sku: input.sku,
    name: input.name,
    description: input.description ?? null,
    unit: input.unit,
    costPrice: input.costPrice,
    sellingPrice: input.sellingPrice,
    isActive: input.isActive ?? true,
  });
}

export async function updateProductForBusiness(
  businessId: string,
  productId: string,
  input: UpdateProductInput,
): Promise<ProductWithCategory> {
  // Confirms existence and tenant ownership first, so a cross-business update
  // 404s rather than reporting a SKU clash it should not be able to see.
  await getProduct(businessId, productId);

  if (input.categoryId !== undefined) {
    await assertCategoryBelongsToBusiness(businessId, input.categoryId ?? '');
  }

  if (input.sku !== undefined && (await skuExists(businessId, input.sku, productId))) {
    throw new ConflictError('A product with this SKU already exists.', 'SKU_TAKEN');
  }

  const updated = await updateProduct({
    businessId,
    productId,
    // Explicit spreads, because `exactOptionalPropertyTypes` distinguishes an
    // absent key from a key present with value `undefined` — and for
    // `categoryId`/`description` the difference decides "leave alone" vs
    // "clear it".
    ...(input.sku !== undefined ? { sku: input.sku } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
    ...(input.unit !== undefined ? { unit: input.unit } : {}),
    ...(input.costPrice !== undefined ? { costPrice: input.costPrice } : {}),
    ...(input.sellingPrice !== undefined ? { sellingPrice: input.sellingPrice } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  });

  if (!updated) throw new NotFoundError('Product not found.');
  return updated;
}

/**
 * Retire a product.
 *
 * This is a **soft delete**: the row is deactivated rather than removed, and the
 * product is returned so the caller can show the new state.
 *
 * Rationale — hard deletion is unsafe here. As soon as the inventory module
 * lands, products will be referenced by stock movements, adjustments, sales and
 * purchase orders. A hard delete would then either fail on a foreign key or
 * cascade away financial history that must never disappear. Deactivating keeps
 * the catalog row — and therefore every past movement — intact, is reversible,
 * and lets the product be brought back with `PATCH { isActive: true }`. Deleting
 * a product that is already inactive is a no-op, so the call is idempotent.
 */
export async function deactivateProduct(
  businessId: string,
  productId: string,
): Promise<ProductWithCategory> {
  return updateProductForBusiness(businessId, productId, { isActive: false });
}
