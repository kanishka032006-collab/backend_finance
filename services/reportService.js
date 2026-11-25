const prisma = require('../utils/prisma');
const { getOverdueGraceDays } = require('../utils/systemSettings');

class ReportService {
  /**
   * Daily Collections Report
   */
  async getDailyCollections({ startDate, endDate }) {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    end.setHours(23, 59, 59, 999);

    const payments = await prisma.payment.findMany({
      where: {
        paymentDate: { gte: start, lte: end },
        status: 'COMPLETED'
      },
      include: {
        customer: { select: { name: true, customerCode: true } },
        account: { select: { accountNumber: true } },
        collector: { select: { name: true, email: true } }
      },
      orderBy: { paymentDate: 'desc' }
    });

    const summary = payments.reduce((acc, p) => {
      const dateKey = p.paymentDate.toISOString().split('T')[0];
      if (!acc[dateKey]) {
        acc[dateKey] = { date: dateKey, totalAmount: 0, count: 0 };
      }
      acc[dateKey].totalAmount += Number(p.amount);
      acc[dateKey].count += 1;
      return acc;
    }, {});

    return {
      records: payments,
      dailySummary: Object.values(summary).sort((a, b) => b.date.localeCompare(a.date)),
      totalCollected: payments.reduce((sum, p) => sum + Number(p.amount), 0),
      totalTransactions: payments.length
    };
  }

