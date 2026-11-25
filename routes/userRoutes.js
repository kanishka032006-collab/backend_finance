const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, authorize } = require('../middleware/auth');
const { userValidator } = require('../validators');

router.use(authenticate);

router.get('/', authorize(['ADMINISTRATOR', 'READ_ONLY_AUDITOR']), userController.listUsers);
router.post('/', authorize(['ADMINISTRATOR']), userValidator, userController.createUser);
router.put('/:id', authorize(['ADMINISTRATOR']), userController.updateUser);
router.delete('/:id', authorize(['ADMINISTRATOR']), userController.deleteUser);

module.exports = router;
