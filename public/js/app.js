/* ============================================
   Cooperative Management System - Frontend Logic
   ============================================ */

const API_BASE = '/api';
let authToken = localStorage.getItem('authToken') || null;
let currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');

// ============================================
// API Helper
// ============================================
async function apiCall(endpoint, method = 'GET', body = null) {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (authToken) options.headers['Authorization'] = `Bearer ${authToken}`;
  if (body) options.body = JSON.stringify(body);
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.message || 'An error occurred');
    return data;
  } catch (err) {
    console.error('API Error:', err);
    throw err;
  }
}

// ============================================
// Utility Functions
// ============================================
function formatMoney(amount) {
  return 'N' + Number(amount).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' });
}
function formatDateFull(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}
function showGlobalAlert(message, type = 'error') {
  const container = document.getElementById('alertContainer');
  const alert = document.getElementById('globalAlert');
  alert.className = `alert alert-${type}`;
  alert.innerHTML = message;
  container.style.display = 'block';
  setTimeout(() => { container.style.display = 'none'; }, 6000);
}
function getStatusBadge(status) {
  const badges = {
    pending:     '<span class="badge badge-pending">Pending</span>',
    approved:    '<span class="badge badge-success">Approved</span>',
    in_progress: '<span class="badge badge-warning">In Progress</span>',
    rejected:    '<span class="badge badge-danger">Rejected</span>'
  };
  return badges[status] || `<span class="badge badge-pending">${status}</span>`;
}
function getSavingsBadge(status) {
  if (status === 'approved') return '<span class="badge badge-success">Approved</span>';
  if (status === 'rejected') return '<span class="badge badge-danger">Rejected</span>';
  return '<span class="badge badge-warning">Awaiting Approval</span>';
}
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// ============================================
// Page Navigation
// ============================================
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  window.scrollTo(0, 0);
}
function updateNavLinks() {
  const nav = document.getElementById('navLinks');
  if (!currentUser) {
    nav.innerHTML = `
      <button onclick="showPage('landingPage')">Home</button>
      <button onclick="showPage('loginPage')">Login</button>
      <button onclick="showPage('registerPage')">Register</button>`;
  } else if (currentUser.role === 'admin') {
    nav.innerHTML = `
      <button onclick="showPage('adminDashboard')"><i class="fas fa-tachometer-alt"></i> Dashboard</button>
      <button onclick="logout()"><i class="fas fa-sign-out-alt"></i> Logout</button>`;
  } else {
    nav.innerHTML = `
      <button onclick="showPage('memberDashboard')"><i class="fas fa-tachometer-alt"></i> Dashboard</button>
      <button onclick="logout()"><i class="fas fa-sign-out-alt"></i> Logout</button>`;
  }
}

// ============================================
// Authentication
// ============================================
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    const result = await apiCall('/auth/register', 'POST', data);
    if (!result.eligible) {
      document.getElementById('registerAlert').innerHTML = `<div class="alert alert-error">${result.message}</div>`;
      return;
    }
    authToken = result.token;
    currentUser = result.user;
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    showPage('regFeePage');
    updateNavLinks();
    showGlobalAlert('Registration successful! Please complete your payment.', 'success');
  } catch (err) {
    document.getElementById('registerAlert').innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    const result = await apiCall('/auth/login', 'POST', data);
    authToken = result.token;
    currentUser = result.user;
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    updateNavLinks();
    if (currentUser.role === 'admin') {
      showPage('adminDashboard');
      loadAdminDashboard();
    } else if (!currentUser.registration_fee_paid) {
      showPage('regFeePage');
    } else {
      showPage('memberDashboard');
      loadMemberDashboard();
    }
    showGlobalAlert('Welcome back, ' + currentUser.full_name + '!', 'success');
  } catch (err) {
    document.getElementById('loginAlert').innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
});

async function payRegistrationFee() {
  try {
    const result = await apiCall('/auth/pay-registration', 'POST', { payment_ref: 'manual_' + Date.now() });
    currentUser.registration_fee_paid = true;
    currentUser.status = 'approved';
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    showGlobalAlert(result.message, 'success');
    showPage('memberDashboard');
    loadMemberDashboard();
  } catch (err) { showGlobalAlert(err.message, 'error'); }
}

function logout() {
  authToken = null; currentUser = null;
  localStorage.removeItem('authToken'); localStorage.removeItem('currentUser');
  updateNavLinks(); showPage('landingPage');
}

