const reportService = require('../services/reportService');
const prisma = require('../utils/prisma');

exports.getDailyReport = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await reportService.getDailyCollections({ startDate, endDate });
    res.json({ success: true, ...data });
  } catch (error) {
    next(error);
  }
};

exports.getWeeklyReport = async (req, res, next) => {
  try {
    const data = await reportService.getWeeklyCollections();
    res.json({ success: true, ...data });
  } catch (error) {
    next(error);
  }
};

exports.getMonthlyReport = async (req, res, next) => {
  try {
    const data = await reportService.getMonthlyCollections();
    res.json({ success: true, monthly: data });
  } catch (error) {
    next(error);
  }
};

exports.getCustomerReport = async (req, res, next) => {
  try {
    const data = await reportService.getCustomerCollections();
    res.json({ success: true, customers: data });
  } catch (error) {
    next(error);
  }
};

exports.getCollectorReport = async (req, res, next) => {
  try {
    const data = await reportService.getCollectorCollections();
    res.json({ success: true, collectors: data });
  } catch (error) {
    next(error);
  }
};

exports.getOutstandingReport = async (req, res, next) => {
  try {
    const data = await reportService.getOutstandingAccounts();
    res.json({ success: true, accounts: data });
  } catch (error) {
    next(error);
  }
};

exports.getOverdueReport = async (req, res, next) => {
  try {
    const data = await reportService.getOverdueAccounts();
    res.json({ success: true, overdue: data });
  } catch (error) {
    next(error);
  }
};

exports.getDisbursementReport = async (req, res, next) => {
  try {
    const data = await reportService.getDisbursementRegister();
    res.json({ success: true, disbursements: data });
  } catch (error) {
    next(error);
  }
};

exports.getCompletedReport = async (req, res, next) => {
  try {
    const data = await reportService.getCompletedAccounts();
    res.json({ success: true, completed: data });
  } catch (error) {
    next(error);
  }
};

exports.exportReportCSV = async (req, res, next) => {
  try {
    const { type } = req.query;
    let filename = `report_${type || 'export'}_${Date.now()}.csv`;
    let rows = [];

    switch (type) {
      case 'daily': {
        const d = await reportService.getDailyCollections(req.query);
        rows = d.records.map(r => ({
          'Receipt Number': r.receiptNumber,
          'Date': new Date(r.paymentDate).toLocaleDateString(),
          'Customer Code': r.customer?.customerCode,
          'Customer Name': r.customer?.name,
          'Account Number': r.account?.accountNumber,
          'Collector': r.collector?.name,
          'Payment Method': r.paymentMethod,
          'Reference': r.reference || '',
          'Amount (INR)': Number(r.amount)
        }));
        break;
      }
      case 'customer': {
        const custs = await prisma.customer.findMany({ orderBy: { customerCode: 'asc' } });
        rows = custs.map(c => ({
          'Customer Code': c.customerCode,
          'Customer Name': c.name,
          'Mobile': c.mobile,
          'Address': c.address,
          'KYC Status': c.kycStatus,
          'Start Date': c.startDate,
          'Active': c.active,
          'Created At': c.createdAt
        }));
        break;
      }
      case 'collector': {
        const cols = await reportService.getCollectorCollections();
        rows = cols.map(c => ({
          'Collector Name': c.name,
          'Email': c.email,
          'Role': c.role,
          'Total Transactions': c.transactionsCount,
          'Total Collected (INR)': c.totalCollected
        }));
        break;
      }
      case 'overdue': {
        const overdue = await reportService.getOverdueAccounts();
        rows = overdue.map(o => ({
          'Account Number': o.accountNumber,
          'Customer Code': o.customerCode,
          'Customer Name': o.customerName,
          'Mobile': o.mobile,
          'Total Agreed': o.agreedRepayment,
          'Total Paid': o.totalPaid,
          'Outstanding Balance': o.outstanding,
          'Overdue Amount': o.overdueAmount,
          'Status': o.status
        }));
        break;
      }
      case 'disbursement': {
        const disb = await reportService.getDisbursementRegister();
        rows = disb.map(d => ({
          'Account Number': d.accountNumber,
          'Customer Code': d.customerCode,
          'Customer Name': d.customerName,
          'Mobile': d.mobile,
          'Disbursed Amount (INR)': d.disbursedAmount,
          'Agreed Repayment (INR)': d.agreedRepayment,
          'Gross Difference (INR)': d.grossDifference,
          'Weekly Instalment (INR)': d.weeklyInstalment,
          'Total Weeks': d.totalWeeks,
          'Due Day': d.dueDay,
          'Status': d.status,
          'Date': new Date(d.disbursedDate).toLocaleDateString()
        }));
        break;
      }
      case 'completed': {
        const comp = await reportService.getCompletedAccounts();
        rows = comp.map(c => ({
          'Account Number': c.accountNumber,
          'Customer Code': c.customerCode,
          'Customer Name': c.customerName,
          'Total Disbursed': c.totalDisbursed,
          'Total Agreed Repayment': c.agreedRepayment,
          'Total Paid': c.totalPaid,
          'Gross Difference': c.grossDifference,
          'Completed Date': new Date(c.completedDate).toLocaleDateString()
        }));
        break;
      }
      default:
        return res.status(400).json({ success: false, message: 'Invalid report type requested.' });
    }

    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No records found to export.' });
    }

    // Convert array of objects to CSV string
    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map(row => headers.map(h => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csvContent);
  } catch (error) {
    next(error);
  }
};

