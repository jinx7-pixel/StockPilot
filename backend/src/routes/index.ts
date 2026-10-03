import { Router } from 'express';

import { healthRouter } from './health.routes.js';

/**
 * Root API router. Every feature module (products, inventory, suppliers, …) will
 * be mounted here as a sub-router, e.g. `apiRouter.use('/products', productRouter)`.
 */
export const apiRouter: Router = Router();

apiRouter.use(healthRouter);