// ============================================
// Member Dashboard
// ============================================
async function loadMemberDashboard() {
  try {
    const [profileRes, savingsRes, loansRes, meetingsRes] = await Promise.all([
      apiCall('/members/profile'),
      apiCall('/members/savings'),
      apiCall('/members/loans'),
      apiCall('/members/meetings')
    ]);

    document.getElementById('memberWelcome').textContent =
      `Welcome, ${profileRes.user.full_name} | Credit Score: ${profileRes.user.credit_score || 'N/A'}`;

    const stats = profileRes.savings_summary;
    document.getElementById('memberStats').innerHTML = `
      <div class="stat-card">
        <div class="label">Approved Weekly Savings</div>
        <div class="value">${formatMoney(stats.weekly_total)}</div>
        <div class="sub">${stats.weekly_weeks} approved weeks</div>
      </div>
      <div class="stat-card accent">
        <div class="label">Approved Special Savings</div>
        <div class="value">${formatMoney(stats.special_total)}</div>
        <div class="sub">Not counted for loans</div>
      </div>
      <div class="stat-card info">
        <div class="label">Total Approved Savings</div>
        <div class="value">${formatMoney(stats.grand_total)}</div>
        <div class="sub">All approved savings combined</div>
      </div>
      <div class="stat-card ${stats.weekly_weeks >= 12 ? '' : 'danger'}">
        <div class="label">Max Loan Eligible</div>
        <div class="value">${formatMoney(stats.weekly_total * 2)}</div>
        <div class="sub">${stats.weekly_weeks >= 12 ? '✓ Eligible (12+ weeks)' : stats.weekly_weeks + '/12 approved weeks needed'}</div>
      </div>
      ${stats.pending_count > 0 ? `
      <div class="stat-card" style="border-left-color:var(--warning);">
        <div class="label"><i class="fas fa-clock"></i> Awaiting Admin Approval</div>
        <div class="value">${formatMoney(stats.pending_total)}</div>
        <div class="sub">${stats.pending_count} payment(s) pending — not counted yet</div>
      </div>` : ''}
    `;

    renderSavingsTable(savingsRes.savings);
    document.getElementById('savingsForm').reset();
    renderLoansTable(loansRes.loans);
    renderLoanEligibility(stats);
    renderMeetingCheckin(meetingsRes);
    renderMeetingHistory(meetingsRes.history);
    renderProfile(profileRes.user);
  } catch (err) {
    showGlobalAlert('Error loading dashboard: ' + err.message, 'error');
  }
}

function renderSavingsTable(savings) {
  const tbody = document.getElementById('savingsTableBody');
  if (!savings || savings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-light);">
      <i class="fas fa-piggy-bank" style="font-size:2rem;display:block;margin-bottom:8px;"></i>
      No payments submitted yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = savings.map(s => `
    <tr>
      <td>${formatDate(s.created_at)}</td>
      <td>${s.type === 'weekly' ? '<span class="badge badge-info">Weekly</span>' : '<span class="badge badge-warning">Special</span>'}</td>
      <td>${s.week_number ? 'Week ' + s.week_number : '-'}</td>
      <td><strong>${formatMoney(s.amount)}</strong></td>
      <td>${getSavingsBadge(s.status)}</td>
      <td style="font-size:0.82rem;color:var(--text-light);">${s.admin_comment || s.note || '-'}</td>
    </tr>
  `).join('');
}

