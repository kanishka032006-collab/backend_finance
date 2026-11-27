const { Prisma } = require('../node_modules/.prisma/tridin-client');
const prisma = require('../utils/prisma');
const { getOverdueGraceDays } = require('../utils/systemSettings');

// Round to 2 decimal places to avoid floating point precision issues
const round2 = (num) => Math.round((Number(num) + Number.EPSILON) * 100) / 100;

class FinanceService {
  /**
   * Calculate finance account figures
   */
  calculateAccountTerms(agreedRepayment, actualDisbursed, totalWeeks) {
    const repayment = round2(agreedRepayment);
    const disbursed = round2(actualDisbursed);
    const weeks = parseInt(totalWeeks, 10);

    if (repayment <= 0 || disbursed <= 0 || weeks <= 0) {
      throw new Error('Amounts and weeks must be greater than zero.');
    }
    if (disbursed > repayment) {
      throw new Error('Disbursed amount cannot exceed agreed repayment amount.');
    }

    const grossDifference = round2(repayment - disbursed);
    const baseWeekly = round2(repayment / weeks);

    return {
      agreedRepayment: repayment,
      actualDisbursed: disbursed,
      grossDifference,
      weeklyInstalment: baseWeekly,
      totalWeeks: weeks
    };
  }

  /**
   * Calculate loan terms for any loan type (Weekly, Daily, Monthly, Monthly Interest, Gold, Auto, Enterprise)
   */
  calculateLoanTerms(loanType, principal, interestRate, duration, agreedRepaymentOverride = null) {
    const p = round2(principal);
    const rate = Number(interestRate || 0);
    const count = parseInt(duration, 10);

    if (p <= 0 || count <= 0) {
      throw new Error('Principal and duration must be greater than zero.');
    }

    let totalPayable = agreedRepaymentOverride ? round2(agreedRepaymentOverride) : p;
    if (!agreedRepaymentOverride && rate > 0) {
      if (loanType === 'MONTHLY_INTEREST') {
        const monthlyInterest = round2((p * rate) / 100);
        totalPayable = round2(p + monthlyInterest * count);
      } else {
        const interest = round2((p * rate * count) / 100);
        totalPayable = round2(p + interest);
      }
    }

    if (p > totalPayable) {
      throw new Error('Disbursed amount cannot exceed agreed repayment amount.');
    }

    const grossDifference = round2(totalPayable - p);
    const baseInstalment = round2(totalPayable / count);

    return {
      agreedRepayment: totalPayable,
      actualDisbursed: p,
      grossDifference,
      weeklyInstalment: baseInstalment,
      totalWeeks: count
    };
  }

  /**
   * Generate instalment schedule (supports DAILY, WEEKLY, MONTHLY, and MONTHLY_INTEREST)
   */
  createInstalmentSchedule(totalWeeks, agreedRepayment, weeklyInstalment, firstDueDate, collectionFrequency = 'WEEKLY', loanType = 'WEEKLY_COLLECTION', actualDisbursed = null, interestRate = null) {
    const weeks = parseInt(totalWeeks, 10);
    const baseInstalment = round2(weeklyInstalment);
    const totalAgreed = round2(agreedRepayment);
    const schedule = [];
    const startDate = new Date(firstDueDate);
    const now = new Date();

    let accumulated = 0;

    for (let i = 1; i <= weeks; i++) {
      const dueDate = new Date(startDate);
      if (collectionFrequency === 'DAILY') {
        dueDate.setDate(startDate.getDate() + (i - 1));
      } else if (collectionFrequency === 'MONTHLY') {
        dueDate.setMonth(startDate.getMonth() + (i - 1));
      } else {
        dueDate.setDate(startDate.getDate() + (i - 1) * 7);
      }

      let amount = baseInstalment;
      if (loanType === 'MONTHLY_INTEREST' && actualDisbursed && interestRate && Number(interestRate) > 0) {
        const monthlyInt = round2((Number(actualDisbursed) * Number(interestRate)) / 100);
        if (i === weeks) {
          amount = round2(totalAgreed - accumulated);
        } else {
          amount = monthlyInt;
          accumulated = round2(accumulated + amount);
        }
      } else if (i === weeks) {
        amount = round2(totalAgreed - accumulated);
      } else {
        accumulated = round2(accumulated + amount);
      }

      // Initial status
      let status = 'UPCOMING';
      if (dueDate < now) {
        status = 'OVERDUE';
      }

      schedule.push({
        weekNumber: i,
        dueDate,
        scheduledAmount: amount,
        paidAmount: 0,
        status
      });
    }

    // Double check sum
    const totalSchedule = schedule.reduce((sum, item) => round2(sum + item.scheduledAmount), 0);
    if (Math.abs(totalSchedule - totalAgreed) > 0.01) {
      throw new Error(`Schedule sum (${totalSchedule}) does not match agreed repayment (${totalAgreed})`);
    }

    return schedule;
  }

