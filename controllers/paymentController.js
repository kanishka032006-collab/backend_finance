const prisma = require('../utils/prisma');
const financeService = require('../services/financeService');
const { logAudit } = require('../utils/auditLogger');

exports.recordPayment = async (req, res, next) => {
  try {
    const {
      accountId,
      customerId,
      amount,
      paymentDate = new Date(),
      paymentMethod = 'CASH',
      reference,
      notes
    } = req.body;

    const result = await financeService.recordPayment({
      accountId,
      customerId,
      collectorId: req.user.id,
      amount,
      paymentDate,
      paymentMethod,
      reference,
      notes,
      enforceCollectorAssignment: req.user.role === 'COLLECTION_STAFF'
    });

    await logAudit({
      userId: req.user.id,
      action: 'RECORD_PAYMENT',
      entity: 'Payment',
      entityId: result.payment.id,
      details: {
        receiptNumber: result.receiptNumber,
        accountId,
        amount,
        paymentMethod,
        remainingBalance: result.remainingBalance
      },
      req
    });

    res.status(201).json({
      success: true,
      message: `Payment of ₹${amount} recorded successfully. Receipt #${result.receiptNumber}`,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

exports.reversePayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Reversal reason is required.' });
    }

    const reversed = await financeService.reversePayment({
      paymentId: id,
      reason,
      reversedById: req.user.id
    });

    await logAudit({
      userId: req.user.id,
      action: 'REVERSE_PAYMENT',
      entity: 'Payment',
      entityId: id,
      details: {
        receiptNumber: reversed.receiptNumber,
        amount: reversed.amount,
        reason,
        reversedBy: req.user.name
      },
      req
    });

    res.json({
      success: true,
      message: `Payment #${reversed.receiptNumber} has been reversed.`,
      payment: reversed
    });
  } catch (error) {
    next(error);
  }
};

exports.listPayments = async (req, res, next) => {
  try {
    const {
      search,
      status,
      paymentMethod,
      collectorId,
      customerId,
      startDate,
      endDate,
      page = 1,
      limit = 50
    } = req.query;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const where = {};
    if (status) where.status = status;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (req.user.role === 'COLLECTION_STAFF') where.collectorId = req.user.id;
    else if (collectorId) where.collectorId = collectorId;
    if (customerId) where.customerId = customerId;

    if (startDate || endDate) {
      where.paymentDate = {};
      if (startDate) where.paymentDate.gte = new Date(startDate);
      if (endDate) {
        const e = new Date(endDate);
        e.setHours(23, 59, 59, 999);
        where.paymentDate.lte = e;
      }
    }

    if (search) {
      where.OR = [
        { receiptNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { customerCode: { contains: search, mode: 'insensitive' } } },
        { account: { accountNumber: { contains: search, mode: 'insensitive' } } },
        { reference: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [total, payments] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.findMany({
        where,
        skip,
        take,
        include: {
          customer: { select: { id: true, name: true, customerCode: true, mobile: true } },
          account: { select: { id: true, accountNumber: true, agreedRepayment: true } },
          collector: { select: { id: true, name: true, email: true } },
          reversedBy: { select: { id: true, name: true } },
          allocations: {
            include: {
              instalment: {
                select: { weekNumber: true, dueDate: true, scheduledAmount: true }
              }
            }
          }
        },
        orderBy: { paymentDate: 'desc' }
      })
    ]);

    res.json({
      success: true,
      payments,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: take,
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getReceiptDetails = async (req, res, next) => {
  try {
    const { receiptNumber } = req.params;

    const payment = await prisma.payment.findFirst({
      where: {
        receiptNumber,
        ...(req.user.role === 'COLLECTION_STAFF' ? { collectorId: req.user.id } : {})
      },
      include: {
        customer: true,
        account: {
          include: {
            instalments: { orderBy: { weekNumber: 'asc' } },
            payments: { where: { status: 'COMPLETED' } }
          }
        },
        collector: { select: { id: true, name: true, email: true } },
        reversedBy: { select: { name: true } },
        allocations: {
          include: {
            instalment: true
          }
        }
      }
    });

    if (!payment) {
      return res.status(404).json({ success: false, message: 'Receipt not found.' });
    }

    const totalAgreed = Number(payment.account.agreedRepayment);
    const totalPaid = payment.account.payments.reduce((s, p) => s + Number(p.amount), 0);
    const remainingBalance = Math.max(0, totalAgreed - totalPaid);

    res.json({
      success: true,
      receipt: {
        receiptNumber: payment.receiptNumber,
        paymentDate: payment.paymentDate,
        status: payment.status,
        amount: Number(payment.amount),
        paymentMethod: payment.paymentMethod,
        reference: payment.reference,
        notes: payment.notes,
        collectorName: payment.collector?.name || 'N/A',
        reversedAt: payment.reversedAt,
        reversalReason: payment.reversalReason,
        reversedByName: payment.reversedBy?.name,
        customer: {
          name: payment.customer.name,
          customerCode: payment.customer.customerCode,
          mobile: payment.customer.mobile,
          address: payment.customer.address
        },
        account: {
          accountNumber: payment.account.accountNumber,
          agreedRepayment: totalAgreed,
          actualDisbursed: Number(payment.account.actualDisbursed),
          grossDifference: Number(payment.account.grossDifference),
          totalPaid,
          remainingBalance
        },
        allocations: payment.allocations.map(a => ({
          weekNumber: a.instalment.weekNumber,
          dueDate: a.instalment.dueDate,
          allocatedAmount: Number(a.allocatedAmount)
        }))
      }
    });
  } catch (error) {
    next(error);
  }
};