  /**
   * Weekly Collections Report
   */
  async getWeeklyCollections() {
    const payments = await prisma.payment.findMany({
      where: { status: 'COMPLETED' },
      include: {
        account: true,
        customer: true,
        collector: true
      },
      orderBy: { paymentDate: 'desc' }
    });

    // Group payments by Week (YYYY-WW)
    const weeklyMap = {};
    for (const p of payments) {
      const d = new Date(p.paymentDate);
      // ISO week
      const oneJan = new Date(d.getFullYear(), 0, 1);
      const numberOfDays = Math.floor((d - oneJan) / (24 * 60 * 60 * 1000));
      const weekNumber = Math.ceil((d.getDay() + 1 + numberOfDays) / 7);
      const weekKey = `${d.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;

      if (!weeklyMap[weekKey]) {
        weeklyMap[weekKey] = {
          week: weekKey,
          totalAmount: 0,
          count: 0
        };
      }
      weeklyMap[weekKey].totalAmount += Number(p.amount);
      weeklyMap[weekKey].count += 1;
    }

    return {
      weeklySummary: Object.values(weeklyMap).sort((a, b) => b.week.localeCompare(a.week)),
      totalCollected: payments.reduce((sum, p) => sum + Number(p.amount), 0)
    };
  }

  /**
   * Monthly Collections Report
   */
  async getMonthlyCollections() {
    const payments = await prisma.payment.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { paymentDate: 'asc' }
    });

    const monthlyMap = {};
    for (const p of payments) {
      const d = new Date(p.paymentDate);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[monthKey]) {
        monthlyMap[monthKey] = {
          month: monthKey,
          totalAmount: 0,
          count: 0
        };
      }
      monthlyMap[monthKey].totalAmount += Number(p.amount);
      monthlyMap[monthKey].count += 1;
    }

    return Object.values(monthlyMap);
  }

  /**
   * Customer-wise Collections Report
   */
  async getCustomerCollections() {
    const customers = await prisma.customer.findMany({
      include: {
        accounts: {
          include: {
            instalments: true
          }
        },
        payments: {
          where: { status: 'COMPLETED' }
        }
      }
    });

    return customers.map(c => {
      const totalAgreed = c.accounts.reduce((s, a) => s + Number(a.agreedRepayment), 0);
      const totalDisbursed = c.accounts.reduce((s, a) => s + Number(a.actualDisbursed), 0);
      const totalCollected = c.payments.reduce((s, p) => s + Number(p.amount), 0);
      const outstanding = Math.max(0, totalAgreed - totalCollected);

      return {
        customerId: c.id,
        customerCode: c.customerCode,
        name: c.name,
        mobile: c.mobile,
        kycStatus: c.kycStatus,
        totalAccounts: c.accounts.length,
        totalDisbursed,
        totalAgreed,
        totalCollected,
        outstanding
      };
    });
  }

  /**
   * Collector-wise Collections Report
   */
  async getCollectorCollections() {
    const collectors = await prisma.user.findMany({
      where: { role: { in: ['COLLECTION_STAFF', 'ADMINISTRATOR'] } },
      include: {
        paymentsCollected: {
          where: { status: 'COMPLETED' }
        }
      }
    });

    return collectors.map(u => {
      const totalCollected = u.paymentsCollected.reduce((s, p) => s + Number(p.amount), 0);
      return {
        userId: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        transactionsCount: u.paymentsCollected.length,
        totalCollected
      };
    });
  }

  /**
   * Outstanding Accounts Report
   */
  async getOutstandingAccounts() {
    const graceDays = await getOverdueGraceDays();
    const overdueCutoff = new Date(Date.now() - graceDays * 86400000);
    const accounts = await prisma.financeAccount.findMany({
      where: { status: { in: ['ACTIVE', 'DEFAULTED'] } },
      include: {
        customer: true,
        instalments: true,
        payments: { where: { status: 'COMPLETED' } }
      }
    });

    return accounts.map(acc => {
      const totalAgreed = Number(acc.agreedRepayment);
      const totalDisbursed = Number(acc.actualDisbursed);
      const totalPaid = acc.payments.reduce((s, p) => s + Number(p.amount), 0);
      const outstanding = Math.max(0, totalAgreed - totalPaid);

      const overdueInstalments = acc.instalments.filter(
        i => new Date(i.dueDate) < overdueCutoff && Number(i.paidAmount) < Number(i.scheduledAmount)
      );
      const overdueAmount = overdueInstalments.reduce(
        (s, i) => s + (Number(i.scheduledAmount) - Number(i.paidAmount)),
        0
      );

      return {
        accountId: acc.id,
        accountNumber: acc.accountNumber,
        customerId: acc.customerId,
        customerName: acc.customer.name,
        customerCode: acc.customer.customerCode,
        mobile: acc.customer.mobile,
        agreedRepayment: totalAgreed,
        actualDisbursed: totalDisbursed,
        totalPaid,
        outstanding,
        overdueAmount,
        status: acc.status,
        firstDueDate: acc.firstDueDate
      };
    });
  }

  /**
   * Overdue Accounts Report
   */
  async getOverdueAccounts() {
    const allOutstanding = await this.getOutstandingAccounts();
    return allOutstanding.filter(acc => acc.overdueAmount > 0);
  }

  /**
   * Disbursement Register
   */
  async getDisbursementRegister() {
    const accounts = await prisma.financeAccount.findMany({
      include: {
        customer: true
      },
      orderBy: { createdAt: 'desc' }
    });

    return accounts.map(acc => ({
      accountId: acc.id,
      accountNumber: acc.accountNumber,
      customerName: acc.customer.name,
      customerCode: acc.customer.customerCode,
      mobile: acc.customer.mobile,
      disbursedAmount: Number(acc.actualDisbursed),
      agreedRepayment: Number(acc.agreedRepayment),
      grossDifference: Number(acc.grossDifference),
      weeklyInstalment: Number(acc.weeklyInstalment),
      totalWeeks: acc.totalWeeks,
      firstDueDate: acc.firstDueDate,
      dueDay: acc.dueDay,
      status: acc.status,
      disbursedDate: acc.createdAt
    }));
  }

  /**
   * Completed Accounts Report
   */
  async getCompletedAccounts() {
    const accounts = await prisma.financeAccount.findMany({
      where: { status: 'COMPLETED' },
      include: {
        customer: true,
        payments: { where: { status: 'COMPLETED' } }
      },
      orderBy: { updatedAt: 'desc' }
    });

    return accounts.map(acc => {
      const totalPaid = acc.payments.reduce((s, p) => s + Number(p.amount), 0);
      return {
        accountId: acc.id,
        accountNumber: acc.accountNumber,
        customerName: acc.customer.name,
        customerCode: acc.customer.customerCode,
        mobile: acc.customer.mobile,
        agreedRepayment: Number(acc.agreedRepayment),
        totalDisbursed: Number(acc.actualDisbursed),
        grossDifference: Number(acc.grossDifference),
        totalPaid,
        completedDate: acc.updatedAt
      };
    });
  }
}

module.exports = new ReportService();
