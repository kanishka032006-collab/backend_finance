const { Prisma } = require('../node_modules/.prisma/tridin-client');
const prisma = require('../utils/prisma');
const financeService = require('../services/financeService');
const { logAudit } = require('../utils/auditLogger');
const { getOverdueGraceDays } = require('../utils/systemSettings');

exports.listAccounts = async (req, res, next) => {
  try {
    const { search, status, customerId, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const where = {};
    if (req.user.role === 'COLLECTION_STAFF') where.customer = { assignedCollectorId: req.user.id };
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;
    if (search) {
      where.OR = [
        { accountNumber: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { customerCode: { contains: search, mode: 'insensitive' } } },
        { customer: { mobile: { contains: search, mode: 'insensitive' } } }
      ];
    }

    const [total, accounts] = await Promise.all([
      prisma.financeAccount.count({ where }),
      prisma.financeAccount.findMany({
        where,
        skip,
        take,
        include: {
          customer: {
            select: { id: true, customerCode: true, name: true, mobile: true }
          },
          instalments: {
            orderBy: { weekNumber: 'asc' }
          },
          payments: {
            where: { status: 'COMPLETED' }
          }
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    const now = new Date();
    const overdueCutoff = new Date(now.getTime() - (await getOverdueGraceDays()) * 86400000);

    const enriched = accounts.map(acc => {
      const agreed = Number(acc.agreedRepayment);
      const disbursed = Number(acc.actualDisbursed);
      const grossDiff = Number(acc.grossDifference);
      const totalPaid = acc.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const outstanding = Math.max(0, agreed - totalPaid);

      let overdueAmount = 0;
      let nextDueWeek = null;

      for (const inst of acc.instalments) {
        const sched = Number(inst.scheduledAmount);
        const paid = Number(inst.paidAmount);
        const dueDate = new Date(inst.dueDate);

        if (paid < sched) {
          if (dueDate < overdueCutoff) {
            overdueAmount += (sched - paid);
          } else if (!nextDueWeek) {
            nextDueWeek = {
              weekNumber: inst.weekNumber,
              dueDate: inst.dueDate,
              dueAmount: sched - paid
            };
          }
        }
      }

      return {
        id: acc.id,
        accountNumber: acc.accountNumber,
        customerId: acc.customerId,
        customer: acc.customer,
        agreedRepayment: agreed,
        actualDisbursed: disbursed,
        grossDifference: grossDiff,
        weeklyInstalment: Number(acc.weeklyInstalment),
        totalWeeks: acc.totalWeeks,
        firstDueDate: acc.firstDueDate,
        dueDay: acc.dueDay,
        status: acc.status,
        createdAt: acc.createdAt,
        totalPaid,
        outstandingBalance: outstanding,
        overdueAmount,
        nextDueWeek
      };
    });

    res.json({
      success: true,
      accounts: enriched,
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

exports.getAccountById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const account = await prisma.financeAccount.findFirst({
      where: {
        id,
        ...(req.user.role === 'COLLECTION_STAFF' ? { customer: { assignedCollectorId: req.user.id } } : {})
      },
      include: {
        customer: true,
        instalments: {
          orderBy: { weekNumber: 'asc' },
          include: {
              allocations: {
                where: { payment: { status: 'COMPLETED' } },
              include: {
                payment: {
                  select: { receiptNumber: true, paymentDate: true, paymentMethod: true, status: true }
                }
              }
            }
          }
        },
        payments: {
          orderBy: { paymentDate: 'desc' },
          include: {
            collector: { select: { name: true, email: true } }
          }
        },
        adjustments: {
          orderBy: { createdAt: 'desc' },
          include: {
            createdBy: { select: { name: true } }
          }
        }
      }
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'Finance account not found.' });
    }

    const totalAgreed = Number(account.agreedRepayment);
    const totalDisbursed = Number(account.actualDisbursed);
    const completedPayments = account.payments.filter(p => p.status === 'COMPLETED');
    const totalPaid = completedPayments.reduce((s, p) => s + Number(p.amount), 0);
    const outstandingBalance = Math.max(0, totalAgreed - totalPaid);

    const now = new Date();
    const overdueCutoff = new Date(now.getTime() - (await getOverdueGraceDays()) * 86400000);
    let overdueAmount = 0;

    for (const inst of account.instalments) {
      const sched = Number(inst.scheduledAmount);
      const paid = Number(inst.paidAmount);
      if (paid < sched && new Date(inst.dueDate) < overdueCutoff) {
        overdueAmount += (sched - paid);
      }
    }

    res.json({
      success: true,
      account: {
        ...account,
        summary: {
          totalAgreed,
          totalDisbursed,
          grossDifference: Number(account.grossDifference),
          totalPaid,
          outstandingBalance,
          overdueAmount
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.createAccount = async (req, res, next) => {
  try {
    const {
      customerId,
      agreedRepayment,
      actualDisbursed,
      totalWeeks,
      firstDueDate,
      dueDay,
      notes
    } = req.body;

    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        ...(req.user.role === 'COLLECTION_STAFF' ? { assignedCollectorId: req.user.id } : {})
      }
    });
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }
    if (!customer.active) {
      return res.status(400).json({ success: false, message: 'Cannot create finance account for an inactive customer.' });
    }

    // Calculate terms and validate
    const terms = financeService.calculateAccountTerms(agreedRepayment, actualDisbursed, totalWeeks);

    // Auto-generate weekly instalment schedule
    const schedule = financeService.createInstalmentSchedule(
      terms.totalWeeks,
      terms.agreedRepayment,
      terms.weeklyInstalment,
      firstDueDate
    );

    // Generate unique account number ACC-YYYY-XXXX
    const currentYear = new Date().getFullYear();
    const prefix = `ACC-${currentYear}-`;
    const lastAcc = await prisma.financeAccount.findFirst({
      where: { accountNumber: { startsWith: prefix } },
      orderBy: { createdAt: 'desc' }
    });

    let nextSeq = 1;
    if (lastAcc && lastAcc.accountNumber) {
      const parts = lastAcc.accountNumber.split('-');
      if (parts.length === 3) {
        const seq = parseInt(parts[2], 10);
        if (!isNaN(seq)) nextSeq = seq + 1;
      }
    }
    const accountNumber = `${prefix}${String(nextSeq).padStart(4, '0')}`;

    // Create account and instalments in single transaction
    const newAccount = await prisma.$transaction(async (tx) => {
      const createdAccount = await tx.financeAccount.create({
        data: {
          accountNumber,
          customerId,
          agreedRepayment: new Prisma.Decimal(terms.agreedRepayment),
          actualDisbursed: new Prisma.Decimal(terms.actualDisbursed),
          grossDifference: new Prisma.Decimal(terms.grossDifference),
          weeklyInstalment: new Prisma.Decimal(terms.weeklyInstalment),
          totalWeeks: terms.totalWeeks,
          firstDueDate: new Date(firstDueDate),
          dueDay: dueDay || 'Monday',
          status: 'ACTIVE',
          notes
        }
      });

      // Insert instalments
      for (const item of schedule) {
        await tx.instalment.create({
          data: {
            accountId: createdAccount.id,
            weekNumber: item.weekNumber,
            dueDate: item.dueDate,
            scheduledAmount: new Prisma.Decimal(item.scheduledAmount),
            paidAmount: new Prisma.Decimal(0),
            status: item.status
          }
        });
      }

      return createdAccount;
    });

    await logAudit({
      userId: req.user.id,
      action: 'CREATE_FINANCE_ACCOUNT',
      entity: 'FinanceAccount',
      entityId: newAccount.id,
      details: {
        accountNumber,
        customerName: customer.name,
        agreedRepayment: terms.agreedRepayment,
        actualDisbursed: terms.actualDisbursed,
        grossDifference: terms.grossDifference,
        totalWeeks: terms.totalWeeks
      },
      req
    });

    const populated = await prisma.financeAccount.findUnique({
      where: { id: newAccount.id },
      include: {
        customer: true,
        instalments: { orderBy: { weekNumber: 'asc' } }
      }
    });

    res.status(201).json({
      success: true,
      message: 'Finance account created successfully with repayment schedule.',
      account: populated
    });
  } catch (error) {
    next(error);
  }
};

exports.getAccountLedger = async (req, res, next) => {
  try {
    const { id } = req.params;

    const account = await prisma.financeAccount.findFirst({
      where: {
        id,
        ...(req.user.role === 'COLLECTION_STAFF' ? { customer: { assignedCollectorId: req.user.id } } : {})
      },
      include: {
        customer: true,
        instalments: {
          orderBy: { weekNumber: 'asc' },
          include: {
            allocations: {
              where: { payment: { status: 'COMPLETED' } },
              include: {
                payment: {
                  select: { receiptNumber: true, paymentDate: true, paymentMethod: true, status: true }
                }
              }
            }
          }
        }
      }
    });

    if (!account) {
      return res.status(404).json({ success: false, message: 'Finance account not found.' });
    }

    const totalAgreed = Number(account.agreedRepayment);
    let runningPaid = 0;
    const now = new Date();
    const overdueCutoff = new Date(now.getTime() - (await getOverdueGraceDays()) * 86400000);

    const ledgerRows = account.instalments.map(inst => {
      const scheduled = Number(inst.scheduledAmount);
      const paid = Number(inst.paidAmount);
      runningPaid += paid;
      const outstandingBalance = Math.max(0, totalAgreed - runningPaid);
      const isPastDue = new Date(inst.dueDate) < overdueCutoff;
      const arrears = (isPastDue && paid < scheduled) ? (scheduled - paid) : 0;

      let status = inst.status;
      if (paid >= scheduled) {
        status = 'PAID';
      } else if (paid > 0) {
        status = 'PARTIAL';
      } else if (isPastDue) {
        status = 'OVERDUE';
      } else {
        status = 'UPCOMING';
      }

      return {
        id: inst.id,
        weekNumber: inst.weekNumber,
        dueDate: inst.dueDate,
        scheduledAmount: scheduled,
        paidAmount: paid,
        arrears,
        outstandingBalance,
        status,
        paidAt: inst.paidAt,
        allocations: inst.allocations
      };
    });

    res.json({
      success: true,
      account: {
        id: account.id,
        accountNumber: account.accountNumber,
        customerName: account.customer.name,
        customerCode: account.customer.customerCode,
        agreedRepayment: totalAgreed,
        actualDisbursed: Number(account.actualDisbursed),
        grossDifference: Number(account.grossDifference),
        totalWeeks: account.totalWeeks,
        status: account.status
      },
      ledger: ledgerRows
    });
  } catch (error) {
    next(error);
  }
};

exports.addAdjustment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { type, amount, reason, instalmentId } = req.body;

    const account = await prisma.financeAccount.findUnique({ where: { id } });
    if (!account) {
      return res.status(404).json({ success: false, message: 'Finance account not found.' });
    }

    const adj = await prisma.adjustment.create({
      data: {
        accountId: id,
        instalmentId: instalmentId || null,
        type,
        amount: new Prisma.Decimal(amount),
        reason,
        createdById: req.user.id
      }
    });

    await logAudit({
      userId: req.user.id,
      action: 'RECORD_ADJUSTMENT',
      entity: 'Adjustment',
      entityId: adj.id,
      details: { accountId: id, type, amount, reason },
      req
    });

    res.status(201).json({
      success: true,
      message: 'Adjustment recorded successfully.',
      adjustment: adj
    });
  } catch (error) {
    next(error);
  }
};
