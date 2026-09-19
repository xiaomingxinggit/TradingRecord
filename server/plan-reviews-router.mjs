import { Router, json } from 'express';

export function createPlanReviewsRouter(store) {
  const router = Router({ mergeParams: true });
  router.get('/', (req, res) => res.json({ review: store.get(req.params.planId) }));
  router.put('/', json({ limit: '16kb' }), (req, res) => res.json({ review: store.save(req.params.planId, req.body) }));
  return router;
}
