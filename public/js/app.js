/* ============================================
   Cooperative Society Management System
   Aligned with Membership Agreement
   ============================================ */

const API_BASE = '/api';
let authToken = localStorage.getItem('authToken') || null;
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');

// ============ API Helper ============
async function apiCall(endpoint, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (authToken) opts.headers['Authorization'] = `Bearer ${authToken}`;
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(`${API_BASE}${endpoint}`, opts);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || data.message || 'An error occurred');
    return data;
  } catch (err) { console.error(err); throw err; }
}

// ============ Utilities ============
const fmt = n => 'N' + Number(n||0).toLocaleString('en-NG', { maximumFractionDigits: 0 });
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-NG', { year:'numeric', month:'short', day:'numeric' }) : '-';
const fmtFull = d => { if(!d) return '-'; const dt=new Date(d); return dt.toLocaleDateString('en-NG',{year:'numeric',month:'short',day:'numeric'})+' '+dt.toLocaleTimeString('en-NG',{hour:'2-digit',minute:'2-digit'}); };

function showGlobalAlert(msg, type='error') {
  const c = document.getElementById('alertContainer'), a = document.getElementById('globalAlert');
  a.className = `alert alert-${type}`; a.innerHTML = msg; c.style.display = 'block';
  setTimeout(() => { c.style.display = 'none'; }, 7000);
}
function getStatusBadge(s) {
  const m = { pending:'badge-pending', approved:'badge-success', in_progress:'badge-warning', rejected:'badge-danger', completed:'badge-info' };
  return `<span class="badge ${m[s]||'badge-pending'}">${s?.replace('_',' ')}</span>`;
}
function getSavingsBadge(s) {
  if (s==='approved') return '<span class="badge badge-success">Approved</span>';
  if (s==='rejected') return '<span class="badge badge-danger">Rejected</span>';
  return '<span class="badge badge-warning">Awaiting Approval</span>';
}
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// ============ Navigation ============
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0,0);
}
function updateNavLinks() {
  const nav = document.getElementById('navLinks');
  if (!currentUser) {
    nav.innerHTML = `<button onclick="showPage('landingPage')">Home</button><button onclick="showPage('loginPage')">Login</button><button onclick="showPage('registerPage')">Register</button>`;
  } else if (currentUser.role === 'admin') {
    nav.innerHTML = `<button onclick="showPage('adminDashboard')"><i class="fas fa-tachometer-alt"></i> Dashboard</button><button onclick="logout()"><i class="fas fa-sign-out-alt"></i> Logout</button>`;
  } else {
    nav.innerHTML = `<button onclick="showPage('memberDashboard')"><i class="fas fa-tachometer-alt"></i> Dashboard</button><button onclick="logout()"><i class="fas fa-sign-out-alt"></i> Logout</button>`;
  }
}

// ============ Auth ============
document.getElementById('registerForm').addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  if (data.weekly_savings_tier) data.weekly_savings_tier = parseFloat(data.weekly_savings_tier);
  try {
    const r = await apiCall('/auth/register', 'POST', data);
    if (!r.eligible) { document.getElementById('registerAlert').innerHTML = `<div class="alert alert-error">${r.message}</div>`; return; }
    authToken = r.token; currentUser = r.user;
    localStorage.setItem('authToken', authToken); localStorage.setItem('currentUser', JSON.stringify(currentUser));
    showPage('regFeePage'); updateNavLinks();
    showGlobalAlert('Registration successful! Please complete your N5,000 payment.', 'success');
  } catch(err) { document.getElementById('registerAlert').innerHTML = `<div class="alert alert-error">${err.message}</div>`; }
});

document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    const r = await apiCall('/auth/login', 'POST', data);
    authToken = r.token; currentUser = r.user;
    localStorage.setItem('authToken', authToken); localStorage.setItem('currentUser', JSON.stringify(currentUser));
    updateNavLinks();
    if (currentUser.role === 'admin') { showPage('adminDashboard'); loadAdminDashboard(); }
    else if (!currentUser.registration_fee_paid) { showPage('regFeePage'); }
    else { showPage('memberDashboard'); loadMemberDashboard(); }
    showGlobalAlert('Welcome back, ' + currentUser.full_name + '!', 'success');
  } catch(err) { document.getElementById('loginAlert').innerHTML = `<div class="alert alert-error">${err.message}</div>`; }
});

async function payRegistrationFee() {
  try {
    const r = await apiCall('/auth/pay-registration', 'POST', { payment_ref: 'manual_' + Date.now() });
    currentUser.registration_fee_paid = true; currentUser.status = 'approved';
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    showGlobalAlert(r.message, 'success'); showPage('memberDashboard'); loadMemberDashboard();
  } catch(err) { showGlobalAlert(err.message, 'error'); }
}

function logout() {
  authToken = null; currentUser = null;
  localStorage.removeItem('authToken'); localStorage.removeItem('currentUser');
  updateNavLinks(); showPage('landingPage');
}

