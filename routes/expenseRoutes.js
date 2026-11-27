const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expenseController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', expenseController.getExpenses);
router.get('/summary', expenseController.getExpenseSummary);
router.post('/', authorize(['ADMINISTRATOR', 'COLLECTION_STAFF']), expenseController.createExpense);
router.delete('/:id', authorize(['ADMINISTRATOR']), expenseController.deleteExpense);

module.exports = router;
