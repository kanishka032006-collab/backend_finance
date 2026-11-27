const express = require('express');
const router = express.Router();
const salaryController = require('../controllers/salaryController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.use(authorize(['ADMINISTRATOR', 'READ_ONLY_AUDITOR']));

router.get('/', salaryController.getSalaries);
router.get('/summary', salaryController.getSalarySummary);
router.post('/', authorize(['ADMINISTRATOR']), salaryController.createSalary);
router.delete('/:id', authorize(['ADMINISTRATOR']), salaryController.deleteSalary);

module.exports = router;
