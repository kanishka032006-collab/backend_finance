const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.use(authorize(['ADMINISTRATOR', 'READ_ONLY_AUDITOR']));

router.get('/daily', reportController.getDailyReport);
router.get('/weekly', reportController.getWeeklyReport);
router.get('/monthly', reportController.getMonthlyReport);
router.get('/customers', reportController.getCustomerReport);
router.get('/collectors', reportController.getCollectorReport);
router.get('/outstanding', reportController.getOutstandingReport);
router.get('/overdue', reportController.getOverdueReport);
router.get('/disbursements', reportController.getDisbursementReport);
router.get('/completed', reportController.getCompletedReport);
router.get('/export', reportController.exportReportCSV);

module.exports = router;
