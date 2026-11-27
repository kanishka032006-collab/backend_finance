const prisma = require('../utils/prisma');

// ─── AREAS ───────────────────────────────────────────────────────────────────

exports.getAreas = async (req, res, next) => {
  try {
    const areas = await prisma.area.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { routes: true } } },
    });
    res.json({ success: true, data: areas });
  } catch (err) {
    next(err);
  }
};

exports.createArea = async (req, res, next) => {
  try {
    const { name, code } = req.body;
    if (!name || !code) return res.status(400).json({ success: false, message: 'name and code are required.' });
    const area = await prisma.area.create({ data: { name, code: code.toUpperCase() } });
    res.status(201).json({ success: true, data: area });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, message: 'Area code already exists.' });
    next(err);
  }
};

exports.deleteArea = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.area.delete({ where: { id } });
    res.json({ success: true, message: 'Area deleted.' });
  } catch (err) {
    next(err);
  }
};

// ─── ROUTES ──────────────────────────────────────────────────────────────────

exports.getRoutes = async (req, res, next) => {
  try {
    const routes = await prisma.route.findMany({
      orderBy: { name: 'asc' },
      include: {
        area: true,
        collector: { select: { id: true, name: true, email: true } },
        _count: { select: { customers: true } },
      },
    });
    res.json({ success: true, data: routes });
  } catch (err) {
    next(err);
  }
};

exports.createRoute = async (req, res, next) => {
  try {
    const { name, code, areaId, collectorId } = req.body;
    if (!name || !code || !areaId) return res.status(400).json({ success: false, message: 'name, code, and areaId are required.' });
    const route = await prisma.route.create({
      data: { name, code: code.toUpperCase(), areaId, collectorId: collectorId || null },
      include: { area: true, collector: { select: { id: true, name: true } } },
    });
    res.status(201).json({ success: true, data: route });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ success: false, message: 'Route code already exists.' });
    next(err);
  }
};

exports.updateRoute = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, code, areaId, collectorId } = req.body;
    const route = await prisma.route.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(code && { code: code.toUpperCase() }),
        ...(areaId && { areaId }),
        collectorId: collectorId !== undefined ? (collectorId || null) : undefined,
      },
      include: { area: true, collector: { select: { id: true, name: true } } },
    });
    res.json({ success: true, data: route });
  } catch (err) {
    next(err);
  }
};

exports.deleteRoute = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.route.delete({ where: { id } });
    res.json({ success: true, message: 'Route deleted.' });
  } catch (err) {
    next(err);
  }
};

// ─── CUSTOMER ASSIGNMENT ─────────────────────────────────────────────────────

exports.assignCustomerToRoute = async (req, res, next) => {
  try {
    const { id: routeId } = req.params;
    const { customerId, sortOrder } = req.body;
    if (!customerId) return res.status(400).json({ success: false, message: 'customerId is required.' });
    const cr = await prisma.customerRoute.upsert({
      where: { customerId_routeId: { customerId, routeId } },
      create: { customerId, routeId, sortOrder: sortOrder || 0 },
      update: { sortOrder: sortOrder || 0 },
      include: { customer: { select: { id: true, name: true, mobile: true } }, route: { select: { id: true, name: true } } },
    });
    res.status(201).json({ success: true, data: cr });
  } catch (err) {
    next(err);
  }
};

exports.removeCustomerFromRoute = async (req, res, next) => {
  try {
    const { id: routeId, customerId } = req.params;
    await prisma.customerRoute.delete({
      where: { customerId_routeId: { customerId, routeId } },
    });
    res.json({ success: true, message: 'Customer removed from route.' });
  } catch (err) {
    next(err);
  }
};

exports.getRouteSchedule = async (req, res, next) => {
  try {
    const { id: routeId } = req.params;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const route = await prisma.route.findUnique({
      where: { id: routeId },
      include: {
        area: true,
        customers: {
          orderBy: { sortOrder: 'asc' },
          include: {
            customer: {
              include: {
                accounts: {
                  where: { status: 'ACTIVE' },
                  include: {
                    instalments: {
                      where: {
                        status: { in: ['DUE', 'OVERDUE', 'PARTIAL'] },
                        dueDate: { lte: tomorrow },
                      },
                      orderBy: { weekNumber: 'asc' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!route) return res.status(404).json({ success: false, message: 'Route not found.' });
    res.json({ success: true, data: route });
  } catch (err) {
    next(err);
  }
};
