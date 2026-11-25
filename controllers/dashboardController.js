const prisma = require('../utils/prisma');
const { getOverdueGraceDays } = require('../utils/systemSettings');

exports.getDashboardData = async (req, res, next) => {
  try {
    const now = new Date();
    const overdueCutoff = new Date(now.getTime() - (await getOverdueGraceDays()) * 86400000);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const userId = req.user?.id;
    const isCollector = req.user?.role === 'COLLECTION_STAFF';
    const permittedPaymentsFilter = isCollector ? { customer: { assignedCollectorId: userId } } : {};

    // Run parallel aggregates
    const [
      totalCustomers,
      accounts,
      completedPayments,
      todayDueInstalments,
      recentPayments,
      allInstalments,
      collectorPayments,
      collectorLifetimeTotals,
      collectorTodayTotals,
      recentReversals,
      recentAuditLogs
    ] = await Promise.all([
      // 1. Total Customers
      prisma.customer.count({ where: { active: true, ...(isCollector ? { assignedCollectorId: userId } : {}) } }),

      // 2. All accounts with customer
      prisma.financeAccount.findMany({
        where: isCollector ? { customer: { assignedCollectorId: userId } } : {},
        include: {
          customer: { select: { id: true, name: true, customerCode: true, mobile: true, address: true } }
        }
      }),

      // 3. Completed Payments
      prisma.payment.findMany({
        where: { status: 'COMPLETED', ...permittedPaymentsFilter },
        select: {
          id: true,
          amount: true,
          paymentDate: true,
          collectorId: true
        }
      }),

      // 4. Today's Due Collections
      prisma.instalment.findMany({
        where: {
          dueDate: { gte: todayStart, lte: todayEnd },
          status: { in: ['UPCOMING', 'DUE', 'PARTIAL'] },
          ...(isCollector ? { account: { customer: { assignedCollectorId: userId } } } : {})
        },
        include: {
          account: {
            include: {
              customer: { select: { id: true, name: true, customerCode: true, mobile: true, address: true } }
            }
          }
        }
      }),

      // 5. Recent Transactions
      prisma.payment.findMany({
        where: isCollector ? { collectorId: userId } : {},
        take: 10,
        orderBy: { paymentDate: 'desc' },
        include: {
          customer: { select: { id: true, name: true, customerCode: true, mobile: true } },
          account: { select: { id: true, accountNumber: true } },
          collector: { select: { id: true, name: true } }
        }
      }),

      // 6. Instalments for Overdue & Chart calculations
      prisma.instalment.findMany({
        where: {
          dueDate: { lt: overdueCutoff },
          status: { in: ['UPCOMING', 'DUE', 'PARTIAL', 'OVERDUE'] },
          ...(isCollector ? { account: { customer: { assignedCollectorId: userId } } } : {})
        },
        include: {
          account: {
            include: {
              customer: { select: { id: true, name: true, customerCode: true, mobile: true } }
            }
          }
        }
      }),

      // 7. Collector specific transactions
      prisma.payment.findMany({
        where: {
          collectorId: userId,
          status: 'COMPLETED'
        },
        orderBy: { paymentDate: 'desc' },
        take: 8,
        include: {
          customer: { select: { name: true, customerCode: true } },
          account: { select: { accountNumber: true } }
        }
      }),

      prisma.payment.aggregate({
        where: { collectorId: userId, status: 'COMPLETED' },
        _sum: { amount: true },
        _count: { _all: true }
      }),

      prisma.payment.aggregate({
        where: { collectorId: userId, status: 'COMPLETED', paymentDate: { gte: todayStart, lte: todayEnd } },
        _sum: { amount: true },
        _count: { _all: true }
      }),

      // 8. Recent Reversals for Auditor
      isCollector ? Promise.resolve([]) : prisma.payment.findMany({
        where: { status: 'REVERSED' },
        take: 10,
        orderBy: { reversedAt: 'desc' },
        include: {
          customer: { select: { name: true, customerCode: true } },
          account: { select: { accountNumber: true } },
          collector: { select: { name: true } },
          reversedBy: { select: { name: true } }
        }
      }),

      // 9. Recent Audit Logs for Auditor
      isCollector ? Promise.resolve([]) : prisma.auditLog.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { name: true, email: true, role: true } }
        }
      })
    ]);

    // Financial totals
    let totalDisbursed = 0;
    let totalScheduledRepayment = 0;
    let expectedGrossDiff = 0;

    for (const acc of accounts) {
      totalDisbursed += Number(acc.actualDisbursed);
      totalScheduledRepayment += Number(acc.agreedRepayment);
      expectedGrossDiff += Number(acc.grossDifference);
    }

    const totalCollectionsReceived = completedPayments.reduce((s, p) => s + Number(p.amount), 0);
    const totalOutstandingBalance = Math.max(0, totalScheduledRepayment - totalCollectionsReceived);

    // Overdue Calculation
    let totalOverdueAmount = 0;
    const overdueCustomerMap = {};

    for (const inst of allInstalments) {
      const sched = Number(inst.scheduledAmount);
      const paid = Number(inst.paidAmount);
      const overdue = Math.max(0, sched - paid);

      if (overdue > 0) {
        totalOverdueAmount += overdue;
        const routeKey = inst.account.id;
        if (!overdueCustomerMap[routeKey]) {
          overdueCustomerMap[routeKey] = {
            id: inst.account.customer.id,
            name: inst.account.customer.name,
            customerCode: inst.account.customer.customerCode,
            mobile: inst.account.customer.mobile,
            accountId: inst.account.id,
            accountNumber: inst.account.accountNumber,
            overdueAmount: 0,
            missedWeeks: 0,
            oldestDueDate: inst.dueDate
          };
        }
        overdueCustomerMap[routeKey].overdueAmount += overdue;
        overdueCustomerMap[routeKey].missedWeeks += 1;
        if (new Date(inst.dueDate) < new Date(overdueCustomerMap[routeKey].oldestDueDate)) {
          overdueCustomerMap[routeKey].oldestDueDate = inst.dueDate;
        }
      }
    }

    // Collected Gross Difference
    const collectedGrossDiff = totalScheduledRepayment > 0
      ? Math.round(((totalCollectionsReceived / totalScheduledRepayment) * expectedGrossDiff) * 100) / 100
      : 0;

    // Today's due collection sum & mapped list
    let todayDueAmount = 0;
    const todayDueList = todayDueInstalments.map((inst) => {
      const due = Number(inst.scheduledAmount) - Number(inst.paidAmount);
      todayDueAmount += due;
      return {
        instalmentId: inst.id,
        weekNumber: inst.weekNumber,
        dueDate: inst.dueDate,
        amountDue: due,
        scheduledAmount: Number(inst.scheduledAmount),
        paidAmount: Number(inst.paidAmount),
        status: inst.status,
        accountId: inst.account.id,
        accountNumber: inst.account.accountNumber,
        customerId: inst.account.customer.id,
        customerName: inst.account.customer.name,
        customerCode: inst.account.customer.customerCode,
        mobile: inst.account.customer.mobile,
        address: inst.account.customer.address
      };
    });

    // Weekly Collections Chart
    const weeklyBuckets = {};
    for (let i = 6; i >= 0; i--) {
      const label = `Week -${i === 0 ? 'Current' : i}`;
      weeklyBuckets[label] = { week: label, target: 0, collected: 0 };
    }

    // Monthly Collections Chart (Last 6 months)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyBuckets = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = `${monthNames[d.getMonth()]} ${d.getFullYear().toString().slice(2)}`;
      monthlyBuckets[key] = { month: key, collected: 0, scheduled: 0 };
    }

    // Fill monthly chart data from completed payments
    for (const p of completedPayments) {
      const d = new Date(p.paymentDate);
      const key = `${monthNames[d.getMonth()]} ${d.getFullYear().toString().slice(2)}`;
      if (monthlyBuckets[key]) {
        monthlyBuckets[key].collected += Number(p.amount);
      }
    }

    // Overdue customer list (top 10 sorted by overdueAmount desc)
    const overdueCustomers = Object.values(overdueCustomerMap)
      .sort((a, b) => b.overdueAmount - a.overdueAmount)
      .slice(0, 10);

    // Collector's Personal Summary
    const myTodayAmount = Number(collectorTodayTotals._sum.amount || 0);
    const myTodayCount = collectorTodayTotals._count._all;
    const myTotalAmount = Number(collectorLifetimeTotals._sum.amount || 0);

    // Auditor Compliance Metrics
    const recoveryRate = totalScheduledRepayment > 0 ? ((totalCollectionsReceived / totalScheduledRepayment) * 100).toFixed(1) : 0;
    const overdueRate = totalScheduledRepayment > 0 ? ((totalOverdueAmount / totalScheduledRepayment) * 100).toFixed(1) : 0;

    res.json({
      success: true,
      metrics: {
        totalCustomers,
        totalAmountDisbursed: totalDisbursed,
        totalScheduledRepayment,
        totalCollectionsReceived,
        totalOutstandingBalance,
        totalOverdueAmount,
        expectedGrossDifference: expectedGrossDiff,
        collectedGrossDifference: collectedGrossDiff,
        todayDueCollections: {
          count: todayDueInstalments.length,
          amount: todayDueAmount
        },
        recoveryRate: Number(recoveryRate),
        overdueRate: Number(overdueRate)
      },
      collectorStats: {
        myTodayAmount,
        myTodayCount,
        myTotalAmount,
        myTotalCount: collectorLifetimeTotals._count._all,
        recentCollections: collectorPayments
      },
      auditorStats: {
        recentReversals,
        recentAuditLogs
      },
      charts: {
        weekly: Object.values(weeklyBuckets),
        monthly: Object.values(monthlyBuckets)
      },
      recentTransactions: recentPayments,
      overdueCustomers,
      todayDueList
    });
  } catch (error) {
    next(error);
  }
};
