const prisma = require('../utils/prisma');
const { logAudit } = require('../utils/auditLogger');
const PDFDocument = require('pdfkit');

const createSnapshotPdf = (sections, generatedAt, databaseName) => new Promise((resolve, reject) => {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 58, right: 40, bottom: 48, left: 40 }, bufferPages: true });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('error', reject);
  doc.on('end', () => resolve(Buffer.concat(chunks)));

  doc.font('Helvetica-Bold').fontSize(18).fillColor('#172033').text('Complete System Database Snapshot');
  doc.moveDown(0.4).font('Helvetica').fontSize(9).fillColor('#334155')
    .text(`Generated: ${generatedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`)
    .text(`Database: ${databaseName}`)
    .text('Sensitive connection details are excluded.');
  doc.moveDown(1);

  for (const { title, records } of sections) {
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#172033').text(title);
    doc.font('Helvetica').fontSize(9).fillColor('#475569').text(`Total records: ${records.length}`);
    const rows = [['#', 'Database record']];
    records.forEach((record, index) => {
      const fields = Object.entries(record).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
      const chunksOfRecord = fields.match(/[\s\S]{1,1800}/g) || ['(empty record)'];
      chunksOfRecord.forEach((part, chunkIndex) => rows.push([chunkIndex === 0 ? String(index + 1) : '', part]));
    });
    doc.table({
      data: rows,
      headerRows: 1,
      columnStyles: [42, '*'],
      defaultStyle: { border: 0.5, borderColor: '#CBD5E1', padding: 4, font: 'Helvetica', fontSize: 7, textColor: '#1E293B' },
      rowStyles: (rowIndex) => rowIndex === 0
        ? { backgroundColor: '#E2E8F0', font: 'Helvetica-Bold', fontSize: 8, minHeight: 20 }
        : { minHeight: 14 }
    });
    doc.moveDown(1);
  }

  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex++) {
    doc.switchToPage(pageIndex);
    doc.save().strokeColor('#CBD5E1').lineWidth(0.5)
      .moveTo(40, 42).lineTo(doc.page.width - 40, 42).stroke()
      .moveTo(40, doc.page.height - 42).lineTo(doc.page.width - 40, doc.page.height - 42).stroke().restore();
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748B')
      .text('TRIDIN FINANCE | Complete System Database Snapshot', 40, 22, { lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor('#64748B')
      .text(`Page ${pageIndex + 1} of ${range.count}`, 40, doc.page.height - 30, { width: doc.page.width - 80, align: 'right', lineBreak: false });
  }
  doc.end();
});

exports.getSettings = async (req, res, next) => {
  try {
    const settings = await prisma.systemSetting.findMany();
    const settingsMap = {};
    for (const s of settings) {
      settingsMap[s.key] = s.value;
    }

    // Default configuration fallbacks
    const response = {
      companyName: settingsMap.companyName || 'Tridin Software',
      currencySymbol: settingsMap.currencySymbol || '₹',
      receiptPrefix: !settingsMap.receiptPrefix || settingsMap.receiptPrefix === 'REC'
        ? 'REC-YYYYMM-XXXX'
        : settingsMap.receiptPrefix,
      defaultDueDay: settingsMap.defaultDueDay || 'Monday',
      enabledPaymentMethods: settingsMap.enabledPaymentMethods
        ? JSON.parse(settingsMap.enabledPaymentMethods)
        : ['CASH', 'UPI', 'BANK_TRANSFER'],
      allowOverdueGraceDays: parseInt(settingsMap.allowOverdueGraceDays || '0', 10),
      backupAutoSchedule: settingsMap.backupAutoSchedule || 'Daily'
    };

    res.json({ success: true, settings: response });
  } catch (error) {
    next(error);
  }
};

