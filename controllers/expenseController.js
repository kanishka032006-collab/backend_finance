const prisma = require('../utils/prisma');

exports.getExpenses = async (req, res, next) => {
  try {
    const { category, startDate, endDate, page = 1, limit = 50 } = req.query;
    const where = {};
    if (category) where.category = category;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    }

    const [expenses, total] = await Promise.all([
      prisma.expense.findMany({
        where,
        orderBy: { date: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        include: { createdBy: { select: { id: true, name: true } } },
      }),
      prisma.expense.count({ where }),
    ]);

    res.json({ success: true, data: expenses, total, page: Number(page) });
  } catch (err) {
    next(err);
  }
};

exports.createExpense = async (req, res, next) => {
  try {
    const { category, amount, date, method, description } = req.body;
    if (!category || !amount || !date) {
      return res.status(400).json({ success: false, message: 'category, amount, and date are required.' });
    }
    const expense = await prisma.expense.create({
      data: {
        category,
        amount: parseFloat(amount),
        date: new Date(date),
        method: method || 'CASH',
        description: description || null,
        createdById: req.user.id,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    res.status(201).json({ success: true, data: expense });
  } catch (err) {
    next(err);
  }
};

exports.deleteExpense = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.expense.delete({ where: { id } });
    res.json({ success: true, message: 'Expense deleted.' });
  } catch (err) {
    next(err);
  }
};

exports.getExpenseSummary = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const where = {};
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.date.lte = end;
      }
    }

    const expenses = await prisma.expense.findMany({
      where,
      select: { category: true, amount: true },
    });

    const totalAmount = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const byCategory = {};
    expenses.forEach((e) => {
      byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount);
    });

    res.json({
      success: true,
      data: {
        totalAmount,
        byCategory: Object.entries(byCategory).map(([category, amount]) => ({ category, amount })),
        count: expenses.length,
      },
    });
  } catch (err) {
    next(err);
  }
};