// ============ Member Dashboard ============
async function loadMemberDashboard() {
  try {
    const [prof, savRes, loanRes, mtgRes, gRes] = await Promise.all([
      apiCall('/members/profile'), apiCall('/members/savings'),
      apiCall('/members/loans'), apiCall('/members/meetings'),
      apiCall('/members/eligible-guarantors')
    ]);

    document.getElementById('memberWelcome').textContent =
      `${prof.user.full_name} | Credit Score: ${prof.user.credit_score} | Tier: ${fmt(prof.user.weekly_savings_tier || 1000)}/week`;

    const s = prof.savings_summary;
    const maxLoan = s.max_loan_eligible || 0;
    document.getElementById('memberStats').innerHTML = `
      <div class="stat-card"><div class="label">Compulsory (Weekly)</div><div class="value">${fmt(s.weekly_total)}</div><div class="sub">${s.weekly_weeks} approved weeks</div></div>
      <div class="stat-card accent"><div class="label">Voluntary Savings</div><div class="value">${fmt(s.voluntary_total)}</div><div class="sub">Also counts for loans</div></div>
      <div class="stat-card info"><div class="label">Total Approved Savings</div><div class="value">${fmt(s.total_approved)}</div><div class="sub">Compulsory + Voluntary</div></div>
      <div class="stat-card ${s.weekly_weeks>=12?'':'danger'}"><div class="label">Max Loan (2× savings)</div><div class="value">${fmt(maxLoan)}</div><div class="sub">${s.weekly_weeks>=12?'✓ Eligible':''+s.weekly_weeks+'/12 compulsory weeks'}</div></div>
      ${s.pending_count>0?`<div class="stat-card" style="border-left-color:var(--warning);"><div class="label"><i class="fas fa-clock"></i> Pending Approval</div><div class="value">${fmt(s.pending_total)}</div><div class="sub">${s.pending_count} payment(s) — not counted yet</div></div>`:''}
      ${prof.outstanding_fines>0?`<div class="stat-card danger"><div class="label"><i class="fas fa-exclamation-triangle"></i> Outstanding Fines</div><div class="value">${fmt(prof.outstanding_fines)}</div><div class="sub">Must be cleared before applying for a loan</div></div>`:''}
    `;

    renderSavingsTab(savRes, prof);
    renderLoansTab(loanRes, s, gRes.guarantors);
    renderMeetingCheckin(mtgRes);
    renderMeetingHistory(mtgRes.history);
    renderProfile(prof.user);
  } catch(err) { showGlobalAlert('Error: ' + err.message, 'error'); }
}

function renderSavingsTab(savRes, prof) {
  // Savings table
  const tbody = document.getElementById('savingsTableBody');
  const savings = savRes.savings || [];
  if (!savings.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-light);"><i class="fas fa-piggy-bank" style="font-size:2rem;display:block;margin-bottom:8px;"></i>No payments submitted yet.</td></tr>`;
  } else {
    tbody.innerHTML = savings.map(sv => `<tr>
      <td>${fmtDate(sv.created_at)}</td>
      <td>${sv.type==='weekly'?'<span class="badge badge-info">Compulsory</span>':'<span class="badge badge-warning">Voluntary</span>'}</td>
      <td>${sv.week_number?'Week '+sv.week_number:'-'}</td>
      <td><strong>${fmt(sv.amount)}</strong></td>
      <td>${getSavingsBadge(sv.status)}</td>
      <td style="font-size:0.82rem;">${sv.admin_comment||sv.note||'-'}</td>
    </tr>`).join('');
  }

  // Fines
  const fines = savRes.fines || [];
  const unpaidFines = fines.filter(f => !f.paid);
  if (unpaidFines.length) {
    document.getElementById('finesCard').style.display = 'block';
    document.getElementById('finesContent').innerHTML = `<table><thead><tr><th>Date</th><th>Amount</th><th>Reason</th><th>Status</th></tr></thead><tbody>
      ${unpaidFines.map(f=>`<tr><td>${fmtDate(f.created_at)}</td><td>${fmt(f.amount)}</td><td>${f.reason||'Late fine'}</td><td><span class="badge badge-danger">Unpaid</span></td></tr>`).join('')}
    </tbody></table>`;
  } else {
    document.getElementById('finesCard').style.display = 'none';
  }
}

function renderLoansTab(loanRes, savSummary, guarantors) {
  const loans = loanRes.loans || [];
  // Eligibility info
  const eligible = savSummary.weekly_weeks >= 12;
  const hasFines = (savSummary.outstanding_fines || 0) > 0;
  let info = '';
  if (!eligible) {
    info = `<div class="alert alert-warning"><i class="fas fa-exclamation-triangle"></i> You need <strong>12 weeks of approved compulsory savings</strong> to apply. Currently: <strong>${savSummary.weekly_weeks}</strong> weeks.</div>`;
  } else if (hasFines) {
    info = `<div class="alert alert-error"><i class="fas fa-exclamation-circle"></i> You have outstanding fines of <strong>${fmt(savSummary.outstanding_fines)}</strong> that must be paid before applying for a loan.</div>`;
  } else {
    info = `<div class="alert alert-success"><i class="fas fa-check-circle"></i> Eligible! Max loan: <strong>${fmt(savSummary.max_loan_eligible)}</strong> (2× total savings of ${fmt(savSummary.total_approved)}, both compulsory & voluntary count). A 1% processing fee is deducted at disbursement.</div>`;
  }
  document.getElementById('loanEligibilityInfo').innerHTML = info;

  // Populate guarantor dropdowns
  const g1 = document.getElementById('guarantor1Select');
  const g2 = document.getElementById('guarantor2Select');
  const opts = guarantors.map(g => `<option value="${g.id}">${g.full_name} (${g.phone}, ${g.weeks_saved} weeks)</option>`).join('');
  g1.innerHTML = '<option value="">— Select Guarantor 1 —</option>' + opts;
  g2.innerHTML = '<option value="">— Select Guarantor 2 —</option>' + opts;

  // Loan history
  const cont = document.getElementById('loanHistoryContent');
  if (!loans.length) {
    cont.innerHTML = `<p style="text-align:center;padding:24px;color:var(--text-light);">No loan applications yet.</p>`;
    return;
  }
  cont.innerHTML = loans.map(l => {
    const outstanding = l.outstanding_balance || 0;
    const isActive = ['approved','in_progress'].includes(l.status);
    return `<div class="card" style="margin-bottom:12px;border-left:4px solid ${l.status==='completed'?'var(--success)':l.status==='rejected'?'var(--danger)':'var(--primary)'};">
      <div class="flex-between mb-1">
        <strong>${fmt(l.amount_requested)}</strong> ${getStatusBadge(l.status)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:0.85rem;margin-bottom:8px;">
        <div>Applied: ${fmtDate(l.created_at)}</div>
        <div>Purpose: ${l.purpose||'-'}</div>
        <div>Processing fee: ${fmt(l.processing_fee||0)}</div>
        <div>Net disbursed: ${fmt(l.amount_disbursed||0)}</div>
        <div>Repayment: ${l.repayment_months||3} months (${fmt(l.repayment_instalment||0)}/month)</div>
        <div>Repaid so far: ${fmt(l.amount_repaid||0)}</div>
        ${isActive?`<div style="color:var(--danger);">Outstanding: ${fmt(outstanding)}</div>`:''}
      </div>
      ${l.admin_comment?`<div class="alert alert-info" style="padding:8px;font-size:0.85rem;margin-bottom:8px;">Admin: ${l.admin_comment}</div>`:''}
      ${isActive?`<button class="btn btn-primary btn-sm" onclick="openRepaymentModal('${l.id}',${outstanding},${l.repayment_instalment||0})"><i class="fas fa-undo"></i> Submit Repayment</button>`:''}
    </div>`;
  }).join('');
}

