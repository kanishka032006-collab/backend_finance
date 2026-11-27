const express = require('express');
const router = express.Router();
const routeController = require('../controllers/routeController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// Areas
router.get('/areas', routeController.getAreas);
router.post('/areas', authorize(['ADMINISTRATOR']), routeController.createArea);
router.delete('/areas/:id', authorize(['ADMINISTRATOR']), routeController.deleteArea);

// Routes
router.get('/', routeController.getRoutes);
router.post('/', authorize(['ADMINISTRATOR']), routeController.createRoute);
router.put('/:id', authorize(['ADMINISTRATOR']), routeController.updateRoute);
router.delete('/:id', authorize(['ADMINISTRATOR']), routeController.deleteRoute);

// Customer assignment & schedule
router.post('/:id/assign-customer', authorize(['ADMINISTRATOR', 'COLLECTION_STAFF']), routeController.assignCustomerToRoute);
router.delete('/:id/customers/:customerId', authorize(['ADMINISTRATOR', 'COLLECTION_STAFF']), routeController.removeCustomerFromRoute);
router.get('/:id/schedule', routeController.getRouteSchedule);

module.exports = router;
