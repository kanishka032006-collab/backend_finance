const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { logAudit } = require('../utils/auditLogger');

exports.listUsers = async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            paymentsCollected: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, users });
  } catch (error) {
    next(error);
  }
};

exports.createUser = async (req, res, next) => {
  try {
    const { name, email, password, role = 'COLLECTION_STAFF', phone } = req.body;

    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() }
    });

    if (existing) {
      return res.status(400).json({ success: false, message: 'User with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        role,
        phone,
        active: true
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        active: true,
        createdAt: true
      }
    });

    await logAudit({
      userId: req.user.id,
      action: 'CREATE_USER',
      entity: 'User',
      entityId: user.id,
      details: { email: user.email, role: user.role, name: user.name },
      req
    });

    res.status(201).json({
      success: true,
      message: 'Staff user created successfully.',
      user
    });
  } catch (error) {
    next(error);
  }
};

exports.updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, role, phone, active, password } = req.body;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Prevent deactivating own account
    if (req.user.id === id && active === false) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own administrative account.' });
    }

    const dataToUpdate = {
      ...(name && { name }),
      ...(role && { role }),
      ...(phone !== undefined && { phone }),
      ...(active !== undefined && { active })
    };

    if (password && password.trim().length >= 6) {
      const salt = await bcrypt.genSalt(10);
      dataToUpdate.password = await bcrypt.hash(password, salt);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: dataToUpdate,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        active: true,
        updatedAt: true
      }
    });

    await logAudit({
      userId: req.user.id,
      action: 'UPDATE_USER',
      entity: 'User',
      entityId: id,
      details: { updatedFields: Object.keys(dataToUpdate) },
      req
    });

    res.json({
      success: true,
      message: 'User details updated successfully.',
      user: updated
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (req.user.id === id) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { active: false },
      select: { id: true, name: true, email: true, active: true }
    });

    await logAudit({
      userId: req.user.id,
      action: 'DEACTIVATE_USER',
      entity: 'User',
      entityId: id,
      details: { email: updated.email },
      req
    });

    res.json({
      success: true,
      message: 'User account deactivated.',
      user: updated
    });
  } catch (error) {
    next(error);
  }
};