function openRepaymentModal(loanId, outstanding, instalment) {
  document.getElementById('repaymentLoanId').value = loanId;
  document.getElementById('repaymentAmount').value = instalment || '';
  document.getElementById('repaymentInfo').innerHTML = `Outstanding balance: <strong>${fmt(outstanding)}</strong> | Suggested instalment: <strong>${fmt(instalment)}</strong>`;
  document.getElementById('repaymentModal').classList.add('active');
}

async function submitRepayment() {
  const loanId = document.getElementById('repaymentLoanId').value;
  const amount = parseFloat(document.getElementById('repaymentAmount').value);
  const note = document.getElementById('repaymentNote').value;
  if (!amount || amount <= 0) { showGlobalAlert('Enter a valid amount', 'error'); return; }
  try {
    const r = await apiCall(`/members/loans/${loanId}/repayment`, 'POST', { amount, note });
    showGlobalAlert(r.message, 'success');
    closeModal('repaymentModal');
    loadMemberDashboard();
  } catch(err) { showGlobalAlert(err.message, 'error'); }
}

function renderMeetingCheckin(mtgRes) {
  const c = document.getElementById('meetingCheckinContainer');
  const m = mtgRes.active_meeting;
  if (mtgRes.has_checked_in) {
    c.innerHTML = `<div class="card" style="border-left:4px solid var(--success);"><div class="card-header"><h2><i class="fas fa-check-circle"></i> Checked In</h2></div>
      <div class="alert alert-success">You checked in for ${fmtDate(m?.meeting_date)}. ${mtgRes.attendance?.payment_made?`Payment: ${fmt(mtgRes.attendance.payment_amount)}`:'No payment made.'}</div></div>`;
    return;
  }
  if (!m) {
    c.innerHTML = `<div class="card"><div class="card-header"><h2><i class="fas fa-calendar-times"></i> No Active Meeting</h2></div><div class="alert alert-info">No active Sunday meeting. Check back on Sunday!</div></div>`;
    return;
  }
  c.innerHTML = `<div class="card" style="border-left:4px solid var(--accent);">
    <div class="card-header"><h2><i class="fas fa-calendar-check"></i> Sunday Check-in</h2><span class="badge badge-warning">Active</span></div>
    <p style="margin-bottom:12px;">Meeting date: <strong>${fmtDate(m.meeting_date)}</strong> | Code: <strong>${m.meeting_code}</strong></p>
    <form id="checkinForm" style="display:grid;grid-template-columns:1fr 1fr auto;gap:16px;align-items:end;">
      <div class="form-group" style="margin-bottom:0;"><label>Meeting Code</label><input type="text" name="meeting_code" required placeholder="Enter code"></div>
      <div class="form-group" style="margin-bottom:0;"><label>Payment Amount (N)</label><input type="number" name="payment_amount" placeholder="0" min="0"></div>
      <button type="submit" class="btn btn-primary"><i class="fas fa-check"></i> Check In</button>
    </form></div>`;
  document.getElementById('checkinForm').addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
      const r = await apiCall('/members/checkin', 'POST', { meeting_code: data.meeting_code, payment_amount: parseFloat(data.payment_amount)||0 });
      showGlobalAlert(r.message, 'success'); loadMemberDashboard();
    } catch(err) { showGlobalAlert(err.message, 'error'); }
  });
}

function renderMeetingHistory(history) {
  const tbody = document.getElementById('meetingHistoryBody');
  if (!history?.length) { tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-light);">No attendance yet.</td></tr>`; return; }
  tbody.innerHTML = history.map(h => `<tr>
    <td>${fmtDate(h.meeting_date)}</td><td>${h.meeting_code}</td>
    <td>${h.payment_made?fmt(h.payment_amount):'<span class="badge badge-pending">None</span>'}</td>
    <td>${fmtFull(h.created_at)}</td></tr>`).join('');
}