  /**
   * Generate unique receipt number
   * Format: REC-YYYYMM-XXXX
   */
  async generateReceiptNumber(tx = prisma) {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const config = await tx.systemSetting.findUnique({ where: { key: 'receiptPrefix' } });
    const template = !config?.value || config.value === 'REC' ? 'REC-YYYYMM-XXXX' : config.value;
    const stem = template.replace('YYYYMM', yearMonth).replace('XXXX', '');
    await tx.$queryRaw(Prisma.sql`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`receipt-${yearMonth}`}))) AS receipt_lock`);

    const latestPayment = await tx.payment.findFirst({
      where: {
        receiptNumber: {
          startsWith: stem
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    let nextSeq = 1;
    if (latestPayment && latestPayment.receiptNumber) {
      const seq = parseInt(latestPayment.receiptNumber.slice(stem.length), 10);
      if (!isNaN(seq)) nextSeq = seq + 1;
    }

    return `${stem}${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Process FIFO Payment Allocation
   */
  async recordPayment({
    accountId,
    customerId,
    collectorId,
    amount,
    paymentDate = new Date(),
    paymentMethod = 'CASH',
    reference = null,
    notes = null,
    enforceCollectorAssignment = false
  }, transactionClient = null) {
    const paymentAmount = round2(amount);
    if (paymentAmount <= 0) {
      throw new Error('Payment amount must be greater than zero.');
    }

    const postPayment = async (tx) => {
      // 1. Fetch account with customer and instalments
      const account = await tx.financeAccount.findUnique({
        where: { id: accountId },
        include: {
          customer: true,
          instalments: {
            orderBy: { weekNumber: 'asc' }
          }
        }
      });

      if (!account) {
        throw new Error('Finance account not found.');
      }
      if (enforceCollectorAssignment && account.customer.assignedCollectorId !== collectorId) {
        const error = new Error('You can only collect payments for borrowers assigned to you.');
        error.statusCode = 403;
        throw error;
      }
      if (account.status === 'COMPLETED' || account.status === 'CLOSED') {
        throw new Error(`Cannot record payment on an account with status '${account.status}'.`);
      }

      const methodsSetting = await tx.systemSetting.findUnique({ where: { key: 'enabledPaymentMethods' } });
      const enabledMethods = methodsSetting ? JSON.parse(methodsSetting.value) : ['CASH', 'UPI', 'BANK_TRANSFER'];
      if (!enabledMethods.includes(paymentMethod)) throw new Error(`Payment method '${paymentMethod}' is currently disabled in system settings.`);

      // Calculate current outstanding before this payment
      const totalAgreed = Number(account.agreedRepayment);
      const totalPaidSoFar = account.instalments.reduce(
        (sum, inst) => sum + Number(inst.paidAmount),
        0
      );
      const previousOutstanding = round2(totalAgreed - totalPaidSoFar);

      if (paymentAmount > previousOutstanding) {
        throw new Error(`Payment amount (₹${paymentAmount}) exceeds total remaining outstanding balance (₹${previousOutstanding}).`);
      }

      // Generate Receipt Number
      const receiptNumber = await this.generateReceiptNumber(tx);

      // Create Payment Record
      const payment = await tx.payment.create({
        data: {
          receiptNumber,
          accountId,
          customerId: account.customerId,
          collectorId,
          amount: new Prisma.Decimal(paymentAmount),
          paymentDate: new Date(paymentDate),
          paymentMethod,
          reference,
          notes,
          status: 'COMPLETED'
        }
      });

      // FIFO Allocation to unpaid / partially paid instalments
      let remainingToAllocate = paymentAmount;
      const createdAllocations = [];
      const updatedInstalments = [];

      for (const inst of account.instalments) {
        if (remainingToAllocate <= 0) break;

        const scheduled = Number(inst.scheduledAmount);
        const alreadyPaid = Number(inst.paidAmount);
        const unpaidForInst = round2(scheduled - alreadyPaid);

        if (unpaidForInst > 0) {
          const allocationForThis = Math.min(remainingToAllocate, unpaidForInst);
          const newPaidAmount = round2(alreadyPaid + allocationForThis);
          remainingToAllocate = round2(remainingToAllocate - allocationForThis);

          // Determine new instalment status
          let newStatus = 'PARTIAL';
          let paidAt = inst.paidAt;
          if (newPaidAmount >= scheduled) {
            newStatus = 'PAID';
            paidAt = new Date(paymentDate);
          }

          // Update instalment
          const updatedInst = await tx.instalment.update({
            where: { id: inst.id },
            data: {
              paidAmount: new Prisma.Decimal(newPaidAmount),
              status: newStatus,
              paidAt
            }
          });
          updatedInstalments.push(updatedInst);

          // Create PaymentAllocation record
          const alloc = await tx.paymentAllocation.create({
            data: {
              paymentId: payment.id,
              instalmentId: inst.id,
              allocatedAmount: new Prisma.Decimal(allocationForThis)
            }
          });
          createdAllocations.push(alloc);
        }
      }

      // Check if all instalments are now PAID
      const allInstalments = await tx.instalment.findMany({
        where: { accountId }
      });
      const allPaid = allInstalments.every(
        (ins) => Number(ins.paidAmount) >= Number(ins.scheduledAmount)
      );

      if (allPaid) {
        await tx.financeAccount.update({
          where: { id: accountId },
          data: { status: 'COMPLETED' }
        });
      }

      const remainingBalance = round2(previousOutstanding - paymentAmount);

      return {
        payment,
        allocations: createdAllocations,
        previousOutstanding,
        currentPayment: paymentAmount,
        remainingBalance,
        receiptNumber,
        customerName: account.customer.name,
        accountNumber: account.accountNumber
      };
    };

    return transactionClient ? postPayment(transactionClient) : prisma.$transaction(postPayment);
  }

  /**
   * Reverse a posted payment with audit trail
   */
  async reversePayment({ paymentId, reason, reversedById }) {
    if (!reason || reason.trim().length === 0) {
      throw new Error('A valid reason is required for payment reversal.');
    }

    return await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: paymentId },
        include: {
          allocations: {
            include: {
              instalment: true
            }
          },
          account: true
        }
      });

      if (!payment) {
        throw new Error('Payment not found.');
      }
      if (payment.status === 'REVERSED') {
        throw new Error('Payment has already been reversed.');
      }

      const now = new Date();

      // Rollback each allocation on the respective instalments
      for (const alloc of payment.allocations) {
        const inst = alloc.instalment;
        const currentPaid = Number(inst.paidAmount);
        const allocated = Number(alloc.allocatedAmount);
        const restoredPaid = Math.max(0, round2(currentPaid - allocated));
        const scheduled = Number(inst.scheduledAmount);

        let newStatus = 'UPCOMING';
        if (restoredPaid > 0) {
          newStatus = 'PARTIAL';
        } else {
          if (new Date(inst.dueDate) < now) {
            newStatus = 'OVERDUE';
          } else {
            newStatus = 'UPCOMING';
          }
        }

        await tx.instalment.update({
          where: { id: inst.id },
          data: {
            paidAmount: new Prisma.Decimal(restoredPaid),
            status: newStatus,
            paidAt: restoredPaid >= scheduled ? inst.paidAt : null
          }
        });
      }

      // Mark payment as REVERSED
      const updatedPayment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'REVERSED',
          reversedAt: now,
          reversalReason: reason,
          reversedById
        }
      });

      // If account was marked COMPLETED, set it back to ACTIVE
      if (payment.account.status === 'COMPLETED') {
        await tx.financeAccount.update({
          where: { id: payment.accountId },
          data: { status: 'ACTIVE' }
        });
      }

      return updatedPayment;
    });
  }

  /**
   * Refresh and sync instalment overdue statuses based on current date
   */
  async syncAccountOverdueStatus(accountId = null) {
    const now = new Date();
    const overdueCutoff = new Date(now.getTime() - (await getOverdueGraceDays()) * 86400000);
    const where = accountId ? { accountId } : {};

    const instalments = await prisma.instalment.findMany({
      where: {
        ...where,
        status: { in: ['UPCOMING', 'DUE', 'PARTIAL'] },
        dueDate: { lt: overdueCutoff }
      }
    });

    for (const inst of instalments) {
      const scheduled = Number(inst.scheduledAmount);
      const paid = Number(inst.paidAmount);

      let newStatus = 'OVERDUE';
      if (paid > 0 && paid < scheduled) {
        newStatus = 'PARTIAL';
      } else if (paid >= scheduled) {
        newStatus = 'PAID';
      }

      await prisma.instalment.update({
        where: { id: inst.id },
        data: { status: newStatus }
      });
    }
  }
}

module.exports = new FinanceService();
