/**
 * Sales business rules.
 *
 * ## A sale is a transaction over the existing ledger
 *
 * Creating a sale writes a header, its lines, **and** one `out` movement per
 * product into `inventory_movements` — all inside a single PostgreSQL
 * transaction. Stock changes only because of those ledger entries; nothing here
 * touches a product row or keeps a stock total of its own.
 *
 * The movements are written through `appendMovement` from `inventory.service.ts`
 * — the *same* function the direct `POST /api/inventory/movements` route uses.
 * The same advisory lock, balance read and non-negative check therefore apply
 * here. There is one stock system, not two.
 *
 * ## Money
 *
 * `line_total` is `quantity * unit_price` and `total_amount` is the sum of the
 * line totals, **all computed by PostgreSQL** in exact `numeric` and returned as
 * strings. `unit_price` is snapshotted from the product's current
 * `selling_price`, so a later price change never rewrites history. No monetary
 * arithmetic happens in JavaScript anywhere in this flow.
 *
 * ## Lock ordering and duplicate products
 *
 * A multi-item sale takes one lock per product. Two concurrent sales that share
 * products must not deadlock, so locks are acquired in a **deterministic order**
 * (ascending product id) before any movement is written. Advisory locks are
 * re-entrant within a session, so the per-product acquisition inside
 * `appendMovement` then costs nothing.
 *
 * If a sale lists the same product twice, the stock check and the ledger use the
 * **summed** quantity, while the sale keeps one line per requested item. Checking
 * each line independently would be wrong: two lines of 3 against a balance of 5
 * would each pass and oversell.
 */

import { withTransaction } from '../db/pool.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { acquireProductStockLock } from '../repositories/inventory.repository.js';
import {
  findSaleById,
  insertSale,
  insertSaleItem,
  listSales,
  resolveSaleItems,
  type ResolvedSaleItem,
  type Sale,
  type SaleDetail,
} from '../repositories/sale.repository.js';
import { appendMovement } from './inventory.service.js';
import type { CreateSaleInput, ListSalesQuery } from './sales.schemas.js';

/** The reference written onto every movement created by a sale. */
const MOVEMENT_REFERENCE_TYPE = 'sale';

export interface SalePage {
  items: Sale[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export async function listBusinessSales(
  businessId: string,
  query: ListSalesQuery,
): Promise<SalePage> {
  const { items, total } = await listSales(businessId, {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.status !== undefined ? { status: query.status } : {}),
    ...(query.from !== undefined ? { from: query.from } : {}),
    ...(query.to !== undefined ? { to: query.to } : {}),
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });

  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

/** One sale with its lines. A sale in another business is simply not found. */
export async function getSale(businessId: string, saleId: string): Promise<SaleDetail> {
  const sale = await findSaleById(businessId, saleId);
  if (!sale) throw new NotFoundError('Sale not found.');
  return sale;
}

/**
 * Create a sale and move the stock, atomically.
 *
 * Inside one transaction:
 *  1. resolve every line against this business, snapshot prices, compute all
 *     money in SQL;
 *  2. take each product's advisory lock, in ascending product-id order;
 *  3. insert the sale header;
 *  4. insert the sale lines;
 *  5. append one `out` movement per distinct product, through the inventory
 *     service.
 *
 * If any step throws — unknown product, inactive product, insufficient stock —
 * the transaction rolls back, so there is never a partial sale and never an
 * orphaned movement.
 */
export async function createSale(
  businessId: string,
  userId: string,
  input: CreateSaleInput,
): Promise<SaleDetail> {
  return withTransaction(async (client) => {
    // 1. One query resolves every line, snapshots prices, and computes both the
    //    per-line totals and the sale total, all in exact `numeric`.
    const lines = await resolveSaleItems(client, businessId, input.items);

    // A requested line produced no row: the product does not exist, or it
    // belongs to another business. Both are reported identically, so nothing
    // about another tenant is confirmed.
    if (lines.length !== input.items.length) {
      throw new NotFoundError(
        'One or more products were not found in your business.',
        'PRODUCT_NOT_FOUND',
      );
    }

    const inactive = lines.find((line) => !line.isActive);
    if (inactive) {
      throw new ValidationError(
        `Cannot sell "${inactive.productName}" because the product is inactive.`,
        'PRODUCT_INACTIVE',
      );
    }

    // Distinct products, in ascending id order.
    const distinct = new Map<string, ResolvedSaleItem>();
    for (const line of lines) {
      if (!distinct.has(line.productId)) distinct.set(line.productId, line);
    }
    const productIds = [...distinct.keys()].sort();

    // 2. Lock every product in a deterministic order, so two sales sharing
    //    products cannot deadlock. `appendMovement` re-acquires per product,
    //    which is free while we already hold the lock.
    for (const productId of productIds) {
      await acquireProductStockLock(client, businessId, productId);
    }

    // 3. The sale header. `total_amount` is the SQL-computed grand total.
    const sale = await insertSale(client, {
      businessId,
      customerName: input.customerName ?? null,
      customerPhone: input.customerPhone ?? null,
      totalAmount: lines[0]!.saleTotal,
      soldAt: input.soldAt ?? new Date(),
      createdBy: userId,
    });

    // 4. One line per requested item, in the order the client sent them.
    for (const line of lines) {
      await insertSaleItem(client, {
        saleId: sale.id,
        businessId,
        productId: line.productId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
      });
    }

    // 5. One `out` movement per distinct product, for the summed quantity.
    for (const productId of productIds) {
      const line = distinct.get(productId)!;

      await appendMovement(client, {
        businessId,
        productId,
        productName: line.productName,
        productUnit: line.unit,
        movementType: 'out',
        quantity: line.productQuantity,
        reason: 'Sale',
        referenceType: MOVEMENT_REFERENCE_TYPE,
        referenceId: sale.id,
        createdBy: userId,
      });
    }

    // Read the sale back on this transaction's connection: the pool cannot see
    // the row we just created, because it is not committed yet.
    const created = await findSaleById(businessId, sale.id, client);
    if (!created) throw new Error('Sale disappeared inside its own transaction');

    return created;
  });
}
