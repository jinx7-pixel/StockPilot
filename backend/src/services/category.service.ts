/**
 * Category business rules.
 *
 * Everything tenant-scoped takes `businessId` from the authenticated session —
 * never from a request parameter. A category that belongs to another business
 * is reported as *not found*, not as *forbidden*, so the API never reveals that
 * it exists.
 */

import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import {
  categoryNameExists,
  countProductsInCategory,
  createCategory,
  deleteCategory,
  findCategoryById,
  listCategories,
  updateCategory,
  type Category,
} from '../repositories/category.repository.js';
import type { CreateCategoryInput, UpdateCategoryInput } from './category.schemas.js';

export async function listCategoriesForBusiness(businessId: string): Promise<Category[]> {
  return listCategories(businessId);
}

export async function getCategory(businessId: string, categoryId: string): Promise<Category> {
  const category = await findCategoryById(businessId, categoryId);
  if (!category) throw new NotFoundError('Category not found.');
  return category;
}

export async function createCategoryForBusiness(
  businessId: string,
  input: CreateCategoryInput,
): Promise<Category> {
  if (await categoryNameExists(businessId, input.name)) {
    throw new ConflictError(
      'A category with this name already exists.',
      'CATEGORY_NAME_TAKEN',
    );
  }

  return createCategory({
    businessId,
    name: input.name,
    description: input.description ?? null,
  });
}

export async function updateCategoryForBusiness(
  businessId: string,
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<Category> {
  // Confirms existence *and* tenant ownership before the name check, so a
  // cross-business update 404s instead of leaking a name conflict.
  await getCategory(businessId, categoryId);

  if (input.name !== undefined && (await categoryNameExists(businessId, input.name, categoryId))) {
    throw new ConflictError('A category with this name already exists.', 'CATEGORY_NAME_TAKEN');
  }

  const updated = await updateCategory({
    businessId,
    categoryId,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
  });

  if (!updated) throw new NotFoundError('Category not found.');
  return updated;
}

/**
 * Delete a category.
 *
 * Refused while products still reference it: the foreign key is `ON DELETE
 * RESTRICT`, so PostgreSQL would reject the delete anyway. Checking first turns
 * that into a clear 409 instead of an opaque constraint error, and guarantees
 * products are never silently orphaned. Reassign or remove the products first.
 */
export async function deleteCategoryForBusiness(
  businessId: string,
  categoryId: string,
): Promise<void> {
  await getCategory(businessId, categoryId);

  const productCount = await countProductsInCategory(categoryId);
  if (productCount > 0) {
    throw new ConflictError(
      `This category still has ${productCount} product${productCount === 1 ? '' : 's'}. ` +
        'Move or remove them before deleting it.',
      'CATEGORY_NOT_EMPTY',
    );
  }

  const deleted = await deleteCategory(businessId, categoryId);
  if (!deleted) throw new NotFoundError('Category not found.');
}

/**
 * Confirm a category id belongs to this business.
 *
 * The same error covers "does not exist" and "belongs to someone else", so a
 * client cannot probe for the existence of another tenant's categories.
 */
export async function assertCategoryBelongsToBusiness(
  businessId: string,
  categoryId: string,
): Promise<void> {
  if (!categoryId) return;

  const category = await findCategoryById(businessId, categoryId);
  if (!category) {
    throw new ValidationError('categoryId is not a valid category for this business.');
  }
}
