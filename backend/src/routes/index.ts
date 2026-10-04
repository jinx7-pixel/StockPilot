import { Router } from 'express';

import { authRouter } from './auth.routes.js';
import { categoryRouter } from './category.routes.js';
import { healthRouter } from './health.routes.js';
import { inventoryRouter } from './inventory.routes.js';
import { productRouter } from './product.routes.js';
import { salesRouter } from './sales.routes.js';

/**
 * Root API router. Every feature module (suppliers, purchases, …) will be
 * mounted here as a sub-router, e.g. `apiRouter.use('/suppliers', supplierRouter)`.
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
