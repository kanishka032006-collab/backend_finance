const prisma = require('./prisma');

const logAudit = async ({ userId, action, entity, entityId, details, req }) => {
  try {
    let ipAddress = null;
    if (req) {
      ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip;
    }

    await prisma.auditLog.create({
      data: {
        userId: userId || null,
        action,
        entity,
        entityId: entityId ? String(entityId) : null,
        details: typeof details === 'object' ? JSON.stringify(details) : details,
        ipAddress: ipAddress ? String(ipAddress) : null
      }
    });
  } catch (error) {
    console.error('Failed to write audit log:', error.message);
  }
};

module.exports = { logAudit };