exports.updateSettings = async (req, res, next) => {
  try {
    const {
      companyName,
      currencySymbol,
      receiptPrefix,
      defaultDueDay,
      enabledPaymentMethods,
      allowOverdueGraceDays
    } = req.body;

    const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const methods = ['CASH', 'UPI', 'BANK_TRANSFER'];
    if (typeof companyName !== 'string' || !companyName.trim()) return res.status(400).json({ success: false, message: 'Company / Entity Name is required.' });
    if (typeof currencySymbol !== 'string' || !currencySymbol.trim() || currencySymbol.length > 8) return res.status(400).json({ success: false, message: 'Enter a valid currency symbol (up to 8 characters).' });
    if (typeof receiptPrefix !== 'string' || !receiptPrefix.trim()) return res.status(400).json({ success: false, message: 'Receipt Prefix is required.' });
    if (!weekdays.includes(defaultDueDay)) return res.status(400).json({ success: false, message: 'Default Due Day must be a weekday.' });
    if (!Number.isInteger(allowOverdueGraceDays) || allowOverdueGraceDays < 0 || allowOverdueGraceDays > 14) return res.status(400).json({ success: false, message: 'Overdue Grace Days must be between 0 and 14.' });
    if (!Array.isArray(enabledPaymentMethods) || !enabledPaymentMethods.length || enabledPaymentMethods.some((method) => !methods.includes(method))) return res.status(400).json({ success: false, message: 'Select at least one valid payment method.' });

    const upsertSetting = (tx, key, value, description) => {
      if (value !== undefined) {
        return tx.systemSetting.upsert({
          where: { key },
          update: { value: typeof value === 'object' ? JSON.stringify(value) : String(value) },
          create: {
            key,
            value: typeof value === 'object' ? JSON.stringify(value) : String(value),
            description
          }
        });
      }
    };

    await prisma.$transaction(async (tx) => Promise.all([
      upsertSetting(tx, 'companyName', companyName.trim(), 'Corporate Name'),
      upsertSetting(tx, 'currencySymbol', currencySymbol.trim(), 'Default Currency'),
      upsertSetting(tx, 'receiptPrefix', receiptPrefix.trim(), 'Receipt Prefix format'),
      upsertSetting(tx, 'defaultDueDay', defaultDueDay, 'Default Collection Due Day'),
      upsertSetting(tx, 'enabledPaymentMethods', enabledPaymentMethods, 'Active Payment Channels'),
      upsertSetting(tx, 'allowOverdueGraceDays', allowOverdueGraceDays, 'Grace Days for Overdue Calculation')
    ]));

    await logAudit({
      userId: req.user.id,
      action: 'UPDATE_SYSTEM_SETTINGS',
      entity: 'SystemSetting',
      details: req.body,
      req
    });

    res.json({ success: true, message: 'Settings saved successfully.' });
  } catch (error) {
    next(error);
  }
};

exports.getAuditLogs = async (req, res, next) => {
  try {
    const { action, entity, search, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const take = parseInt(limit, 10);

    const where = {};
    if (action) where.action = action;
    if (entity) where.entity = entity;
    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { entity: { contains: search, mode: 'insensitive' } },
        { details: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } }
      ];
    }

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take,
        include: {
          user: { select: { id: true, name: true, email: true, role: true } }
        },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    res.json({
      success: true,
      logs,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: take,
        totalPages: Math.ceil(total / take)
      }
    });
  } catch (error) {
    next(error);
  }
};

exports.exportBackup = async (req, res, next) => {
  try {
    const [customers, accounts, instalments, payments, auditLogs] = await Promise.all([
      prisma.customer.findMany(),
      prisma.financeAccount.findMany(),
      prisma.instalment.findMany(),
      prisma.payment.findMany(),
      prisma.auditLog.findMany()
    ]);
    const sections = [
      { title: 'Borrowers', records: customers },
      { title: 'Finance Accounts', records: accounts },
      { title: 'Instalments', records: instalments },
      { title: 'Payments', records: payments },
      { title: 'Audit Ledgers', records: auditLogs }
    ];
    const generatedAt = new Date();
    let databaseName = 'unknown';
    try { databaseName = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '') || 'unknown'; } catch (_) { /* Credentials are never included in the report. */ }
    const pdf = await createSnapshotPdf(sections, generatedAt, databaseName);

    await logAudit({
      userId: req.user.id,
      action: 'EXPORT_DATABASE_BACKUP',
      entity: 'System',
      details: { recordCounts: { borrowers: customers.length, financeAccounts: accounts.length, instalments: instalments.length, payments: payments.length, auditLedgers: auditLogs.length } },
      req
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="Complete_System_Database_Snapshot.pdf"');
    res.send(pdf);
  } catch (error) {
    next(error);
  }
};