function renderProfile(u) {
  document.getElementById('profileInfo').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
      <div><strong>Full Name:</strong><br>${u.full_name}</div>
      <div><strong>Email:</strong><br>${u.email}</div>
      <div><strong>Phone:</strong><br>${u.phone}</div>
      <div><strong>BVN:</strong><br>${u.bvn||'-'}</div>
      <div><strong>Credit Score:</strong><br>${u.credit_score}</div>
      <div><strong>Weekly Savings Tier:</strong><br>${fmt(u.weekly_savings_tier||1000)}</div>
      <div><strong>Registration Fee:</strong><br>${u.registration_fee_paid?'<span class="badge badge-success">Paid</span>':'<span class="badge badge-danger">Not Paid</span>'}</div>
      <div><strong>Status:</strong><br>${getStatusBadge(u.status)}</div>
      <div><strong>Bank:</strong><br>${u.bank_name||'-'} ${u.bank_account_number?'('+u.bank_account_number+')':''}</div>
      <div><strong>Member Since:</strong><br>${fmtDate(u.created_at)}</div>
      <div><strong>Next of Kin:</strong><br>${u.next_of_kin||'-'} (${u.next_of_kin_relationship||'-'})</div>
      <div><strong>NOK Phone:</strong><br>${u.next_of_kin_phone||'-'}</div>
    </div>`;
  const f = document.getElementById('profileForm');
  ['address','date_of_birth','occupation','monthly_income_range','next_of_kin','next_of_kin_phone','next_of_kin_relationship','bank_name','bank_account_number'].forEach(k => { if(f[k]) f[k].value = u[k]||''; });
  if (f.weekly_savings_tier) f.weekly_savings_tier.value = u.weekly_savings_tier||1000;
}

// Form handlers
document.getElementById('savingsForm').addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  data.amount = parseFloat(data.amount);
  try {
    const r = await apiCall('/members/savings', 'POST', data);
    showGlobalAlert(r.message, 'success'); e.target.reset(); loadMemberDashboard();
  } catch(err) { showGlobalAlert(err.message, 'error'); }
});

document.getElementById('pauseForm').addEventListener('submit', async e => {
  e.preventDefault();
  const weeks = parseInt(e.target.weeks.value);
  try {
    const r = await apiCall('/members/savings/pause', 'POST', { weeks });
    showGlobalAlert(r.message, 'success');
    document.getElementById('pauseFormContainer').style.display = 'none';
  } catch(err) { showGlobalAlert(err.message, 'error'); }
});

function showPauseForm() {
  const c = document.getElementById('pauseFormContainer');
  c.style.display = c.style.display === 'none' ? 'block' : 'none';
}

document.getElementById('loanForm').addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  data.amount_requested = parseFloat(data.amount_requested);
  data.repayment_months = parseInt(data.repayment_months);
  if (!data.guarantor1_id || !data.guarantor2_id) { showGlobalAlert('Please select both guarantors', 'error'); return; }
  try {
    const r = await apiCall('/members/loans', 'POST', data);
    showGlobalAlert(r.message, 'success'); e.target.reset(); loadMemberDashboard();
  } catch(err) { showGlobalAlert(err.message, 'error'); }
});

document.getElementById('profileForm').addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  if (data.weekly_savings_tier) data.weekly_savings_tier = parseFloat(data.weekly_savings_tier);
  try {
    await apiCall('/members/profile', 'PUT', data);
    showGlobalAlert('Profile updated!', 'success'); loadMemberDashboard();
  } catch(err) { showGlobalAlert(err.message, 'error'); }
});

function switchMemberTab(name, btn) {
  document.querySelectorAll('#memberDashboard .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#memberDashboard .tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('memberTab-'+name).classList.add('active');
}

// ============ Admin Dashboard ============
async function loadAdminDashboard() {
  try {
    const [dash, loans, members, meetings, pendSav, pendRep] = await Promise.all([
      apiCall('/admin/dashboard'), apiCall('/admin/loans'),
      apiCall('/admin/members'), apiCall('/admin/meetings'),
      apiCall('/admin/savings/pending'), apiCall('/admin/repayments/pending')
    ]);

    const s = dash.stats;
    document.getElementById('adminStats').innerHTML = `
      <div class="stat-card"><div class="label">Total Members</div><div class="value">${s.total_members}</div><div class="sub">${s.approved_members} approved, ${s.pending_members} pending reg</div></div>
      <div class="stat-card accent"><div class="label">Total Approved Savings</div><div class="value">${fmt(s.grand_total_savings)}</div><div class="sub">Compulsory: ${fmt(s.total_weekly_savings)} | Voluntary: ${fmt(s.total_voluntary_savings)}</div></div>
      <div class="stat-card info"><div class="label">Available to Lend</div><div class="value">${fmt(s.available_funds)}</div><div class="sub">Reserve: ${fmt(s.reserve)} | Lent: ${fmt(s.amount_lent)}</div></div>
      <div class="stat-card" style="border-left-color:var(--warning);"><div class="label"><i class="fas fa-clock"></i> Pending Savings</div><div class="value">${s.pending_savings}</div><div class="sub">${fmt(s.pending_savings_amount)} awaiting approval</div></div>
      <div class="stat-card ${s.pending_loans>0?'danger':''}"><div class="label">Pending Loans</div><div class="value">${s.pending_loans}</div><div class="sub">${fmt(s.pending_loans_amount)} requested</div></div>
      <div class="stat-card ${s.pending_repayments>0?'':''}"><div class="label">Pending Repayments</div><div class="value">${s.pending_repayments}</div><div class="sub">${fmt(s.pending_repayments_amount)}</div></div>
      ${s.outstanding_fines>0?`<div class="stat-card danger"><div class="label">Outstanding Fines</div><div class="value">${fmt(s.outstanding_fines)}</div></div>`:''}
    `;

    renderPendingSavingsTable(pendSav.savings);
    renderPendingRepaymentsTable(pendRep.repayments);
    renderAdminLoansTable(loans.loans);
    renderAdminMembersTable(members.members);
    renderAdminMeetingsTable(meetings.meetings);
  } catch(err) { showGlobalAlert('Error: ' + err.message, 'error'); }
}

function renderPendingSavingsTable(savings) {
  const tbody = document.getElementById('adminPendingSavingsBody');
  if (!savings?.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-light);"><i class="fas fa-check-circle" style="color:var(--success);font-size:2rem;display:block;margin-bottom:8px;"></i>All caught up! No pending payments.</td></tr>`;
    return;
  }
  tbody.innerHTML = savings.map(sv => `<tr>
    <td>${fmtDate(sv.created_at)}</td>
    <td><strong>${sv.full_name}</strong><br><small>${sv.phone}</small></td>
    <td>${sv.type==='weekly'?'<span class="badge badge-info">Compulsory</span>':'<span class="badge badge-warning">Voluntary</span>'}</td>
    <td>${sv.week_number?'Week '+sv.week_number:'-'}</td>
    <td><strong>${fmt(sv.amount)}</strong></td>
    <td style="font-size:0.82rem;">${sv.note||'-'}</td>
    <td><div class="flex gap-1">
      <button class="btn btn-primary btn-sm" onclick="approveSaving('${sv.id}','approved','${sv.full_name}',${sv.amount})"><i class="fas fa-check"></i> Approve</button>
      <button class="btn btn-danger btn-sm" onclick="approveSaving('${sv.id}','rejected','${sv.full_name}',${sv.amount})"><i class="fas fa-times"></i> Reject</button>
    </div></td>
  </tr>`).join('');
}