exports.getCashFlowReport = async (req, res, next) => {
  try {
    const { days = 14 } = req.query;
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (Number(days) - 1));
    startDate.setHours(0, 0, 0, 0);

    const [payments, expenses, investments, salaries] = await Promise.all([
      prisma.payment.findMany({
        where: { status: 'COMPLETED', paymentDate: { gte: startDate, lte: endDate } },
        select: { amount: true, paymentDate: true, paymentMethod: true }
      }),
      prisma.expense.findMany({
        where: { date: { gte: startDate, lte: endDate } },
        select: { amount: true, date: true, method: true }
      }),
      prisma.investment.findMany({
        select: { amount: true }
      }),
      prisma.staffSalary.findMany({
        select: { amount: true }
      })
    ]);

    const dailyMap = {};
    for (let i = 0; i < Number(days); i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const key = d.toISOString().split('T')[0];
      dailyMap[key] = { date: key, collections: 0, expenses: 0, net: 0 };
    }

    let cashIn = 0;
    let onlineIn = 0;
    payments.forEach((p) => {
      const key = new Date(p.paymentDate).toISOString().split('T')[0];
      const amt = Number(p.amount);
      if (dailyMap[key]) dailyMap[key].collections += amt;
      if (p.paymentMethod === 'CASH') cashIn += amt;
      else onlineIn += amt;
    });

    let cashOut = 0;
    let onlineOut = 0;
    expenses.forEach((e) => {
      const key = new Date(e.date).toISOString().split('T')[0];
      const amt = Number(e.amount);
      if (dailyMap[key]) dailyMap[key].expenses += amt;
      if (e.method === 'CASH') cashOut += amt;
      else onlineOut += amt;
    });

    const series = Object.values(dailyMap).map((row) => ({
      ...row,
      net: row.collections - row.expenses
    }));

    const totalCollections = payments.reduce((s, p) => s + Number(p.amount), 0);
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const totalInvestments = investments.reduce((s, i) => s + Number(i.amount), 0);
    const totalSalaries = salaries.reduce((s, x) => s + Number(x.amount), 0);

    res.json({
      success: true,
      data: {
        series,
        summary: {
          totalCollections,
          totalExpenses,
          netCashMovement: totalCollections - totalExpenses,
          cashBalance: cashIn - cashOut,
          onlineBalance: onlineIn - onlineOut,
          totalInvestments,
          totalSalaries
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.getProfitAndLossReport = async (req, res, next) => {
  try {
    const [accounts, payments, expenses, salaries] = await Promise.all([
      prisma.financeAccount.findMany({ select: { agreedRepayment: true, actualDisbursed: true, grossDifference: true } }),
      prisma.payment.findMany({ where: { status: 'COMPLETED' }, select: { amount: true } }),
      prisma.expense.findMany({ select: { amount: true } }),
      prisma.staffSalary.findMany({ select: { amount: true } })
    ]);

    const totalDisbursed = accounts.reduce((s, a) => s + Number(a.actualDisbursed), 0);
    const totalAgreed = accounts.reduce((s, a) => s + Number(a.agreedRepayment), 0);
    const expectedGrossProfit = accounts.reduce((s, a) => s + Number(a.grossDifference), 0);
    const totalCollected = payments.reduce((s, p) => s + Number(p.amount), 0);
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const totalSalaries = salaries.reduce((s, x) => s + Number(x.amount), 0);
    const realizedGrossProfit = totalAgreed > 0 ? (expectedGrossProfit * (totalCollected / totalAgreed)) : 0;
    const netProfit = realizedGrossProfit - totalExpenses - totalSalaries;

    res.json({
      success: true,
      data: {
        totalDisbursed,
        totalAgreed,
        expectedGrossProfit,
        totalCollected,
        realizedGrossProfit: Math.round(realizedGrossProfit * 100) / 100,
        totalExpenses,
        totalSalaries,
        netProfit: Math.round(netProfit * 100) / 100
      }
    });
  } catch (error) {
    next(error);
  }
};
