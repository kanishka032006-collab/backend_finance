const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { authenticate, authorize } = require('../middleware/auth');
const { customerValidator } = require('../validators');

router.use(authenticate);

router.get('/', customerController.listCustomers);
router.get('/:id', customerController.getCustomerById);
router.post('/', authorize(['ADMINISTRATOR', 'COLLECTION_STAFF']), customerValidator, customerController.createCustomer);
router.put('/:id', authorize(['ADMINISTRATOR', 'COLLECTION_STAFF']), customerController.updateCustomer);
router.delete('/:id', authorize(['ADMINISTRATOR']), customerController.deleteCustomer);

module.exports = router;
