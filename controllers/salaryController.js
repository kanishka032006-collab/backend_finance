const prisma = require('../utils/prisma');

exports.getSalaries = async (req, res, next) => {
  try {
    const { userId, year, month } = req.query;
    const where = {};
    if (userId) where.userId = userId;
    if (year) where.year = Number(year);
    if (month) where.month = Number(month);

    const [salaries, total] = await Promise.all([
      prisma.staffSalary.findMany({
        where,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
      }),
      prisma.staffSalary.count({ where }),
    ]);
    res.json({ success: true, data: salaries, total });
  } catch (err) {
    next(err);
  }
};

exports.createSalary = async (req, res, next) => {
  try {
    const { userId, amount, month, year, paidAt, notes } = req.body;
    if (!userId || !amount || !month || !year) {
      return res.status(400).json({ success: false, message: 'userId, amount, month, and year are required.' });
    }
    const salary = await prisma.staffSalary.create({
      data: {
        userId,
        amount: parseFloat(amount),
        month: Number(month),
        year: Number(year),
        paidAt: paidAt ? new Date(paidAt) : new Date(),
        notes: notes || null,
      },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    res.status(201).json({ success: true, data: salary });
  } catch (err) {
    next(err);
  }
};

exports.deleteSalary = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.staffSalary.delete({ where: { id } });
    res.json({ success: true, message: 'Salary record deleted.' });
  } catch (err) {
    next(err);
  }
};

exports.getSalarySummary = async (req, res, next) => {
  try {
    const { year } = req.query;
    const where = year ? { year: Number(year) } : {};
    const salaries = await prisma.staffSalary.findMany({
      where,
      select: { amount: true, month: true, year: true, userId: true },
    });
    const totalPaid = salaries.reduce((sum, s) => sum + Number(s.amount), 0);
    res.json({ success: true, data: { totalPaid, count: salaries.length } });
  } catch (err) {
    next(err);
  }
};