function renderLoansTable(loans) {
  const tbody = document.getElementById('loanTableBody');
  if (!loans || loans.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-light);">No loan applications yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = loans.map(l => `
    <tr>
      <td>${formatDate(l.created_at)}</td>
      <td><strong>${formatMoney(l.amount_requested)}</strong></td>
      <td>${l.purpose || '-'}</td>
      <td>${getStatusBadge(l.status)}</td>
      <td style="font-size:0.82rem;">${l.admin_comment || '-'}</td>
    </tr>
  `).join('');
}

function renderLoanEligibility(stats) {
  const container = document.getElementById('loanEligibilityInfo');
  if (stats.weekly_weeks >= 12) {
    container.innerHTML = `<div class="alert alert-success">
      <i class="fas fa-check-circle"></i> Eligible for loans up to <strong>${formatMoney(stats.weekly_total * 2)}</strong>
      (2x your <strong>${formatMoney(stats.weekly_total)}</strong> approved weekly savings). Only approved weekly savings count.
    </div>`;
  } else {
    container.innerHTML = `<div class="alert alert-warning">
      <i class="fas fa-exclamation-triangle"></i> You need <strong>12 weeks of admin-approved weekly savings</strong> to apply for a loan.
      You currently have <strong>${stats.weekly_weeks}</strong> approved weeks.
      ${stats.pending_count > 0 ? `<br><small>Note: ${stats.pending_count} pending payment(s) will count once admin approves them.</small>` : ''}
    </div>`;
  }
}

function renderMeetingCheckin(meetingsRes) {
  const container = document.getElementById('meetingCheckinContainer');
  const meeting = meetingsRes.active_meeting;
  if (meetingsRes.has_checked_in) {
    container.innerHTML = `<div class="card" style="border-left:4px solid var(--success);">
      <div class="card-header"><h2><i class="fas fa-check-circle"></i> Checked In</h2></div>
      <div class="alert alert-success">
        You have checked in for the meeting on ${formatDate(meeting?.meeting_date)}.
        ${meetingsRes.attendance?.payment_made ? `Payment of ${formatMoney(meetingsRes.attendance.payment_amount)} recorded.` : 'No payment made.'}
      </div></div>`;
    return;
  }
  if (!meeting) {
    container.innerHTML = `<div class="card"><div class="card-header"><h2><i class="fas fa-calendar-times"></i> No Active Meeting</h2></div>
      <div class="alert alert-info">No active Sunday meeting at the moment. Check back on Sunday!</div></div>`;
    return;
  }
  container.innerHTML = `
    <div class="card" style="border-left:4px solid var(--accent);">
      <div class="card-header">
        <h2><i class="fas fa-calendar-check"></i> Sunday Meeting Check-in</h2>
        <span class="badge badge-warning">Active</span>
      </div>
      <p style="margin-bottom:16px;">Meeting date: <strong>${formatDate(meeting.meeting_date)}</strong></p>
      <form id="checkinForm" style="display:grid;grid-template-columns:1fr 1fr auto;gap:16px;align-items:end;">
        <div class="form-group" style="margin-bottom:0;">
          <label>Meeting Code</label>
          <input type="text" name="meeting_code" required placeholder="Enter meeting code">
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label>Payment Amount (Naira)</label>
          <input type="number" name="payment_amount" placeholder="0" min="0">
        </div>
        <button type="submit" class="btn btn-primary"><i class="fas fa-check"></i> Check In</button>
      </form>
    </div>`;
  document.getElementById('checkinForm').addEventListener('submit', handleCheckin);
}

async function handleCheckin(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    const result = await apiCall('/members/checkin', 'POST', {
      meeting_code: data.meeting_code,
      payment_amount: parseFloat(data.payment_amount) || 0
    });
    showGlobalAlert(result.message, 'success');
    loadMemberDashboard();
  } catch (err) { showGlobalAlert(err.message, 'error'); }
}

function renderMeetingHistory(history) {
  const tbody = document.getElementById('meetingHistoryBody');
  if (!history || history.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-light);">No meeting attendance yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = history.map(h => `
    <tr>
      <td>${formatDate(h.meeting_date)}</td>
      <td>${h.meeting_code}</td>
      <td>${h.payment_made ? formatMoney(h.payment_amount) : '<span class="badge badge-pending">No payment</span>'}</td>
      <td>${formatDateFull(h.created_at)}</td>
    </tr>`).join('');
}

function renderProfile(user) {
  document.getElementById('profileInfo').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div><strong>Full Name:</strong><br>${user.full_name}</div>
      <div><strong>Email:</strong><br>${user.email}</div>
      <div><strong>Phone:</strong><br>${user.phone}</div>
      <div><strong>BVN:</strong><br>${user.bvn || '-'}</div>
      <div><strong>Credit Score:</strong><br>${user.credit_score || 'N/A'}</div>
      <div><strong>Reg. Fee:</strong><br>${user.registration_fee_paid ? '<span class="badge badge-success">Paid</span>' : '<span class="badge badge-danger">Not Paid</span>'}</div>
      <div><strong>Status:</strong><br>${getStatusBadge(user.status)}</div>
      <div><strong>Member Since:</strong><br>${formatDate(user.created_at)}</div>
    </div>`;
  const form = document.getElementById('profileForm');
  form.address.value = user.address || '';
  form.date_of_birth.value = user.date_of_birth || '';
  form.occupation.value = user.occupation || '';
  form.next_of_kin.value = user.next_of_kin || '';
  form.next_of_kin_phone.value = user.next_of_kin_phone || '';
}

