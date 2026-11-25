const prisma = require('./prisma');

exports.getOverdueGraceDays = async () => {
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'allowOverdueGraceDays' } });
  const days = Number.parseInt(setting?.value || '0', 10);
  return Number.isInteger(days) && days >= 0 ? days : 0;
};
