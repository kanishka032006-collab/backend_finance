const prisma = require('../utils/prisma');

exports.getInvestments = async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const [investments, total] = await Promise.all([
      prisma.investment.findMany({
        orderBy: { date: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        include: { createdBy: { select: { id: true, name: true } } },
      }),
      prisma.investment.count(),
    ]);
    res.json({ success: true, data: investments, total });
  } catch (err) {
    next(err);
  }
};

exports.createInvestment = async (req, res, next) => {
  try {
    const { investorName, amount, date, description } = req.body;
    if (!investorName || !amount || !date) {
      return res.status(400).json({ success: false, message: 'investorName, amount, and date are required.' });
    }
    const investment = await prisma.investment.create({
      data: {
        investorName,
        amount: parseFloat(amount),
        date: new Date(date),
        description: description || null,
        createdById: req.user.id,
      },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    res.status(201).json({ success: true, data: investment });
  } catch (err) {
    next(err);
  }
};

exports.deleteInvestment = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.investment.delete({ where: { id } });
    res.json({ success: true, message: 'Investment deleted.' });
  } catch (err) {
    next(err);
  }
};

exports.getInvestmentSummary = async (req, res, next) => {
  try {
    const investments = await prisma.investment.findMany({
      select: { amount: true },
    });
    const totalAmount = investments.reduce((sum, inv) => sum + Number(inv.amount), 0);
    res.json({
      success: true,
      data: { totalAmount, count: investments.length },
    });
  } catch (err) {
    next(err);
  }
};