// Savings form — submits as pending
document.getElementById('savingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  data.amount = parseFloat(data.amount);
  try {
    const result = await apiCall('/members/savings', 'POST', data);
    showGlobalAlert(result.message, 'success');
    e.target.reset();
    loadMemberDashboard();
  } catch (err) { showGlobalAlert(err.message, 'error'); }
});

document.getElementById('loanForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  data.amount_requested = parseFloat(data.amount_requested);
  try {
    const result = await apiCall('/members/loans', 'POST', data);
    showGlobalAlert(result.message, 'success');
    e.target.reset();
    loadMemberDashboard();
  } catch (err) { showGlobalAlert(err.message, 'error'); }
});

document.getElementById('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    await apiCall('/members/profile', 'PUT', data);
    showGlobalAlert('Profile updated successfully!', 'success');
  } catch (err) { showGlobalAlert(err.message, 'error'); }
});

function switchMemberTab(tabName, btn) {
  document.querySelectorAll('#memberDashboard .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#memberDashboard .tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('memberTab-' + tabName).classList.add('active');
}

// ============================================
// Admin Dashboard
// ============================================
async function loadAdminDashboard() {
  try {
    const [dashRes, loansRes, membersRes, meetingsRes, pendingSavingsRes] = await Promise.all([
      apiCall('/admin/dashboard'),
      apiCall('/admin/loans'),
      apiCall('/admin/members'),
      apiCall('/admin/meetings'),
      apiCall('/admin/savings/pending')
    ]);

    const s = dashRes.stats;
    document.getElementById('adminStats').innerHTML = `
      <div class="stat-card">
        <div class="label">Total Members</div>
        <div class="value">${s.total_members}</div>
        <div class="sub">${s.approved_members} approved, ${s.pending_members} pending registration</div>
      </div>
      <div class="stat-card accent">
        <div class="label">Total Approved Savings</div>
        <div class="value">${formatMoney(s.grand_total_savings)}</div>
        <div class="sub">Weekly: ${formatMoney(s.total_weekly_savings)} | Special: ${formatMoney(s.total_special_savings)}</div>
      </div>
      <div class="stat-card info">
        <div class="label">Available Funds</div>
        <div class="value">${formatMoney(s.available_funds)}</div>
        <div class="sub">After approved/in-progress loans</div>
      </div>
      <div class="stat-card ${s.pending_savings > 0 ? '' : ''}" style="border-left-color:var(--warning);">
        <div class="label"><i class="fas fa-clock"></i> Pending Savings</div>
        <div class="value">${s.pending_savings || 0}</div>
        <div class="sub">${formatMoney(s.pending_savings_amount || 0)} awaiting your approval</div>
      </div>
      <div class="stat-card ${s.pending_loans > 0 ? 'danger' : ''}">
        <div class="label">Pending Loans</div>
        <div class="value">${s.pending_loans}</div>
        <div class="sub">${formatMoney(s.pending_loans_amount)} requested</div>
      </div>
    `;

    renderAdminLoansTable(loansRes.loans);
    renderAdminMembersTable(membersRes.members);
    renderAdminMeetingsTable(meetingsRes.meetings);
    renderPendingSavingsTable(pendingSavingsRes.savings);
  } catch (err) {
    showGlobalAlert('Error loading admin dashboard: ' + err.message, 'error');
  }
}

// ---- Pending Savings Table (admin approves/rejects) ----
function renderPendingSavingsTable(savings) {
  const tbody = document.getElementById('adminPendingSavingsBody');
  if (!tbody) return;
  if (!savings || savings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-light);">
      <i class="fas fa-check-circle" style="font-size:2rem;color:var(--success);display:block;margin-bottom:8px;"></i>
      No pending payments. All caught up!</td></tr>`;
    return;
  }
  tbody.innerHTML = savings.map(s => `
    <tr>
      <td>${formatDate(s.created_at)}</td>
      <td><strong>${s.full_name}</strong><br><small>${s.phone}</small></td>
      <td>${s.type === 'weekly' ? '<span class="badge badge-info">Weekly</span>' : '<span class="badge badge-warning">Special</span>'}</td>
      <td>${s.week_number ? 'Week ' + s.week_number : '-'}</td>
      <td><strong>${formatMoney(s.amount)}</strong></td>
      <td>${s.note || '-'}</td>
      <td>
        <div class="flex gap-1">
          <button class="btn btn-primary btn-sm" onclick="approveSaving('${s.id}', 'approved', '${s.full_name}', ${s.amount})">
            <i class="fas fa-check"></i> Approve
          </button>
          <button class="btn btn-danger btn-sm" onclick="approveSaving('${s.id}', 'rejected', '${s.full_name}', ${s.amount})">
            <i class="fas fa-times"></i> Reject
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function approveSaving(savingId, status, memberName, amount) {
  const comment = status === 'rejected'
    ? prompt(`Reason for rejecting ${formatMoney(amount)} from ${memberName}? (optional)`) || ''
    : '';
  try {
    const result = await apiCall('/admin/savings/' + savingId, 'PUT', { status, admin_comment: comment });
    showGlobalAlert(result.message, status === 'approved' ? 'success' : 'warning');
    loadAdminDashboard();
  } catch (err) { showGlobalAlert(err.message, 'error'); }
}

function renderAdminLoansTable(loans) {
  const tbody = document.getElementById('adminLoanTableBody');
  if (!loans || loans.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-light);">No loan requests.</td></tr>`;
    return;
  }
  tbody.innerHTML = loans.map(l => `
    <tr>
      <td>${formatDate(l.created_at)}</td>
      <td>${l.full_name}</td>
      <td>${l.phone}</td>
      <td><strong>${formatMoney(l.amount_requested)}</strong></td>
      <td>${formatMoney(l.weekly_savings)}</td>
      <td>${l.weeks_saved} wks</td>
      <td>${getStatusBadge(l.status)}</td>
      <td><button class="btn btn-primary btn-sm" onclick="viewLoan('${l.id}')"><i class="fas fa-eye"></i> View</button></td>
    </tr>`).join('');
}

function renderAdminMembersTable(members) {
  const tbody = document.getElementById('adminMembersTableBody');
  if (!members || members.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-light);">No members yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = members.map(m => `
    <tr>
      <td>${m.full_name}</td>
      <td>${m.phone}</td>
      <td>${m.email}</td>
      <td>${m.credit_score || '-'}</td>
      <td>${formatMoney(m.weekly_savings)}</td>
      <td>${m.weeks_saved} wks</td>
      <td>${m.meetings_attended}</td>
      <td>${getStatusBadge(m.status)}</td>
      <td><button class="btn btn-primary btn-sm" onclick="viewMember('${m.id}')"><i class="fas fa-eye"></i> View</button></td>
    </tr>`).join('');
}

function renderAdminMeetingsTable(meetings) {
  const tbody = document.getElementById('adminMeetingsTableBody');
  if (!meetings || meetings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-light);">No meetings created yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = meetings.map(m => `
    <tr>
      <td>${formatDate(m.meeting_date)}</td>
      <td><strong>${m.meeting_code}</strong></td>
      <td>${m.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-pending">Closed</span>'}</td>
      <td>${m.attendance_count}</td>
      <td>${formatMoney(m.total_payments)}</td>
      <td><button class="btn btn-primary btn-sm" onclick="viewAttendance('${m.id}','${m.meeting_date}')"><i class="fas fa-list"></i> Attendance</button></td>
    </tr>`).join('');
}

async function loadAdminLoans() {
  try {
    const filter = document.getElementById('loanFilter').value;
    const result = await apiCall('/admin/loans' + (filter ? `?status=${filter}` : ''));
    renderAdminLoansTable(result.loans);
  } catch (err) { showGlobalAlert(err.message, 'error'); }
}

async function viewLoan(loanId) {
  try {
    const [loanRes, suggestionRes] = await Promise.all([
      apiCall('/admin/loans'),
      apiCall('/admin/loans/' + loanId + '/suggestion')
    ]);
    const loan = loanRes.loans.find(l => l.id === loanId);
    if (!loan) return;
    const sug = suggestionRes.suggestion;
    const scoreClass = sug.total_score >= 60 ? 'score-high' : sug.total_score >= 45 ? 'score-medium' : 'score-low';
    const recClass = sug.recommendation_level === 'accept' ? 'alert-success' :
                     sug.recommendation_level === 'in_progress' ? 'alert-warning' : 'alert-error';

    document.getElementById('loanModalTitle').textContent = 'Loan — ' + loan.full_name;
    document.getElementById('loanModalBody').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div><strong>Amount:</strong> ${formatMoney(loan.amount_requested)}</div>
        <div><strong>Date:</strong> ${formatDate(loan.created_at)}</div>
        <div><strong>Purpose:</strong> ${loan.purpose || '-'}</div>
        <div><strong>Status:</strong> ${getStatusBadge(loan.status)}</div>
        <div><strong>Credit Score:</strong> ${loan.credit_score}</div>
        <div><strong>Approved Weekly Savings:</strong> ${formatMoney(loan.weekly_savings)}</div>
        <div><strong>Approved Weeks:</strong> ${loan.weeks_saved}</div>
        <div><strong>Meetings Attended:</strong> ${loan.meetings_attended}</div>
      </div>
      <h3 style="color:var(--primary);margin-bottom:12px;"><i class="fas fa-lightbulb"></i> AI Suggestion</h3>
      <div style="text-align:center;margin-bottom:12px;">
        <div class="score-circle ${scoreClass}" style="display:inline-flex;align-items:center;justify-content:center;width:80px;height:80px;border-radius:50%;font-size:1.8rem;font-weight:700;">${sug.total_score}</div>
        <p style="color:var(--text-light);margin-top:4px;">out of 100</p>
      </div>
      <div class="alert ${recClass}">${sug.recommendation}</div>
      <h4 style="margin:16px 0 8px;">Scoring Factors:</h4>
      <ul class="factor-list">
        ${sug.factors.map(f => `<li>
          <div><div class="factor-name">${f.factor}</div><div style="font-size:0.8rem;color:var(--text-light);">${f.detail}</div></div>
          <div class="factor-bar"><div class="factor-bar-fill" style="width:${(f.points/f.max_points)*100}%"></div></div>
          <div class="factor-points">${f.points}/${f.max_points}</div>
        </li>`).join('')}
      </ul>
      <div class="alert alert-info" style="margin-top:12px;">
        <strong>Cooperative Funds:</strong> ${formatMoney(sug.cooperative_funds.available_funds)} available
        ${sug.can_afford ? '✓ Sufficient' : '✗ Insufficient for this loan'}
      </div>
      ${loan.status === 'pending' ? `
        <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:20px;">
          <h4 style="margin-bottom:12px;">Take Action</h4>
          <div class="form-group">
            <label>Comment for member</label>
            <textarea id="loanComment" rows="2" placeholder="Add a comment...">${loan.admin_comment || ''}</textarea>
          </div>
          <div class="flex gap-2 flex-wrap">
            <button class="btn btn-primary" onclick="updateLoanStatus('${loanId}','approved')"><i class="fas fa-check"></i> Accept</button>
            <button class="btn btn-accent" onclick="updateLoanStatus('${loanId}','in_progress')"><i class="fas fa-clock"></i> In Progress</button>
            <button class="btn btn-danger" onclick="updateLoanStatus('${loanId}','rejected')"><i class="fas fa-times"></i> Reject</button>
          </div>
        </div>` : `
        <div class="alert ${loan.status === 'approved' ? 'alert-success' : loan.status === 'rejected' ? 'alert-error' : 'alert-warning'}" style="margin-top:16px;">
          <strong>Admin Comment:</strong> ${loan.admin_comment || 'No comment'}
        </div>`}
    `;
    document.getElementById('loanModal').classList.add('active');
  } catch (err) { showGlobalAlert(err.message, 'error'); }
}

async function updateLoanStatus(loanId, status) {
  const comment = document.getElementById('loanComment')?.value || '';
  try {
    const result = await apiCall('/admin/loans/' + loanId, 'PUT', { status, admin_comment: comment });
    showGlobalAlert(result.message, 'success');
    closeModal('loanModal');
    loadAdminDashboard();
  } catch (err) { showGlobalAlert(err.message, 'error'); }
}

async function viewMember(memberId) {
  try {
    const result = await apiCall('/admin/members/' + memberId);
    const m = result.member;
    const s = result.savings_summary;
    document.getElementById('memberModalTitle').textContent = m.full_name;
    document.getElementById('memberModalBody').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div><strong>Email:</strong><br>${m.email}</div>
        <div><strong>Phone:</strong><br>${m.phone}</div>
        <div><strong>BVN:</strong><br>${m.bvn || '-'}</div>
        <div><strong>Credit Score:</strong><br>${m.credit_score || '-'}</div>
        <div><strong>Occupation:</strong><br>${m.occupation || '-'}</div>
        <div><strong>Address:</strong><br>${m.address || '-'}</div>
        <div><strong>Date of Birth:</strong><br>${formatDate(m.date_of_birth)}</div>
        <div><strong>Status:</strong><br>${getStatusBadge(m.status)}</div>
        <div><strong>Next of Kin:</strong><br>${m.next_of_kin || '-'}</div>
        <div><strong>NOK Phone:</strong><br>${m.next_of_kin_phone || '-'}</div>
      </div>
      <h3 style="color:var(--primary);margin-bottom:12px;">Savings Summary</h3>
      <div class="stats-grid" style="margin-bottom:16px;">
        <div class="stat-card"><div class="label">Approved Weekly</div><div class="value">${formatMoney(s.weekly_total)}</div><div class="sub">${s.weekly_weeks} weeks</div></div>
        <div class="stat-card accent"><div class="label">Approved Special</div><div class="value">${formatMoney(s.special_total)}</div></div>
        <div class="stat-card info"><div class="label">Total Approved</div><div class="value">${formatMoney(s.grand_total)}</div></div>
        <div class="stat-card" style="border-left-color:var(--warning);"><div class="label">Pending Approval</div><div class="value">${formatMoney(s.pending_total || 0)}</div><div class="sub">${s.pending_count || 0} entries</div></div>
        <div class="stat-card ${s.meets_12_week_requirement ? '' : 'danger'}"><div class="label">Max Loan</div><div class="value">${formatMoney(s.max_loan_eligible)}</div><div class="sub">${s.meets_12_week_requirement ? '✓ Eligible' : '✗ Need 12 weeks'}</div></div>
      </div>
      <h3 style="color:var(--primary);margin-bottom:8px;">All Savings</h3>
      <div class="table-container" style="margin-bottom:16px;">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Week</th><th>Amount</th><th>Status</th><th>Note</th></tr></thead>
          <tbody>
            ${result.savings.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-light);">No savings yet</td></tr>' :
              result.savings.map(sv => `<tr>
                <td>${formatDate(sv.created_at)}</td>
                <td>${sv.type === 'weekly' ? '<span class="badge badge-info">Weekly</span>' : '<span class="badge badge-warning">Special</span>'}</td>
                <td>${sv.week_number ? 'Week ' + sv.week_number : '-'}</td>
                <td>${formatMoney(sv.amount)}</td>
                <td>${getSavingsBadge(sv.status)}</td>
                <td style="font-size:0.82rem;">${sv.note || '-'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <h3 style="color:var(--primary);margin-bottom:8px;">Loan History</h3>
      <div class="table-container" style="margin-bottom:16px;">
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>Purpose</th><th>Status</th><th>Comment</th></tr></thead>
          <tbody>
            ${result.loans.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:var(--text-light);">No loans</td></tr>' :
              result.loans.map(l => `<tr>
                <td>${formatDate(l.created_at)}</td>
                <td>${formatMoney(l.amount_requested)}</td>
                <td>${l.purpose || '-'}</td>
                <td>${getStatusBadge(l.status)}</td>
                <td style="font-size:0.82rem;">${l.admin_comment || '-'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <h3 style="color:var(--primary);margin-bottom:8px;">Meeting Attendance</h3>
      <div class="table-container">
        <table>
          <thead><tr><th>Date</th><th>Code</th><th>Payment</th></tr></thead>
          <tbody>
            ${result.attendance.length === 0 ? '<tr><td colspan="3" style="text-align:center;color:var(--text-light);">No attendance</td></tr>' :
              result.attendance.map(a => `<tr>
                <td>${formatDate(a.meeting_date)}</td>
                <td>${a.meeting_code}</td>
                <td>${a.payment_made ? formatMoney(a.payment_amount) : '-'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${m.status === 'pending' ? `
        <div class="flex gap-2 mt-3">
          <button class="btn btn-primary" onclick="updateMemberStatus('${m.id}','approved')"><i class="fas fa-check"></i> Approve Member</button>
          <button class="btn btn-danger" onclick="updateMemberStatus('${m.id}','rejected')"><i class="fas fa-times"></i> Reject Member</button>
        </div>` : ''}
    `;
    document.getElementById('memberModal').classList.add('active');
  } catch (err) { showGlobalAlert(err.message, 'error'); }
}

async function updateMemberStatus(memberId, status) {
  try {
    await apiCall('/admin/members/' + memberId + '/status', 'PUT', { status });
    showGlobalAlert('Member status updated to ' + status, 'success');
    closeModal('memberModal');
    loadAdminDashboard();
  } catch (err) { showGlobalAlert(err.message, 'error'); }
}

async function viewAttendance(meetingId, meetingDate) {
  try {
    const result = await apiCall('/admin/meetings/' + meetingId + '/attendance');
    document.getElementById('attendanceModalTitle').textContent = 'Attendance — ' + formatDate(meetingDate);
    document.getElementById('attendanceModalBody').innerHTML = `
      <div class="table-container">
        <table>
          <thead><tr><th>Member</th><th>Phone</th><th>Payment</th><th>Time</th></tr></thead>
          <tbody>
            ${result.attendance.length === 0
              ? '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-light);">No check-ins yet.</td></tr>'
              : result.attendance.map(a => `<tr>
                  <td>${a.full_name}</td><td>${a.phone}</td>
                  <td>${a.payment_made ? formatMoney(a.payment_amount) : '<span class="badge badge-pending">No payment</span>'}</td>
                  <td>${formatDateFull(a.created_at)}</td>
                </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    document.getElementById('attendanceModal').classList.add('active');
  } catch (err) { showGlobalAlert(err.message, 'error'); }
}

document.getElementById('meetingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  try {
    const result = await apiCall('/admin/meetings', 'POST', data);
    showGlobalAlert('Meeting created! Code: ' + result.meeting.meeting_code, 'success');
    e.target.reset();
    loadAdminDashboard();
  } catch (err) { showGlobalAlert(err.message, 'error'); }
});

function switchAdminTab(tabName, btn) {
  document.querySelectorAll('#adminDashboard .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#adminDashboard .tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('adminTab-' + tabName).classList.add('active');
  if (tabName === 'suggestions') loadAllSuggestions();
}

async function loadAllSuggestions() {
  try {
    const result = await apiCall('/admin/loans/suggestions/all');
    const s = result.summary;
    document.getElementById('suggestionsSummary').innerHTML = `
      <div class="stats-grid mb-3">
        <div class="stat-card"><div class="label">Pending Loans</div><div class="value">${s.total_pending}</div></div>
        <div class="stat-card"><div class="label">Suggest Accept</div><div class="value">${s.accept}</div><div class="sub">${formatMoney(s.total_acceptable_amount)}</div></div>
        <div class="stat-card accent"><div class="label">Suggest Hold</div><div class="value">${s.hold}</div></div>
        <div class="stat-card danger"><div class="label">Suggest Reject</div><div class="value">${s.reject}</div></div>
        <div class="stat-card info"><div class="label">Available Funds</div><div class="value">${formatMoney(s.available_funds)}</div><div class="sub">After: ${formatMoney(s.remaining_after_acceptance)}</div></div>
      </div>
      <div class="alert alert-info mb-3">Suggestions based on credit scores, approved savings, meeting attendance, loan history and available funds.</div>`;
    if (!result.suggestions.length) {
      document.getElementById('suggestionsList').innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-light);">No pending loans to review.</div>`;
      return;
    }
    document.getElementById('suggestionsList').innerHTML = result.suggestions.map(s => {
      const sc = s.score >= 60 ? 'score-high' : s.score >= 45 ? 'score-medium' : 'score-low';
      const ab = s.action === 'accept' ? 'badge-success' : s.action === 'hold' ? 'badge-warning' : 'badge-danger';
      return `<div class="card" style="display:flex;align-items:center;gap:16px;">
        <div class="score-circle ${sc}" style="width:60px;height:60px;font-size:1.2rem;font-weight:700;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${s.score}</div>
        <div style="flex:1;">
          <div class="flex-between mb-1"><strong>${s.member_name}</strong><span class="badge ${ab}">${s.action.toUpperCase()}</span></div>
          <div style="font-size:0.82rem;color:var(--text-light);">
            ${formatMoney(s.amount)} requested | Credit: ${s.credit_score} | ${s.weeks_saved} approved weeks | Savings: ${formatMoney(s.weekly_savings)}
            ${!s.can_afford ? ' | <span style="color:var(--danger);">Insufficient funds</span>' : ''}
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="viewLoan('${s.loan_id}')"><i class="fas fa-eye"></i> Review</button>
      </div>`;
    }).join('');
  } catch (err) { showGlobalAlert(err.message, 'error'); }
}

// ============================================
// Initialize
// ============================================
updateNavLinks();
if (currentUser && authToken) {
  if (currentUser.role === 'admin') {
    showPage('adminDashboard');
    loadAdminDashboard();
  } else if (currentUser.registration_fee_paid) {
    showPage('memberDashboard');
    loadMemberDashboard();
  } else {
    showPage('regFeePage');
  }
}
