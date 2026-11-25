const { body, param, query, validationResult } = require('express-validator');

const validate = (validations) => {
  return async (req, res, next) => {
    for (const validation of validations) {
      const result = await validation.run(req);
      if (result.errors.length) break;
    }

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    return res.status(400).json({
      success: false,
      message: errors.array()[0].msg,
      errors: errors.array()
    });
  };
};

const loginValidator = validate([
  body('email').isEmail().withMessage('Please provide a valid email address'),
  body('password').notEmpty().withMessage('Password is required')
]);

const customerValidator = validate([
  body('name').trim().notEmpty().withMessage('Customer name is required'),
  body('mobile').trim().matches(/^[0-9+\-\s]{8,15}$/).withMessage('Valid mobile number is required'),
  body('address').trim().notEmpty().withMessage('Address is required'),
  body('kycStatus').optional().isIn(['PENDING', 'VERIFIED', 'REJECTED']).withMessage('Invalid KYC status')
]);

const financeAccountValidator = validate([
  body('customerId').isUUID().withMessage('Valid customer ID is required'),
  body('agreedRepayment').isFloat({ min: 100 }).withMessage('Agreed repayment must be at least ₹100'),
  body('actualDisbursed').isFloat({ min: 50 }).withMessage('Actual disbursed must be at least ₹50'),
  body('totalWeeks').isInt({ min: 1, max: 104 }).withMessage('Total weeks must be between 1 and 104'),
  body('firstDueDate').isISO8601().withMessage('Valid first due date is required'),
  body('dueDay').trim().notEmpty().withMessage('Due day is required')
]);

const paymentValidator = validate([
  body('accountId').isUUID().withMessage('Valid account ID is required'),
  body('amount').isFloat({ min: 1 }).withMessage('Payment amount must be greater than zero'),
  body('paymentMethod').isIn(['CASH', 'UPI', 'BANK_TRANSFER']).withMessage('Invalid payment method'),
  body('paymentDate').optional().isISO8601().withMessage('Invalid payment date format')
]);

const reversalValidator = validate([
  body('reason').trim().isLength({ min: 5 }).withMessage('Reversal reason must be at least 5 characters')
]);

const userValidator = validate([
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('role').isIn(['ADMINISTRATOR', 'COLLECTION_STAFF', 'READ_ONLY_AUDITOR']).withMessage('Invalid role')
]);

module.exports = {
  validate,
  loginValidator,
  customerValidator,
  financeAccountValidator,
  paymentValidator,
  reversalValidator,
  userValidator
};