async function approveSaving(id, status, name, amount) {
  const comment = status === 'rejected' ? (prompt(`Rejection reason for ${name}'s ${fmt(amount)}? (optional)`) || '') : '';
  try {
    const r = await apiCall('/admin/savings/' + id, 'PUT', { status, admin_comment: comment });
    showGlobalAlert(r.message, status==='approved'?'success':'warning');
    loadAdminDashboard();
  } catch(err) { showGlobalAlert(err.message, 'error'); }
}

function renderPendingRepaymentsTable(repayments) {
  const tbody = document.getElementById('adminRepaymentsBody');
  if (!repayments?.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-light);">No pending repayments.</td></tr>`;
    return;
  }
  tbody.innerHTML = repayments.map(r => `<tr>
    <td>${fmtDate(r.created_at)}</td>
    <td><strong>${r.full_name}</strong><br><small>${r.phone}</small></td>
    <td>${fmt(r.amount_approved||0)}</td>
    <td>${fmt(r.already_repaid||0)}</td>
    <td><strong>${fmt(r.amount)}</strong></td>
    <td style="font-size:0.82rem;">${r.note||'-'}</td>
    <td><div class="flex gap-1">
      <button class="btn btn-primary btn-sm" onclick="approveRepayment('${r.id}','approved')"><i class="fas fa-check"></i> Approve</button>
      <button class="btn btn-danger btn-sm" onclick="approveRepayment('${r.id}','rejected')"><i class="fas fa-times"></i> Reject</button>
    </div></td>
  </tr>`).join('');
}

async function approveRepayment(id, status) {
  try {
    const r = await apiCall('/admin/repayments/' + id, 'PUT', { status });
    showGlobalAlert(r.message, status==='approved'?'success':'warning');
    loadAdminDashboard();
  } catch(err) { showGlobalAlert(err.message, 'error'); }
}

function renderAdminLoansTable(loans) {
  const tbody = document.getElementById('adminLoanTableBody');
  if (!loans?.length) { tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-light);">No loan requests.</td></tr>`; return; }
  tbody.innerHTML = loans.map(l => `<tr>
    <td>${fmtDate(l.created_at)}</td>
    <td>${l.full_name}<br><small>${l.phone}</small></td>
    <td><strong>${fmt(l.amount_requested)}</strong></td>
    <td>${fmt((l.weekly_savings||0)+(l.voluntary_savings||0))}</td>
    <td>${l.weeks_saved} wks</td>
    <td style="font-size:0.82rem;">${l.guarantor1_name||'-'}<br>${l.guarantor2_name||'-'}</td>
    <td>${getStatusBadge(l.status)}</td>
    <td><button class="btn btn-primary btn-sm" onclick="viewLoan('${l.id}')"><i class="fas fa-eye"></i> View</button></td>
  </tr>`).join('');
}

function renderAdminMembersTable(members) {
  const tbody = document.getElementById('adminMembersTableBody');
  if (!members?.length) { tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-light);">No members yet.</td></tr>`; return; }
  tbody.innerHTML = members.map(m => `<tr>
    <td>${m.full_name}<br><small>${m.email}</small></td>
    <td>${m.phone}</td>
    <td>${m.credit_score||'-'}</td>
    <td>${fmt(m.weekly_savings)}</td>
    <td>${fmt(m.voluntary_savings)}</td>
    <td>${m.weeks_saved} wks</td>
    <td>${m.outstanding_fines>0?`<span style="color:var(--danger);">${fmt(m.outstanding_fines)}</span>`:'-'}</td>
    <td>${getStatusBadge(m.status)}</td>
    <td><button class="btn btn-primary btn-sm" onclick="viewMember('${m.id}')"><i class="fas fa-eye"></i> View</button></td>
  </tr>`).join('');
}

function renderAdminMeetingsTable(meetings) {
  const tbody = document.getElementById('adminMeetingsTableBody');
  if (!meetings?.length) { tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-light);">No meetings yet.</td></tr>`; return; }
  tbody.innerHTML = meetings.map(m => `<tr>
    <td>${fmtDate(m.meeting_date)}</td>
    <td><strong>${m.meeting_code}</strong></td>
    <td>${m.is_active?'<span class="badge badge-success">Active</span>':'<span class="badge badge-pending">Closed</span>'}</td>
    <td>${m.attendance_count}</td>
    <td>${fmt(m.total_payments)}</td>
    <td><button class="btn btn-primary btn-sm" onclick="viewAttendance('${m.id}','${m.meeting_date}')"><i class="fas fa-list"></i> View</button></td>
  </tr>`).join('');
}

async function loadAdminLoans() {
  try {
    const f = document.getElementById('loanFilter').value;
    const r = await apiCall('/admin/loans' + (f ? '?status=' + f : ''));
    renderAdminLoansTable(r.loans);
  } catch(err) { showGlobalAlert(err.message, 'error'); }
}

