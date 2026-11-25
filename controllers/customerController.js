const prisma = require('../utils/prisma');
const { logAudit } = require('../utils/auditLogger');

exports.listCustomers = async (req, res, next) => {
  try {
    const { search, kycStatus, active, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { customerCode: { contains: search, mode: 'insensitive' } },
        { mobile: { contains: search, mode: 'insensitive' } }
      ];
    }
    if (kycStatus) {
      where.kycStatus = kycStatus;
    }
    if (active !== undefined) {
      where.active = active === 'true' || active === true;
    }
    if (req.user.role === 'COLLECTION_STAFF') where.assignedCollectorId = req.user.id;

    const [total, customers] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        skip,
        take,
        include: {
          assignedCollector: { select: { id: true, name: true } },
          accounts: {
            include: {
              instalments: true,
              payments: { where: { status: 'COMPLETED' } }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    const enriched = customers.map(c => {
      let totalAgreed = 0;
      let totalPaid = 0;
      let overdueAmount = 0;
      const now = new Date();

      for (const acc of c.accounts) {
        totalAgreed += Number(acc.agreedRepayment);
        for (const p of acc.payments) {
          totalPaid += Number(p.amount);
        }
        for (const inst of acc.instalments) {
          if (inst.status === 'OVERDUE' || (new Date(inst.dueDate) < now && Number(inst.paidAmount) < Number(inst.scheduledAmount))) {
            overdueAmount += (Number(inst.scheduledAmount) - Number(inst.paidAmount));
          }
        }
      }

      return {
        id: c.id,
        customerCode: c.customerCode,
        assignedCollectorId: c.assignedCollectorId,
        assignedCollector: c.assignedCollector,
        name: c.name,
        mobile: c.mobile,
        address: c.address,
        kycStatus: c.kycStatus,
        startDate: c.startDate,
        notes: c.notes,
        active: c.active,
        createdAt: c.createdAt,
        totalAccounts: c.accounts.length,
        totalAgreed,
        totalPaid,
        outstandingBalance: Math.max(0, totalAgreed - totalPaid),
        overdueAmount: Math.max(0, overdueAmount)
      };
    });

    res.json({
      success: true,
      customers: enriched,
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

exports.getCustomerById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const customer = await prisma.customer.findFirst({
      where: {
        id,
        ...(req.user.role === 'COLLECTION_STAFF' ? { assignedCollectorId: req.user.id } : {})
      },
      include: {
        assignedCollector: { select: { id: true, name: true } },
        accounts: {
          include: {
            instalments: {
              orderBy: { weekNumber: 'asc' }
            },
            payments: {
              where: { status: 'COMPLETED' },
              orderBy: { paymentDate: 'desc' },
              include: { collector: { select: { name: true } } }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        payments: {
          orderBy: { paymentDate: 'desc' },
          include: {
            account: { select: { accountNumber: true } },
            collector: { select: { name: true } }
          }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }

    let totalRepayment = 0;
    let totalDisbursed = 0;
    let totalCollected = 0;
    let overdueAmount = 0;
    let nextDueDate = null;
    const now = new Date();

    const upcomingDueDates = [];

    for (const acc of customer.accounts) {
      totalRepayment += Number(acc.agreedRepayment);
      totalDisbursed += Number(acc.actualDisbursed);

      for (const inst of acc.instalments) {
        const instDue = new Date(inst.dueDate);
        const sched = Number(inst.scheduledAmount);
        const paid = Number(inst.paidAmount);

        if (paid < sched) {
          if (instDue < now) {
            overdueAmount += (sched - paid);
          } else {
            upcomingDueDates.push(instDue);
          }
        }
      }
    }

    for (const p of customer.payments) {
      if (p.status === 'COMPLETED') {
        totalCollected += Number(p.amount);
      }
    }

    if (upcomingDueDates.length > 0) {
      upcomingDueDates.sort((a, b) => a - b);
      nextDueDate = upcomingDueDates[0];
    }

    const outstandingBalance = Math.max(0, totalRepayment - totalCollected);

    res.json({
      success: true,
      customer: {
        ...customer,
        summary: {
          totalRepayment,
          totalDisbursed,
          totalCollected,
          outstandingBalance,
          overdueAmount,
          nextDueDate
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.createCustomer = async (req, res, next) => {
  try {
    const { name, mobile, address, kycStatus = 'PENDING', startDate, notes } = req.body;
    const assignedCollectorId = req.user.role === 'COLLECTION_STAFF'
      ? req.user.id
      : req.body.assignedCollectorId || null;
    if (assignedCollectorId) {
      const collector = await prisma.user.findFirst({ where: { id: assignedCollectorId, role: 'COLLECTION_STAFF', active: true } });
      if (!collector) return res.status(400).json({ success: false, message: 'Select an active collection staff member.' });
    }

    // Generate unique customer code CUST-XXXX
    const lastCust = await prisma.customer.findFirst({
      orderBy: { createdAt: 'desc' }
    });

    let nextNum = 1;
    if (lastCust && lastCust.customerCode) {
      const parts = lastCust.customerCode.split('-');
      if (parts.length === 2) {
        const num = parseInt(parts[1], 10);
        if (!isNaN(num)) nextNum = num + 1;
      }
    }
    const customerCode = `CUST-${String(nextNum).padStart(4, '0')}`;

    const customer = await prisma.customer.create({
      data: {
        customerCode,
        name,
        mobile,
        address,
        kycStatus,
        startDate: startDate ? new Date(startDate) : new Date(),
        notes,
        assignedCollectorId
      }
    });

    await logAudit({
      userId: req.user.id,
      action: 'CREATE_CUSTOMER',
      entity: 'Customer',
      entityId: customer.id,
      details: { customerCode, name, mobile },
      req
    });

    res.status(201).json({
      success: true,
      message: 'Customer registered successfully.',
      customer
    });
  } catch (error) {
    next(error);
  }
};

exports.updateCustomer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, mobile, address, kycStatus, notes, active } = req.body;

    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }
    if (req.user.role === 'COLLECTION_STAFF' && existing.assignedCollectorId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only update borrowers assigned to you.' });
    }

    let assignedCollectorId;
    if (req.user.role === 'ADMINISTRATOR' && req.body.assignedCollectorId !== undefined) {
      assignedCollectorId = req.body.assignedCollectorId || null;
      if (assignedCollectorId) {
        const collector = await prisma.user.findFirst({ where: { id: assignedCollectorId, role: 'COLLECTION_STAFF', active: true } });
        if (!collector) return res.status(400).json({ success: false, message: 'Select an active collection staff member.' });
      }
    }

    const updated = await prisma.customer.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(mobile && { mobile }),
        ...(address && { address }),
        ...(kycStatus && { kycStatus }),
        ...(notes !== undefined && { notes }),
        ...(active !== undefined && { active }),
        ...(assignedCollectorId !== undefined && { assignedCollectorId })
      }
    });

    await logAudit({
      userId: req.user.id,
      action: 'UPDATE_CUSTOMER',
      entity: 'Customer',
      entityId: id,
      details: { before: existing, after: updated },
      req
    });

    res.json({
      success: true,
      message: 'Customer updated successfully.',
      customer: updated
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteCustomer = async (req, res, next) => {
  try {
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        accounts: {
          include: { instalments: true }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }
    if (req.user.role === 'COLLECTION_STAFF' && customer.assignedCollectorId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only deactivate borrowers assigned to you.' });
    }

    // Check restrictions
    const activeAccounts = customer.accounts.filter(a => a.status === 'ACTIVE' || a.status === 'DEFAULTED');
    if (activeAccounts.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete customer with active finance accounts. Deactivate the customer instead.'
      });
    }

    // Deactivate instead of hard delete to preserve historical integrity
    const deactivated = await prisma.customer.update({
      where: { id },
      data: { active: false }
    });

    await logAudit({
      userId: req.user.id,
      action: 'DEACTIVATE_CUSTOMER',
      entity: 'Customer',
      entityId: id,
      details: { customerCode: customer.customerCode, name: customer.name },
      req
    });

    res.json({
      success: true,
      message: 'Customer deactivated successfully to preserve financial history.',
      customer: deactivated
    });
  } catch (error) {
    next(error);
  }
};
