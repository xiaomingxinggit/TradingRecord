import { Router, json } from 'express';

export function createPlanOrdersRouter(store) {
  const router = Router({ mergeParams: true });
  router.get('/', (req, res) => res.json({ orders: store.listForPlan(req.params.planId) }));
  router.post('/', json({ limit: '32kb' }), (req, res) => {
    const result = store.createForPlan(req.params.planId, req.body);
    res.status(result.created ? 201 : 200).json(result);
  });
  router.patch('/:orderId/status', json({ limit: '8kb' }), (req, res) => {
    res.json(store.changeStatus(req.params.planId, req.params.orderId, req.body));
  });
  router.patch('/:orderId/compared-fields', json({ limit: '8kb' }), (req, res) => {
    res.json(store.updateComparedFields(req.params.planId, req.params.orderId, req.body));
  });
  return router;
}