async function viewLoan(loanId) {
  try {
    const [loansRes, sugRes] = await Promise.all([apiCall('/admin/loans'), apiCall('/admin/loans/'+loanId+'/suggestion')]);
    const l = loansRes.loans.find(x => x.id === loanId);
    if (!l) return;
    const sug = sugRes.suggestion;
    const sc = sug.total_score>=60?'score-high':sug.total_score>=45?'score-medium':'score-low';
    const rc = sug.recommendation_level==='accept'?'alert-success':sug.recommendation_level==='in_progress'?'alert-warning':'alert-error';

    document.getElementById('loanModalTitle').textContent = 'Loan — ' + l.full_name;
    document.getElementById('loanModalBody').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:0.9rem;">
        <div><strong>Amount:</strong> ${fmt(l.amount_requested)}</div>
        <div><strong>Status:</strong> ${getStatusBadge(l.status)}</div>
        <div><strong>Purpose:</strong> ${l.purpose||'-'}</div>
        <div><strong>Date:</strong> ${fmtDate(l.created_at)}</div>
        <div><strong>Processing fee (1%):</strong> ${fmt((l.amount_approved||l.amount_requested)*0.01)}</div>
        <div><strong>Net disbursement:</strong> ${fmt((l.amount_approved||l.amount_requested)*0.99)}</div>
        <div><strong>Repayment:</strong> ${l.repayment_months||3} months @ ${fmt(l.repayment_instalment||0)}/month</div>
        <div><strong>Repaid:</strong> ${fmt(l.amount_repaid||0)}</div>
        <div><strong>Total Savings:</strong> ${fmt((l.weekly_savings||0)+(l.voluntary_savings||0))}</div>
        <div><strong>Weeks Saved:</strong> ${l.weeks_saved}</div>
        <div><strong>Guarantor 1:</strong> ${l.guarantor1_name||'-'}</div>
        <div><strong>Guarantor 2:</strong> ${l.guarantor2_name||'-'}</div>
      </div>
      <h3 style="color:var(--primary);margin-bottom:8px;"><i class="fas fa-lightbulb"></i> AI Suggestion</h3>
      <div style="text-align:center;margin-bottom:12px;">
        <div class="score-circle ${sc}" style="display:inline-flex;align-items:center;justify-content:center;width:70px;height:70px;border-radius:50%;font-size:1.6rem;font-weight:700;">${sug.total_score}</div>
        <p style="color:var(--text-light);margin-top:4px;font-size:0.85rem;">out of 100</p>
      </div>
      <div class="alert ${rc}">${sug.recommendation}</div>
      <ul class="factor-list">
        ${sug.factors.map(f=>`<li>
          <div><div class="factor-name">${f.factor}</div><div style="font-size:0.78rem;color:var(--text-light);">${f.detail}</div></div>
          <div class="factor-bar"><div class="factor-bar-fill" style="width:${Math.min(100,(f.points/f.max_points)*100)}%"></div></div>
          <div class="factor-points">${f.points}/${f.max_points}</div>
        </li>`).join('')}
      </ul>
      <div class="alert alert-info" style="margin-top:12px;font-size:0.85rem;">
        Pool: ${fmt(sug.cooperative_funds.pool)} | Reserve (25%): ${fmt(sug.cooperative_funds.reserve)} | Available: ${fmt(sug.cooperative_funds.available)}
      </div>
      ${l.status==='pending'?`
        <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px;">
          <h4 style="margin-bottom:8px;">Take Action</h4>
          <div class="form-row" style="margin-bottom:12px;">
            <div class="form-group"><label>Approved Amount (N)</label><input type="number" id="approvedAmount" value="${l.amount_requested}" min="1000"></div>
            <div class="form-group"><label>Repayment Months</label><select id="approvedMonths"><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option></select></div>
          </div>
          <div class="form-group"><label>Comment for member</label><textarea id="loanComment" rows="2" placeholder="Add a note...">${l.admin_comment||''}</textarea></div>
          <div class="flex gap-2 flex-wrap">
            <button class="btn btn-primary" onclick="updateLoanStatus('${loanId}','approved')"><i class="fas fa-check"></i> Approve</button>
            <button class="btn btn-accent" onclick="updateLoanStatus('${loanId}','in_progress')"><i class="fas fa-clock"></i> In Progress</button>
            <button class="btn btn-danger" onclick="updateLoanStatus('${loanId}','rejected')"><i class="fas fa-times"></i> Reject</button>
          </div>
        </div>`:
        l.status==='in_progress'?`
        <div style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px;">
          <div class="form-group"><label>Comment</label><textarea id="loanComment" rows="2">${l.admin_comment||''}</textarea></div>
          <button class="btn btn-primary" onclick="updateLoanStatus('${loanId}','completed')"><i class="fas fa-check-circle"></i> Mark as Completed</button>
        </div>`:
        `<div class="alert ${l.status==='approved'?'alert-success':l.status==='completed'?'alert-info':'alert-error'}" style="margin-top:12px;">
          <strong>Admin Comment:</strong> ${l.admin_comment||'No comment'}</div>`}
    `;
    document.getElementById('loanModal').classList.add('active');
  } catch(err) { showGlobalAlert(err.message, 'error'); }
}

async function updateLoanStatus(loanId, status) {
  const comment = document.getElementById('loanComment')?.value || '';
  const amount = parseFloat(document.getElementById('approvedAmount')?.value) || null;
  const months = parseInt(document.getElementById('approvedMonths')?.value) || null;
  try {
    const r = await apiCall('/admin/loans/'+loanId, 'PUT', { status, admin_comment: comment, amount_approved: amount, repayment_months: months });
    showGlobalAlert(r.message, 'success');
    closeModal('loanModal'); loadAdminDashboard();
  } catch(err) { showGlobalAlert(err.message, 'error'); }
}

async function viewMember(memberId) {
  try {
    const r = await apiCall('/admin/members/'+memberId);
    const m = r.member, s = r.savings_summary;
    document.getElementById('memberModalTitle').textContent = m.full_name;
    document.getElementById('memberModalBody').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:0.88rem;">
        <div><strong>Email:</strong> ${m.email}</div><div><strong>Phone:</strong> ${m.phone}</div>
        <div><strong>BVN:</strong> ${m.bvn||'-'}</div><div><strong>Credit Score:</strong> ${m.credit_score||'-'}</div>
        <div><strong>Occupation:</strong> ${m.occupation||'-'}</div><div><strong>Income:</strong> ${m.monthly_income_range||'-'}</div>
        <div><strong>Bank:</strong> ${m.bank_name||'-'}</div><div><strong>Acct No:</strong> ${m.bank_account_number||'-'}</div>
        <div><strong>Next of Kin:</strong> ${m.next_of_kin||'-'} (${m.next_of_kin_relationship||'-'})</div>
        <div><strong>NOK Phone:</strong> ${m.next_of_kin_phone||'-'}</div>
        <div><strong>Status:</strong> ${getStatusBadge(m.status)}</div>
        <div><strong>Loan Rights:</strong> ${m.loan_rights_suspended?'<span class="badge badge-danger">Suspended</span>':'<span class="badge badge-success">Active</span>'}</div>
      </div>
      <div class="stats-grid" style="margin-bottom:16px;">
        <div class="stat-card"><div class="label">Compulsory</div><div class="value">${fmt(s.weekly_total)}</div><div class="sub">${s.weekly_weeks} wks</div></div>
        <div class="stat-card accent"><div class="label">Voluntary</div><div class="value">${fmt(s.voluntary_total)}</div></div>
        <div class="stat-card info"><div class="label">Total Approved</div><div class="value">${fmt(s.total_approved)}</div></div>
        <div class="stat-card" style="border-left-color:var(--warning);"><div class="label">Pending</div><div class="value">${fmt(s.pending_total)}</div><div class="sub">${s.pending_count} entries</div></div>
        <div class="stat-card ${s.meets_12_week_requirement?'':'danger'}"><div class="label">Max Loan</div><div class="value">${fmt(s.max_loan_eligible)}</div><div class="sub">${s.meets_12_week_requirement?'✓ Eligible':'Need 12 wks'}</div></div>
        ${s.outstanding_fines>0?`<div class="stat-card danger"><div class="label">Fines</div><div class="value">${fmt(s.outstanding_fines)}</div></div>`:''}
      </div>
      <div class="flex gap-2 flex-wrap" style="margin-bottom:16px;">
        ${m.status==='pending'?`<button class="btn btn-primary btn-sm" onclick="updateMemberStatus('${m.id}','approved')"><i class="fas fa-check"></i> Approve</button>`:''}
        ${m.status==='approved'?`<button class="btn btn-danger btn-sm" onclick="updateMemberStatus('${m.id}','rejected')"><i class="fas fa-times"></i> Reject</button>`:''}
        ${m.loan_rights_suspended?
          `<button class="btn btn-primary btn-sm" onclick="toggleLoanRights('${m.id}',false)"><i class="fas fa-unlock"></i> Restore Loan Rights</button>`:
          `<button class="btn btn-danger btn-sm" onclick="toggleLoanRights('${m.id}',true)"><i class="fas fa-lock"></i> Suspend Loan Rights</button>`}
        <button class="btn btn-accent btn-sm" onclick="addFine('${m.id}')"><i class="fas fa-exclamation-triangle"></i> Add Fine</button>
      </div>
      <h4 style="color:var(--primary);margin:8px 0 6px;">All Savings</h4>
      <div class="table-container" style="margin-bottom:12px;">
        <table><thead><tr><th>Date</th><th>Type</th><th>Wk</th><th>Amount</th><th>Status</th><th>Comment</th></tr></thead>
        <tbody>${!r.savings.length?'<tr><td colspan="6" style="text-align:center;color:var(--text-light);">None</td></tr>':
          r.savings.map(sv=>`<tr>
            <td>${fmtDate(sv.created_at)}</td>
            <td>${sv.type==='weekly'?'Compulsory':'Voluntary'}</td>
            <td>${sv.week_number||'-'}</td><td>${fmt(sv.amount)}</td>
            <td>${getSavingsBadge(sv.status)}</td>
            <td style="font-size:0.8rem;">${sv.admin_comment||sv.note||'-'}</td>
          </tr>`).join('')}
        </tbody></table>
      </div>
      <h4 style="color:var(--primary);margin:8px 0 6px;">Loans & Repayments</h4>
      <div class="table-container" style="margin-bottom:12px;">
        <table><thead><tr><th>Date</th><th>Amount</th><th>Purpose</th><th>Processing Fee</th><th>Repaid</th><th>Status</th></tr></thead>
        <tbody>${!r.loans.length?'<tr><td colspan="6" style="text-align:center;color:var(--text-light);">None</td></tr>':
          r.loans.map(l=>{
            const repaid = r.repayments.filter(rp=>rp.loan_id===l.id&&rp.status==='approved').reduce((sum,rp)=>sum+rp.amount,0);
            return `<tr>
              <td>${fmtDate(l.created_at)}</td><td>${fmt(l.amount_requested)}</td>
              <td>${l.purpose||'-'}</td><td>${fmt(l.processing_fee||0)}</td>
              <td>${fmt(repaid)}</td><td>${getStatusBadge(l.status)}</td>
            </tr>`;
          }).join('')}
        </tbody></table>
      </div>
      <h4 style="color:var(--primary);margin:8px 0 6px;">Fines</h4>
      <div class="table-container">
        <table><thead><tr><th>Date</th><th>Amount</th><th>Reason</th><th>Paid</th><th>Action</th></tr></thead>
        <tbody>${!r.fines.length?'<tr><td colspan="5" style="text-align:center;color:var(--text-light);">No fines</td></tr>':
          r.fines.map(f=>`<tr>
            <td>${fmtDate(f.created_at)}</td><td>${fmt(f.amount)}</td>
            <td>${f.reason||'-'}</td>
            <td>${f.paid?'<span class="badge badge-success">Paid</span>':'<span class="badge badge-danger">Unpaid</span>'}</td>
            <td>${!f.paid?`<button class="btn btn-primary btn-sm" onclick="markFinePaid('${f.id}')">Mark Paid</button>`:''}</td>
          </tr>`).join('')}
        </tbody></table>
      </div>
    `;
    document.getElementById('memberModal').classList.add('active');
  } catch(err) { showGlobalAlert(err.message, 'error'); }
}

