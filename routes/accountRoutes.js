const express = require('express');
const router = express.Router();
const accountController = require('../controllers/accountController');
const { authenticate, authorize } = require('../middleware/auth');
const { financeAccountValidator } = require('../validators');

router.use(authenticate);

router.get('/', accountController.listAccounts);
router.get('/:id', accountController.getAccountById);
router.get('/:id/ledger', accountController.getAccountLedger);
router.post('/', authorize(['ADMINISTRATOR', 'COLLECTION_STAFF']), financeAccountValidator, accountController.createAccount);
router.post('/:id/adjustments', authorize(['ADMINISTRATOR']), accountController.addAdjustment);

module.exports = router;
