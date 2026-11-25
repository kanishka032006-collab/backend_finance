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