async function updateMemberStatus(id, status) {
  try {
    await apiCall('/admin/members/'+id+'/status', 'PUT', { status });
    showGlobalAlert('Member '+status, 'success'); closeModal('memberModal'); loadAdminDashboard();
  } catch(err) { showGlobalAlert(err.message, 'error'); }
}

async function toggleLoanRights(id, suspended) {
  try {
    await apiCall('/admin/members/'+id+'/loan-rights', 'PUT', { suspended });
    showGlobalAlert('Loan rights '+(suspended?'suspended':'restored'), 'success'); closeModal('memberModal'); loadAdminDashboard();
  } catch(err) { showGlobalAlert(err.message, 'error'); }
}

async function addFine(memberId) {
  const reason = prompt('Reason for fine (or leave blank for "Late savings fine"):') || 'Late savings fine';
  const amount = parseFloat(prompt('Fine amount (default N200):') || '200') || 200;
  try {
    await apiCall('/admin/members/'+memberId+'/fine', 'POST', { amount, reason });
    showGlobalAlert(`Fine of ${fmt(amount)} added`, 'success'); closeModal('memberModal'); loadAdminDashboard();
  } catch(err) { showGlobalAlert(err.message, 'error'); }
}

async function markFinePaid(fineId) {
  try {
    await apiCall('/admin/fines/'+fineId+'/paid', 'PUT', {});
    showGlobalAlert('Fine marked as paid', 'success'); loadAdminDashboard();
  } catch(err) { showGlobalAlert(err.message, 'error'); }
}

