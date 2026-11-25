const express = require('express');
const router = express.Router();
const settingController = require('../controllers/settingController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', settingController.getSettings);
router.put('/', authorize(['ADMINISTRATOR']), settingController.updateSettings);
router.get('/audit-logs', authorize(['ADMINISTRATOR', 'READ_ONLY_AUDITOR']), settingController.getAuditLogs);
router.get('/backup', authorize(['ADMINISTRATOR']), settingController.exportBackup);

module.exports = router;
