import { Router } from 'express';

import { authRouter } from './auth.routes.js';
import { categoryRouter } from './category.routes.js';
import { healthRouter } from './health.routes.js';
import { inventoryRouter } from './inventory.routes.js';
import { productRouter } from './product.routes.js';
import { purchaseOrderRouter } from './purchaseOrder.routes.js';
import { salesRouter } from './sales.routes.js';
import { supplierRouter } from './supplier.routes.js';

/**
 * Root API router. Every feature module is mounted here as a sub-router.
 *
 * Each module router applies its own `requireAuth` and role guards, so a new
 * module cannot be accidentally mounted unauthenticated.
 */
export const apiRouter: Router = Router();

apiRouter.use(healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/categories', categoryRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/inventory', inventoryRouter);
apiRouter.use('/sales', salesRouter);
apiRouter.use('/suppliers', supplierRouter);
apiRouter.use('/purchase-orders', purchaseOrderRouter);