async function viewAttendance(meetingId, date) {
  try {
    const r = await apiCall('/admin/meetings/'+meetingId+'/attendance');
    document.getElementById('attendanceModalTitle').textContent = 'Attendance — '+fmtDate(date);
    document.getElementById('attendanceModalBody').innerHTML = `<div class="table-container"><table>
      <thead><tr><th>Member</th><th>Phone</th><th>Payment</th><th>Time</th></tr></thead>
      <tbody>${!r.attendance.length?'<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--text-light);">No check-ins</td></tr>':
        r.attendance.map(a=>`<tr>
          <td>${a.full_name}</td><td>${a.phone}</td>
          <td>${a.payment_made?fmt(a.payment_amount):'<span class="badge badge-pending">None</span>'}</td>
          <td>${fmtFull(a.created_at)}</td>
        </tr>`).join('')}
      </tbody></table></div>`;
    document.getElementById('attendanceModal').classList.add('active');
  } catch(err) { showGlobalAlert(err.message, 'error'); }
}

document.getElementById('meetingForm').addEventListener('submit', async e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    const r = await apiCall('/admin/meetings', 'POST', data);
    showGlobalAlert('Meeting created! Code: '+r.meeting.meeting_code, 'success');
    e.target.reset(); loadAdminDashboard();
  } catch(err) { showGlobalAlert(err.message, 'error'); }
});

function switchAdminTab(name, btn) {
  document.querySelectorAll('#adminDashboard .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#adminDashboard .tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('adminTab-'+name).classList.add('active');
  if (name === 'suggestions') loadAllSuggestions();
}

async function loadAllSuggestions() {
  try {
    const r = await apiCall('/admin/loans/suggestions/all');
    const s = r.summary;
    document.getElementById('suggestionsSummary').innerHTML = `
      <div class="stats-grid mb-3">
        <div class="stat-card"><div class="label">Pending</div><div class="value">${s.total_pending}</div></div>
        <div class="stat-card"><div class="label">Suggest Approve</div><div class="value">${s.accept}</div><div class="sub">${fmt(s.total_acceptable_amount)}</div></div>
        <div class="stat-card accent"><div class="label">Hold/Review</div><div class="value">${s.hold}</div></div>
        <div class="stat-card danger"><div class="label">Suggest Reject</div><div class="value">${s.reject}</div></div>
        <div class="stat-card info"><div class="label">Available Funds</div><div class="value">${fmt(s.available_funds)}</div><div class="sub">After: ${fmt(s.remaining_after_acceptance)}</div></div>
      </div>
      <div class="alert alert-info mb-3" style="font-size:0.88rem;">Suggestions based on credit score, approved savings (compulsory + voluntary), 12-week requirement, meeting attendance, outstanding fines, and available pool funds (25% reserve maintained).</div>`;
    if (!r.suggestions.length) { document.getElementById('suggestionsList').innerHTML = `<p style="text-align:center;padding:24px;color:var(--text-light);">No pending loans.</p>`; return; }
    document.getElementById('suggestionsList').innerHTML = r.suggestions.map(s => {
      const sc = s.score>=60?'score-high':s.score>=45?'score-medium':'score-low';
      const ab = s.action==='accept'?'badge-success':s.action==='hold'?'badge-warning':'badge-danger';
      return `<div class="card" style="display:flex;align-items:center;gap:16px;margin-bottom:12px;">
        <div class="score-circle ${sc}" style="width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.1rem;flex-shrink:0;">${s.score}</div>
        <div style="flex:1;font-size:0.88rem;">
          <div class="flex-between mb-1"><strong>${s.member_name}</strong><span class="badge ${ab}">${s.action.toUpperCase()}</span></div>
          <div style="color:var(--text-light);">${fmt(s.amount)} | Savings: ${fmt(s.total_savings)} | ${s.weeks_saved} wks${s.outstanding_fines>0?` | <span style="color:var(--danger);">Fines: ${fmt(s.outstanding_fines)}</span>`:''}${!s.can_afford?' | <span style="color:var(--danger);">Insufficient funds</span>':''}</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="viewLoan('${s.loan_id}')"><i class="fas fa-eye"></i> Review</button>
      </div>`;
    }).join('');
  } catch(err) { showGlobalAlert(err.message, 'error'); }
}

// ============ Init ============
updateNavLinks();
if (currentUser && authToken) {
  if (currentUser.role === 'admin') { showPage('adminDashboard'); loadAdminDashboard(); }
  else if (currentUser.registration_fee_paid) { showPage('memberDashboard'); loadMemberDashboard(); }
  else { showPage('regFeePage'); }
}
