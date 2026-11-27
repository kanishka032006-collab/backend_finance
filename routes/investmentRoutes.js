const express = require('express');
const router = express.Router();
const investmentController = require('../controllers/investmentController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.use(authorize(['ADMINISTRATOR', 'READ_ONLY_AUDITOR']));

router.get('/', investmentController.getInvestments);
router.get('/summary', investmentController.getInvestmentSummary);
router.post('/', authorize(['ADMINISTRATOR']), investmentController.createInvestment);
router.delete('/:id', authorize(['ADMINISTRATOR']), investmentController.deleteInvestment);

module.exports = router;
