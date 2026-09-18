import { Router } from 'express';

export function createPlanEventsRouter(store) {
  const router = Router({ mergeParams: true });
  router.get('/', (req, res) => res.json({ events: store.listForPlan(req.params.planId) }));
  return router;
}
