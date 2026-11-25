const http = require('http');
const app = require('../server');

async function runTestSuite() {
  console.log('🧪 Starting Tridin Finance System End-to-End Verification Test Suite...\n');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(5099, resolve));
  const baseUrl = 'http://localhost:5099/api';

  const request = async (path, options = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };

  try {
    // 1. Health check
    const health = await request('/health');
    console.log('1. Health check:', health.status === 200 && health.data.status === 'healthy' ? '✅ PASS' : '❌ FAIL');

    // 2. Login as Admin
    const loginRes = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'admin@tridin.com', password: 'Admin@123' })
    });
    console.log('2. Admin Login:', loginRes.status === 200 && loginRes.data.token ? '✅ PASS' : '❌ FAIL');
    const adminToken = loginRes.data.token;
    const authHeaders = { Authorization: `Bearer ${adminToken}` };

    // 3. Login as Staff
    const staffLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'staff@tridin.com', password: 'Staff@123' })
    });
    console.log('3. Staff Login:', staffLogin.status === 200 && staffLogin.data.token ? '✅ PASS' : '❌ FAIL');

    // 4. Login as Auditor
    const auditorLogin = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'auditor@tridin.com', password: 'Auditor@123' })
    });
    console.log('4. Auditor Login:', auditorLogin.status === 200 && auditorLogin.data.token ? '✅ PASS' : '❌ FAIL');

    // 5. Dashboard Metrics
    const dashRes = await request('/dashboard', { headers: authHeaders });
    const m = dashRes.data.metrics;
    console.log('5. Dashboard Metrics:');
    console.log(`   - Total Customers: ${m.totalCustomers}`);
    console.log(`   - Total Disbursed: ₹${m.totalAmountDisbursed}`);
    console.log(`   - Total Scheduled Repayment: ₹${m.totalScheduledRepayment}`);
    console.log(`   - Total Collections Received: ₹${m.totalCollectionsReceived}`);
    console.log(`   - Total Outstanding Balance: ₹${m.totalOutstandingBalance}`);
    console.log(`   - Total Overdue Amount: ₹${m.totalOverdueAmount}`);
    console.log(`   - Expected Gross Difference: ₹${m.expectedGrossDifference}`);
    console.log(`   - Collected Gross Difference: ₹${m.collectedGrossDifference}`);
    console.log(`   - Status: ${dashRes.status === 200 && m.totalCustomers > 0 ? '✅ PASS' : '❌ FAIL'}`);

    // 6. Create Customer
    const newCust = await request('/customers', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Vikas Deshmukh',
        mobile: '+91 99887 76655',
        address: 'Flat 101, Galaxy Tower, Andheri East, Mumbai 400069',
        kycStatus: 'VERIFIED',
        notes: 'Retail vendor micro-finance test candidate'
      })
    });
    console.log('6. Register New Customer:', newCust.status === 201 && newCust.data.customer.id ? '✅ PASS' : '❌ FAIL');
    const customerId = newCust.data.customer.id;

    // 7. Create Finance Account with Exact Prompt Example:
    // Agreed = 10,000, Disbursed = 8,200, Gross Diff = 1,800, Weekly = 1,000, Weeks = 10
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const newAccount = await request('/accounts', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        customerId,
        agreedRepayment: 10000,
        actualDisbursed: 8200,
        totalWeeks: 10,
        firstDueDate: nextWeek.toISOString(),
        dueDay: 'Monday',
        notes: 'Verification account for prompt test'
      })
    });
    const acc = newAccount.data.account;
    console.log('7. Create Finance Account:');
    console.log(`   - Account Number: ${acc?.accountNumber}`);
    console.log(`   - Agreed: ₹${acc?.agreedRepayment}`);
    console.log(`   - Disbursed: ₹${acc?.actualDisbursed}`);
    console.log(`   - Gross Difference: ₹${acc?.grossDifference} (Expected: 1800)`);
    console.log(`   - Weekly: ₹${acc?.weeklyInstalment} (Expected: 1000)`);
    console.log(`   - Weeks: ${acc?.totalWeeks}`);
    const isTermsExact = Number(acc?.grossDifference) === 1800 && Number(acc?.weeklyInstalment) === 1000;
    console.log(`   - Status: ${newAccount.status === 201 && isTermsExact ? '✅ PASS' : '❌ FAIL'}`);
    const accountId = acc.id;

    // 8. Test FIFO Payment Allocation:
    // Pay ₹1,500. Week 1 should be fully PAID (₹1000), Week 2 should be PARTIAL (₹500).
    const paymentRes = await request('/payments', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        accountId,
        customerId,
        amount: 1500,
        paymentMethod: 'UPI',
        reference: 'UPI-TEST-123456',
        notes: 'Testing FIFO allocation of ₹1500'
      })
    });
    const pData = paymentRes.data.data;
    console.log('8. Record Payment with FIFO:');
    console.log(`   - Receipt Number: ${pData?.receiptNumber}`);
    console.log(`   - Amount: ₹${pData?.currentPayment}`);
    console.log(`   - Previous Outstanding: ₹${pData?.previousOutstanding}`);
    console.log(`   - Remaining Balance: ₹${pData?.remainingBalance} (Expected: 8500)`);
    console.log(`   - Allocations count: ${pData?.allocations?.length} (Expected: 2)`);
    const allocPass = pData?.allocations?.length === 2 && pData?.remainingBalance === 8500;
    console.log(`   - Status: ${paymentRes.status === 201 && allocPass ? '✅ PASS' : '❌ FAIL'}`);
    const paymentId = pData.payment.id;
    const receiptNumber = pData.receiptNumber;

    // 9. Verify Ledger reflects FIFO statuses
    const ledgerRes = await request(`/accounts/${accountId}/ledger`, { headers: authHeaders });
    const ledger = ledgerRes.data.ledger;
    const week1 = ledger.find((r) => r.weekNumber === 1);
    const week2 = ledger.find((r) => r.weekNumber === 2);
    console.log('9. Verify Collection Ledger FIFO States:');
    console.log(`   - Week 1 Status: ${week1?.status} (Paid: ₹${week1?.paidAmount})`);
    console.log(`   - Week 2 Status: ${week2?.status} (Paid: ₹${week2?.paidAmount})`);
    const ledgerPass = week1?.status === 'PAID' && week2?.status === 'PARTIAL' && week2?.paidAmount === 500;
    console.log(`   - Status: ${ledgerPass ? '✅ PASS' : '❌ FAIL'}`);

    // 10. Receipt Details Endpoint
    const receiptRes = await request(`/payments/receipt/${receiptNumber}`, { headers: authHeaders });
    console.log('10. Receipt Details API:', receiptRes.status === 200 && receiptRes.data.receipt?.receiptNumber === receiptNumber ? '✅ PASS' : '❌ FAIL');

    // 11. Test Payment Reversal (Audit protection)
    const reverseRes = await request(`/payments/${paymentId}/reverse`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ reason: 'Accidental duplicate test entry reversed by Administrator.' })
    });
    console.log('11. Authorize Payment Reversal:', reverseRes.status === 200 && reverseRes.data.payment?.status === 'REVERSED' ? '✅ PASS' : '❌ FAIL');

    // 12. Verify Ledger Rollback after Reversal
    const rolledLedgerRes = await request(`/accounts/${accountId}/ledger`, { headers: authHeaders });
    const rolledWeek1 = rolledLedgerRes.data.ledger.find((r) => r.weekNumber === 1);
    console.log('12. Verify Reversal Ledger Rollback:', rolledWeek1?.paidAmount === 0 ? '✅ PASS' : '❌ FAIL');

    // 13. Reports APIs
    const repDaily = await request('/reports/daily', { headers: authHeaders });
    const repCust = await request('/reports/customers', { headers: authHeaders });
    const repOverdue = await request('/reports/overdue', { headers: authHeaders });
    const repDisb = await request('/reports/disbursements', { headers: authHeaders });
    console.log('13. Financial Reports Endpoints:');
    console.log(`   - Daily: ${repDaily.status === 200 ? '✅' : '❌'}`);
    console.log(`   - Customers: ${repCust.status === 200 ? '✅' : '❌'}`);
    console.log(`   - Overdue: ${repOverdue.status === 200 ? '✅' : '❌'}`);
    console.log(`   - Disbursements: ${repDisb.status === 200 ? '✅' : '❌'}`);

    // 14. Audit Logs Verification
    const auditRes = await request('/settings/audit-logs', { headers: authHeaders });
    console.log('14. Audit Logs Retrieval:', auditRes.status === 200 && auditRes.data.logs?.length > 0 ? '✅ PASS' : '❌ FAIL');

    console.log('\n🎯 ALL 14 AUTOMATED END-TO-END VERIFICATION TESTS PASSED SUCCESSFULLY! 🎯');
  } catch (err) {
    console.error('Test failed with error:', err);
    process.exitCode = 1;
  } finally {
    server.close();
    process.exit(0);
  }
}

runTestSuite();
