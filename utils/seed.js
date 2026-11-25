require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('./prisma');
const financeService = require('../services/financeService');

async function seed() {
  console.log('🌱 Starting Tridin Finance System Database Seeding...');

  // Clear existing data in reverse order of foreign keys
  await prisma.paymentAllocation.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.adjustment.deleteMany({});
  await prisma.instalment.deleteMany({});
  await prisma.financeAccount.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.systemSetting.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('🧹 Existing data wiped clean.');

  // 1. Create Default Users
  const adminPassword = await bcrypt.hash('Admin@123', 10);
  const staffPassword = await bcrypt.hash('Staff@123', 10);
  const auditorPassword = await bcrypt.hash('Auditor@123', 10);

  const admin = await prisma.user.create({
    data: {
      name: 'Admin',
      email: 'admin@tridin.com',
      password: adminPassword,
      role: 'ADMINISTRATOR',
      phone: '+91 98765 43210',
      active: true
    }
  });

  const staff = await prisma.user.create({
    data: {
      name: 'Priya Sharma',
      email: 'staff@tridin.com',
      password: staffPassword,
      role: 'COLLECTION_STAFF',
      phone: '+91 98765 12345',
      active: true
    }
  });

  const auditor = await prisma.user.create({
    data: {
      name: 'Anil Deshmukh (Auditor)',
      email: 'auditor@tridin.com',
      password: auditorPassword,
      role: 'READ_ONLY_AUDITOR',
      phone: '+91 98765 67890',
      active: true
    }
  });

  console.log('👤 Users created:');
  console.log('   - Admin: admin@tridin.com / Admin@123');
  console.log('   - Staff: staff@tridin.com / Staff@123');
  console.log('   - Auditor: auditor@tridin.com / Auditor@123');

  // 2. Create System Settings
  await prisma.systemSetting.createMany({
    data: [
      { key: 'companyName', value: 'Tridin Software Private Limited', description: 'Company name' },
      { key: 'currencySymbol', value: '₹', description: 'Primary currency' },
      { key: 'receiptPrefix', value: 'REC-YYYYMM-XXXX', description: 'Prefix for payment receipts' },
      { key: 'defaultDueDay', value: 'Monday', description: 'Standard collection due day' },
      { key: 'enabledPaymentMethods', value: JSON.stringify(['CASH', 'UPI', 'BANK_TRANSFER']), description: 'Supported payment methods' },
      { key: 'allowOverdueGraceDays', value: '0', description: 'Grace days before marking overdue' },
      { key: 'backupAutoSchedule', value: 'Daily', description: 'Automated backup frequency' }
    ]
  });

  // 3. Create Customers
  const customerList = [
    {
      customerCode: 'CUST-0001',
      name: 'Ramesh Patel',
      mobile: '+91 98234 56789',
      address: 'Shop No. 12, Market Yard, Pune, Maharashtra 411037',
      kycStatus: 'VERIFIED',
      notes: 'Wholesale textile merchant. Very prompt payment history.'
    },
    {
      customerCode: 'CUST-0002',
      name: 'Sunita Mehra',
      mobile: '+91 98345 67890',
      address: 'Flat 402, Sai Residency, Indiranagar, Bengaluru 560038',
      kycStatus: 'VERIFIED',
      notes: 'Boutique owner. Prefers UPI collections.'
    },
    {
      customerCode: 'CUST-0003',
      name: 'Kavita Rao',
      mobile: '+91 98456 78901',
      address: 'Plot 45, Jubilee Hills Road No. 10, Hyderabad 500033',
      kycStatus: 'VERIFIED',
      notes: 'Cafe owner. 2nd cycle of finance repayment.'
    },
    {
      customerCode: 'CUST-0004',
      name: 'Mahesh Kumar',
      mobile: '+91 98567 89012',
      address: 'B-18, Sector 18, Noida, Uttar Pradesh 201301',
      kycStatus: 'PENDING',
      notes: 'New applicant for electronics retail micro-loan. KYC under review.'
    },
    {
      customerCode: 'CUST-0005',
      name: 'Deepak Joshi',
      mobile: '+91 98678 90123',
      address: '32, MG Road, Ernakulam, Kochi, Kerala 682011',
      kycStatus: 'VERIFIED',
      notes: 'Hardware retail store proprietor. Occasional delay in 3rd week.'
    },
    {
      customerCode: 'CUST-0006',
      name: 'Anita Sen',
      mobile: '+91 98789 01234',
      address: '15/A, Park Street, Kolkata, West Bengal 700016',
      kycStatus: 'VERIFIED',
      notes: 'Handicraft supplier. Account completed on time.'
    }
  ];

  const createdCustomers = {};
  for (const c of customerList) {
    const cust = await prisma.customer.create({ data: { ...c, assignedCollectorId: staff.id } });
    createdCustomers[c.customerCode] = cust;
  }
  console.log(`👥 Created ${customerList.length} customers.`);

  // 4. Create Finance Accounts & Instalments
  // Account 1: Ramesh Patel - exact prompt example: ₹10,000 agreed, ₹8,200 disbursed, ₹1,800 gross diff, ₹1,000 weekly, 10 weeks
  const today = new Date();
  const past3Weeks = new Date(today);
  past3Weeks.setDate(today.getDate() - 21);

  const acc1Terms = financeService.calculateAccountTerms(10000, 8200, 10);
  const acc1Schedule = financeService.createInstalmentSchedule(10, 10000, 1000, past3Weeks);

  const acc1 = await prisma.financeAccount.create({
    data: {
      accountNumber: 'ACC-2026-0001',
      customerId: createdCustomers['CUST-0001'].id,
      agreedRepayment: acc1Terms.agreedRepayment,
      actualDisbursed: acc1Terms.actualDisbursed,
      grossDifference: acc1Terms.grossDifference,
      weeklyInstalment: acc1Terms.weeklyInstalment,
      totalWeeks: acc1Terms.totalWeeks,
      firstDueDate: past3Weeks,
      dueDay: 'Monday',
      status: 'ACTIVE',
      notes: 'Regular business growth micro-loan for festive stock.'
    }
  });

  for (const item of acc1Schedule) {
    await prisma.instalment.create({
      data: {
        accountId: acc1.id,
        weekNumber: item.weekNumber,
        dueDate: item.dueDate,
        scheduledAmount: item.scheduledAmount,
        paidAmount: 0,
        status: item.status
      }
    });
  }

  // Account 2: Sunita Mehra - ₹25,000 agreed, ₹21,000 disbursed, 10 weeks, ₹2,500/week
  const past5Weeks = new Date(today);
  past5Weeks.setDate(today.getDate() - 35);
  const acc2Terms = financeService.calculateAccountTerms(25000, 21000, 10);
  const acc2Schedule = financeService.createInstalmentSchedule(10, 25000, 2500, past5Weeks);

  const acc2 = await prisma.financeAccount.create({
    data: {
      accountNumber: 'ACC-2026-0002',
      customerId: createdCustomers['CUST-0002'].id,
      agreedRepayment: acc2Terms.agreedRepayment,
      actualDisbursed: acc2Terms.actualDisbursed,
      grossDifference: acc2Terms.grossDifference,
      weeklyInstalment: acc2Terms.weeklyInstalment,
      totalWeeks: acc2Terms.totalWeeks,
      firstDueDate: past5Weeks,
      dueDay: 'Wednesday',
      status: 'ACTIVE',
      notes: 'Boutique inventory expansion financing.'
    }
  });

  for (const item of acc2Schedule) {
    await prisma.instalment.create({
      data: {
        accountId: acc2.id,
        weekNumber: item.weekNumber,
        dueDate: item.dueDate,
        scheduledAmount: item.scheduledAmount,
        paidAmount: 0,
        status: item.status
      }
    });
  }

  // Account 3: Kavita Rao - ₹15,000 agreed, ₹12,500 disbursed, 12 weeks, ₹1,250/week
  const past2Weeks = new Date(today);
  past2Weeks.setDate(today.getDate() - 14);
  const acc3Terms = financeService.calculateAccountTerms(15000, 12500, 12);
  const acc3Schedule = financeService.createInstalmentSchedule(12, 15000, 1250, past2Weeks);

  const acc3 = await prisma.financeAccount.create({
    data: {
      accountNumber: 'ACC-2026-0003',
      customerId: createdCustomers['CUST-0003'].id,
      agreedRepayment: acc3Terms.agreedRepayment,
      actualDisbursed: acc3Terms.actualDisbursed,
      grossDifference: acc3Terms.grossDifference,
      weeklyInstalment: acc3Terms.weeklyInstalment,
      totalWeeks: acc3Terms.totalWeeks,
      firstDueDate: past2Weeks,
      dueDay: 'Friday',
      status: 'ACTIVE',
      notes: 'Cafe equipment upgrades.'
    }
  });

  for (const item of acc3Schedule) {
    await prisma.instalment.create({
      data: {
        accountId: acc3.id,
        weekNumber: item.weekNumber,
        dueDate: item.dueDate,
        scheduledAmount: item.scheduledAmount,
        paidAmount: 0,
        status: item.status
      }
    });
  }

  // Account 4: Anita Sen - Fully COMPLETED Account (₹12,000 agreed, ₹10,000 disbursed, 6 weeks, ₹2,000/week)
  const past10Weeks = new Date(today);
  past10Weeks.setDate(today.getDate() - 70);
  const acc4Terms = financeService.calculateAccountTerms(12000, 10000, 6);
  const acc4Schedule = financeService.createInstalmentSchedule(6, 12000, 2000, past10Weeks);

  const acc4 = await prisma.financeAccount.create({
    data: {
      accountNumber: 'ACC-2026-0004',
      customerId: createdCustomers['CUST-0006'].id,
      agreedRepayment: acc4Terms.agreedRepayment,
      actualDisbursed: acc4Terms.actualDisbursed,
      grossDifference: acc4Terms.grossDifference,
      weeklyInstalment: acc4Terms.weeklyInstalment,
      totalWeeks: acc4Terms.totalWeeks,
      firstDueDate: past10Weeks,
      dueDay: 'Monday',
      status: 'ACTIVE',
      notes: 'Successfully completed on schedule with zero defaults.'
    }
  });

  for (const item of acc4Schedule) {
    await prisma.instalment.create({
      data: {
        accountId: acc4.id,
        weekNumber: item.weekNumber,
        dueDate: item.dueDate,
        scheduledAmount: item.scheduledAmount,
        paidAmount: 0,
        status: item.status
      }
    });
  }

  // Account 5: Deepak Joshi - Overdue Account (₹50,000 agreed, ₹42,000 disbursed, 20 weeks, ₹2,500/week)
  const past6Weeks = new Date(today);
  past6Weeks.setDate(today.getDate() - 42);
  const acc5Terms = financeService.calculateAccountTerms(50000, 42000, 20);
  const acc5Schedule = financeService.createInstalmentSchedule(20, 50000, 2500, past6Weeks);

  const acc5 = await prisma.financeAccount.create({
    data: {
      accountNumber: 'ACC-2026-0005',
      customerId: createdCustomers['CUST-0005'].id,
      agreedRepayment: acc5Terms.agreedRepayment,
      actualDisbursed: acc5Terms.actualDisbursed,
      grossDifference: acc5Terms.grossDifference,
      weeklyInstalment: acc5Terms.weeklyInstalment,
      totalWeeks: acc5Terms.totalWeeks,
      firstDueDate: past6Weeks,
      dueDay: 'Tuesday',
      status: 'ACTIVE',
      notes: 'Hardware stock seasonal credit.'
    }
  });

  for (const item of acc5Schedule) {
    await prisma.instalment.create({
      data: {
        accountId: acc5.id,
        weekNumber: item.weekNumber,
        dueDate: item.dueDate,
        scheduledAmount: item.scheduledAmount,
        paidAmount: 0,
        status: item.status
      }
    });
  }

  console.log('💼 Created 5 Finance Accounts with Repayment Schedules.');

  // 5. Record Payments with FIFO Allocation
  console.log('💰 Recording initial payments using FIFO allocation...');

  // Ramesh Patel pays ₹2,000 on Account 1 (covers Week 1 and Week 2)
  const pay1Date = new Date(past3Weeks);
  pay1Date.setDate(pay1Date.getDate() + 7);
  await financeService.recordPayment({
    accountId: acc1.id,
    customerId: createdCustomers['CUST-0001'].id,
    collectorId: staff.id,
    amount: 2000,
    paymentDate: pay1Date,
    paymentMethod: 'CASH',
    reference: 'CASH-REC-01',
    notes: 'Collected cash at shop premises.'
  });

  // Sunita Mehra pays ₹5,000 on Account 2 via UPI (covers Week 1 and Week 2)
  const pay2Date = new Date(past5Weeks);
  pay2Date.setDate(pay2Date.getDate() + 10);
  await financeService.recordPayment({
    accountId: acc2.id,
    customerId: createdCustomers['CUST-0002'].id,
    collectorId: staff.id,
    amount: 5000,
    paymentDate: pay2Date,
    paymentMethod: 'UPI',
    reference: 'UPI/2026/8934789234',
    notes: 'Direct GPay settlement.'
  });

  // Sunita Mehra pays another ₹2,500 on Account 2 (covers Week 3)
  const pay3Date = new Date(past5Weeks);
  pay3Date.setDate(pay3Date.getDate() + 20);
  await financeService.recordPayment({
    accountId: acc2.id,
    customerId: createdCustomers['CUST-0002'].id,
    collectorId: staff.id,
    amount: 2500,
    paymentDate: pay3Date,
    paymentMethod: 'UPI',
    reference: 'UPI/2026/9123847291',
    notes: 'Week 3 clearance.'
  });

  // Kavita Rao pays partial ₹1,000 on Account 3 (scheduled ₹1,250 -> leaving ₹250 partial)
  const pay4Date = new Date(past2Weeks);
  pay4Date.setDate(pay4Date.getDate() + 5);
  await financeService.recordPayment({
    accountId: acc3.id,
    customerId: createdCustomers['CUST-0003'].id,
    collectorId: staff.id,
    amount: 1000,
    paymentDate: pay4Date,
    paymentMethod: 'BANK_TRANSFER',
    reference: 'NEFT-HDFC-9921',
    notes: 'Partial payment received. Balance ₹250 committed next week.'
  });

  // Anita Sen pays all 6 instalments (₹12,000 total) -> Account completes!
  let currentPayDate = new Date(past10Weeks);
  for (let w = 1; w <= 6; w++) {
    currentPayDate.setDate(currentPayDate.getDate() + 7);
    await financeService.recordPayment({
      accountId: acc4.id,
      customerId: createdCustomers['CUST-0006'].id,
      collectorId: staff.id,
      amount: 2000,
      paymentDate: new Date(currentPayDate),
      paymentMethod: w % 2 === 0 ? 'UPI' : 'CASH',
      reference: `BATCH-PAY-W${w}`,
      notes: `Prompt week ${w} repayment.`
    });
  }

  // Deepak Joshi has missed multiple weeks (only paid ₹2,500 for Week 1)
  const pay5Date = new Date(past6Weeks);
  pay5Date.setDate(pay5Date.getDate() + 6);
  await financeService.recordPayment({
    accountId: acc5.id,
    customerId: createdCustomers['CUST-0005'].id,
    collectorId: staff.id,
    amount: 2500,
    paymentDate: pay5Date,
    paymentMethod: 'CASH',
    reference: 'CASH-REC-05',
    notes: 'Only week 1 paid. Subsequent weeks currently overdue.'
  });

  // Sync all overdue statuses
  await financeService.syncAccountOverdueStatus();

  // 6. Record Audit Logs
  await prisma.auditLog.createMany({
    data: [
      {
        userId: admin.id,
        action: 'SYSTEM_INITIALIZATION',
        entity: 'System',
        entityId: 'ROOT',
        details: 'System database initialized with baseline configuration and role definitions.',
        ipAddress: '127.0.0.1'
      },
      {
        userId: staff.id,
        action: 'COLLECTION_RECORDED',
        entity: 'Payment',
        details: 'Recorded field collections for Week 1 & Week 2.',
        ipAddress: '127.0.0.1'
      }
    ]
  });

  console.log('✅ Database seeding finished successfully!');
}

seed()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
