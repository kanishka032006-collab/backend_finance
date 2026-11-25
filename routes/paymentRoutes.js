const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate, authorize } = require('../middleware/auth');
const { paymentValidator, reversalValidator } = require('../validators');

router.use(authenticate);

router.get('/', paymentController.listPayments);
router.get('/receipt/:receiptNumber', paymentController.getReceiptDetails);
router.post('/', authorize(['ADMINISTRATOR', 'COLLECTION_STAFF']), paymentValidator, paymentController.recordPayment);
router.post('/:id/reverse', authorize(['ADMINISTRATOR']), reversalValidator, paymentController.reversePayment);

module.exports = router;
