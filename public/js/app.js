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
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (authToken) {
    options.headers['Authorization'] = `Bearer ${authToken}`;
  }

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, options);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || data.message || 'An error occurred');
    }

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
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateFull(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-NG', { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' });
}

function showAlert(containerId, message, type = 'error') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
  setTimeout(() => {
    if (container.innerHTML.includes(message)) {
      container.innerHTML = '';
    }
  }, 5000);
}

function showGlobalAlert(message, type = 'error') {
  const container = document.getElementById('alertContainer');
  const alert = document.getElementById('globalAlert');
  alert.className = `alert alert-${type}`;
  alert.innerHTML = message;
  container.style.display = 'block';
  setTimeout(() => {
    container.style.display = 'none';
  }, 5000);
}

function getStatusBadge(status) {
  const badges = {
    pending: '<span class="badge badge-pending">Pending</span>',
    approved: '<span class="badge badge-success">Approved</span>',
    in_progress: '<span class="badge badge-warning">In Progress</span>',
    rejected: '<span class="badge badge-danger">Rejected</span>'
  };
  return badges[status] || status;
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

// ============================================
// Page Navigation
// ============================================
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  window.scrollTo(0, 0);
}

function updateNavLinks() {
  const navLinks = document.getElementById('navLinks');

  if (!currentUser) {
    navLinks.innerHTML = `
      <button onclick="showPage('landingPage')">Home</button>
      <button onclick="showPage('loginPage')">Login</button>
      <button onclick="showPage('registerPage')">Register</button>
    `;
  } else if (currentUser.role === 'admin') {
    navLinks.innerHTML = `
      <button onclick="showPage('adminDashboard')"><i class="fas fa-tachometer-alt"></i> Dashboard</button>
      <button onclick="logout()"><i class="fas fa-sign-out-alt"></i> Logout</button>
    `;
  } else {
    navLinks.innerHTML = `
      <button onclick="showPage('memberDashboard')"><i class="fas fa-tachometer-alt"></i> Dashboard</button>
      <button onclick="logout()"><i class="fas fa-sign-out-alt"></i> Logout</button>
    `;
  }
}

// ============================================
// Authentication
// ============================================

// Register form handler
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());

  try {
    const result = await apiCall('/auth/register', 'POST', data);

    if (!result.eligible) {
      showAlert('registerAlert', result.message, 'error');
      return;
    }

    // Save token and user
    authToken = result.token;
    currentUser = result.user;
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));

    // Show registration fee page
    showPage('regFeePage');
    updateNavLinks();
    showGlobalAlert('Registration successful! Please complete your payment.', 'success');
  } catch (err) {
    showAlert('registerAlert', err.message, 'error');
  }
});

// Login form handler
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());

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
    } else {
      if (!currentUser.registration_fee_paid) {
        showPage('regFeePage');
      } else {
        showPage('memberDashboard');
        loadMemberDashboard();
      }
    }
    showGlobalAlert('Welcome back, ' + currentUser.full_name + '!', 'success');
  } catch (err) {
    showAlert('loginAlert', err.message, 'error');
  }
});

// Pay registration fee
async function payRegistrationFee() {
  try {
    const result = await apiCall('/auth/pay-registration', 'POST', { payment_ref: 'manual_' + Date.now() });

    currentUser.registration_fee_paid = true;
    currentUser.status = 'approved';
    localStorage.setItem('currentUser', JSON.stringify(currentUser));

    showGlobalAlert(result.message, 'success');

    if (currentUser.role === 'admin') {
      showPage('adminDashboard');
      loadAdminDashboard();
    } else {
      showPage('memberDashboard');
      loadMemberDashboard();
    }
  } catch (err) {
    showGlobalAlert(err.message, 'error');
  }
}

// Logout
function logout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
  updateNavLinks();
  showPage('landingPage');
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

    // Welcome text
    document.getElementById('memberWelcome').textContent =
      `Welcome, ${profileRes.user.full_name} | Credit Score: ${profileRes.user.credit_score || 'N/A'}`;

    // Stats
    const stats = profileRes.savings_summary;
    document.getElementById('memberStats').innerHTML = `
      <div class="stat-card">
        <div class="label">Weekly Savings</div>
        <div class="value">${formatMoney(stats.weekly_total)}</div>
        <div class="sub">${stats.weekly_weeks} weeks</div>
      </div>
      <div class="stat-card accent">
        <div class="label">Special Savings</div>
        <div class="value">${formatMoney(stats.special_total)}</div>
        <div class="sub">Not counted for loans</div>
      </div>
      <div class="stat-card info">
        <div class="label">Total Savings</div>
        <div class="value">${formatMoney(stats.grand_total)}</div>
        <div class="sub">All savings combined</div>
      </div>
      <div class="stat-card ${stats.weekly_weeks >= 12 ? '' : 'danger'}">
        <div class="label">Loan Eligibility</div>
        <div class="value">${formatMoney(stats.weekly_total * 2)}</div>
        <div class="sub">${stats.weekly_weeks >= 12 ? 'Eligible (12+ weeks)' : stats.weekly_weeks + '/12 weeks needed'}</div>
      </div>
    `;

    // Savings table
    renderSavingsTable(savingsRes.savings);

    // Savings form (reset)
    document.getElementById('savingsForm').reset();

    // Loans
    renderLoansTable(loansRes.loans);
    renderLoanEligibility(stats);

    // Meetings
    renderMeetingCheckin(meetingsRes);
    renderMeetingHistory(meetingsRes.history);

    // Profile
    renderProfile(profileRes.user);

  } catch (err) {
    showGlobalAlert('Error loading dashboard: ' + err.message, 'error');
  }
}

function renderSavingsTable(savings) {
  const tbody = document.getElementById('savingsTableBody');
  if (!savings || savings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><div class="icon"><i class="fas fa-piggy-bank"></i></div>No savings yet. Add your first contribution above!</td></tr>';
    return;
  }
  tbody.innerHTML = savings.map(s => `
    <tr>
      <td>${formatDateFull(s.created_at)}</td>
      <td>${s.type === 'weekly' ? '<span class="badge badge-info">Weekly</span>' : '<span class="badge badge-warning">Special</span>'}</td>
      <td>${s.week_number ? 'Week ' + s.week_number : '-'}</td>
      <td><strong>${formatMoney(s.amount)}</strong></td>
      <td>${s.note || '-'}</td>
    </tr>
  `).join('');
}

function renderLoansTable(loans) {
  const tbody = document.getElementById('loanTableBody');
  if (!loans || loans.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><div class="icon"><i class="fas fa-hand-holding-usd"></i></div>No loan applications yet.</td></tr>';
    return;
  }
  tbody.innerHTML = loans.map(l => `
    <tr>
      <td>${formatDate(l.created_at)}</td>
      <td><strong>${formatMoney(l.amount_requested)}</strong></td>
      <td>${l.purpose || '-'}</td>
      <td>${getStatusBadge(l.status)}</td>
      <td>${l.admin_comment || '-'}</td>
    </tr>
  `).join('');
}

function renderLoanEligibility(stats) {
  const container = document.getElementById('loanEligibilityInfo');
  const eligible = stats.weekly_weeks >= 12;
  container.innerHTML = eligible
    ? `<div class="alert alert-success"><i class="fas fa-check-circle"></i> You are eligible for loans up to <strong>${formatMoney(stats.weekly_total * 2)}</strong> (2x your weekly savings of ${formatMoney(stats.weekly_total)}). Only weekly savings count towards loan calculation.</div>`
    : `<div class="alert alert-warning"><i class="fas fa-exclamation-triangle"></i> You need at least 12 weeks of weekly savings to apply for a loan. You currently have <strong>${stats.weekly_weeks}</strong> weeks. Keep saving!</div>`;
}

function renderMeetingCheckin(meetingsRes) {
  const container = document.getElementById('meetingCheckinContainer');
  const meeting = meetingsRes.active_meeting;

  if (meetingsRes.has_checked_in) {
    container.innerHTML = `
      <div class="card" style="border-left:4px solid var(--success);">
        <div class="card-header"><h2><i class="fas fa-check-circle"></i> Checked In</h2></div>
        <div class="alert alert-success">
          You have checked in for the meeting on ${formatDate(meeting.meeting_date)}.
          ${meetingsRes.attendance && meetingsRes.attendance.payment_made ? `Payment of ${formatMoney(meetingsRes.attendance.payment_amount)} recorded.` : 'No payment was made.'}
        </div>
      </div>
    `;
    return;
  }

  if (!meeting) {
    container.innerHTML = `
      <div class="card">
        <div class="card-header"><h2><i class="fas fa-calendar-times"></i> No Active Meeting</h2></div>
        <div class="alert alert-info">There is no active Sunday meeting at the moment. Check back on Sunday!</div>
      </div>
    `;
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
    </div>
  `;

  document.getElementById('checkinForm').addEventListener('submit', handleCheckin);
}

async function handleCheckin(e) {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());

  try {
    const result = await apiCall('/members/checkin', 'POST', {
      meeting_code: data.meeting_code,
      payment_amount: parseFloat(data.payment_amount) || 0
    });
    showGlobalAlert(result.message, 'success');
    loadMemberDashboard();
  } catch (err) {
    showGlobalAlert(err.message, 'error');
  }
}

function renderMeetingHistory(history) {
  const tbody = document.getElementById('meetingHistoryBody');
  if (!history || history.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state"><div class="icon"><i class="fas fa-calendar"></i></div>No meeting attendance yet.</td></tr>';
    return;
  }
  tbody.innerHTML = history.map(h => `
    <tr>
      <td>${formatDate(h.meeting_date)}</td>
      <td>${h.meeting_code}</td>
      <td>${h.payment_made ? formatMoney(h.payment_amount) : '<span class="badge badge-pending">No payment</span>'}</td>
      <td>${formatDateFull(h.created_at)}</td>
    </tr>
  `).join('');
}

function renderProfile(user) {
  const container = document.getElementById('profileInfo');
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div><strong>Full Name:</strong><br>${user.full_name}</div>
      <div><strong>Email:</strong><br>${user.email}</div>
      <div><strong>Phone:</strong><br>${user.phone}</div>
      <div><strong>BVN:</strong><br>${user.bvn || '-'}</div>
      <div><strong>Credit Score:</strong><br>${user.credit_score || 'N/A'}</div>
      <div><strong>Registration Fee:</strong><br>${user.registration_fee_paid ? '<span class="badge badge-success">Paid</span>' : '<span class="badge badge-danger">Not Paid</span>'}</div>
      <div><strong>Status:</strong><br>${getStatusBadge(user.status)}</div>
      <div><strong>Member Since:</strong><br>${formatDate(user.created_at)}</div>
    </div>
  `;

  // Pre-fill form
  const form = document.getElementById('profileForm');
  form.address.value = user.address || '';
  form.date_of_birth.value = user.date_of_birth || '';
  form.occupation.value = user.occupation || '';
  form.next_of_kin.value = user.next_of_kin || '';
  form.next_of_kin_phone.value = user.next_of_kin_phone || '';
}

// Savings form handler
document.getElementById('savingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());
  data.amount = parseFloat(data.amount);

  try {
    await apiCall('/members/savings', 'POST', data);
    showGlobalAlert('Savings added successfully!', 'success');
    e.target.reset();
    loadMemberDashboard();
  } catch (err) {
    showGlobalAlert(err.message, 'error');
  }
});

// Loan form handler
document.getElementById('loanForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());
  data.amount_requested = parseFloat(data.amount_requested);

  try {
    const result = await apiCall('/members/loans', 'POST', data);
    showGlobalAlert(result.message, 'success');
    e.target.reset();
    loadMemberDashboard();
  } catch (err) {
    showGlobalAlert(err.message, 'error');
  }
});

// Profile form handler
document.getElementById('profileForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());

  try {
    await apiCall('/members/profile', 'PUT', data);
    showGlobalAlert('Profile updated successfully!', 'success');
  } catch (err) {
    showGlobalAlert(err.message, 'error');
  }
});

// Member tab switching
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
    const [dashRes, loansRes, membersRes, meetingsRes] = await Promise.all([
      apiCall('/admin/dashboard'),
      apiCall('/admin/loans'),
      apiCall('/admin/members'),
      apiCall('/admin/meetings')
    ]);

    // Stats
    const s = dashRes.stats;
    document.getElementById('adminStats').innerHTML = `
      <div class="stat-card">
        <div class="label">Total Members</div>
        <div class="value">${s.total_members}</div>
        <div class="sub">${s.approved_members} approved, ${s.pending_members} pending</div>
      </div>
      <div class="stat-card accent">
        <div class="label">Total Savings</div>
        <div class="value">${formatMoney(s.grand_total_savings)}</div>
        <div class="sub">Weekly: ${formatMoney(s.total_weekly_savings)} | Special: ${formatMoney(s.total_special_savings)}</div>
      </div>
      <div class="stat-card info">
        <div class="label">Available Funds</div>
        <div class="value">${formatMoney(s.available_funds)}</div>
        <div class="sub">After approved/in-progress loans</div>
      </div>
      <div class="stat-card ${s.pending_loans > 0 ? 'danger' : ''}">
        <div class="label">Pending Loans</div>
        <div class="value">${s.pending_loans}</div>
        <div class="sub">${formatMoney(s.pending_loans_amount)} requested</div>
      </div>
    `;

    // Loans
    renderAdminLoansTable(loansRes.loans);

    // Members
    renderAdminMembersTable(membersRes.members);

    // Meetings
    renderAdminMeetingsTable(meetingsRes.meetings);

  } catch (err) {
    showGlobalAlert('Error loading admin dashboard: ' + err.message, 'error');
  }
}

function renderAdminLoansTable(loans) {
  const tbody = document.getElementById('adminLoanTableBody');
  if (!loans || loans.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><div class="icon"><i class="fas fa-file-alt"></i></div>No loan requests.</td></tr>';
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
      <td>
        <button class="btn btn-primary btn-sm" onclick="viewLoan('${l.id}')">
          <i class="fas fa-eye"></i> View
        </button>
      </td>
    </tr>
  `).join('');
}

function renderAdminMembersTable(members) {
  const tbody = document.getElementById('adminMembersTableBody');
  if (!members || members.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><div class="icon"><i class="fas fa-users"></i></div>No members registered yet.</td></tr>';
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
      <td>
        <button class="btn btn-primary btn-sm" onclick="viewMember('${m.id}')">
          <i class="fas fa-eye"></i> View
        </button>
      </td>
    </tr>
  `).join('');
}

function renderAdminMeetingsTable(meetings) {
  const tbody = document.getElementById('adminMeetingsTableBody');
  if (!meetings || meetings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><div class="icon"><i class="fas fa-calendar"></i></div>No meetings created yet.</td></tr>';
    return;
  }
  tbody.innerHTML = meetings.map(m => `
    <tr>
      <td>${formatDate(m.meeting_date)}</td>
      <td><strong>${m.meeting_code}</strong></td>
      <td>${m.is_active ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-pending">Closed</span>'}</td>
      <td>${m.attendance_count}</td>
      <td>${formatMoney(m.total_payments)}</td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="viewAttendance('${m.id}', '${m.meeting_date}')">
          <i class="fas fa-list"></i> Attendance
        </button>
      </td>
    </tr>
  `).join('');
}

// Load admin loans with filter
async function loadAdminLoans() {
  try {
    const filter = document.getElementById('loanFilter').value;
    const result = await apiCall('/admin/loans' + (filter ? `?status=${filter}` : ''));
    renderAdminLoansTable(result.loans);
  } catch (err) {
    showGlobalAlert(err.message, 'error');
  }
}

// View loan details with suggestion
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

    document.getElementById('loanModalTitle').textContent = 'Loan - ' + loan.full_name;
    document.getElementById('loanModalBody').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div><strong>Amount:</strong> ${formatMoney(loan.amount_requested)}</div>
        <div><strong>Date:</strong> ${formatDate(loan.created_at)}</div>
        <div><strong>Purpose:</strong> ${loan.purpose || '-'}</div>
        <div><strong>Status:</strong> ${getStatusBadge(loan.status)}</div>
        <div><strong>Credit Score:</strong> ${loan.credit_score}</div>
        <div><strong>Weekly Savings:</strong> ${formatMoney(loan.weekly_savings)}</div>
        <div><strong>Weeks Saved:</strong> ${loan.weeks_saved}</div>
        <div><strong>Meetings Attended:</strong> ${loan.meetings_attended}</div>
        <div><strong>Rejected Loans:</strong> ${loan.rejected_loans_count}</div>
        <div><strong>Completed Loans:</strong> ${loan.completed_loans_count}</div>
      </div>

      <h3 style="color:var(--primary);margin-bottom:12px;"><i class="fas fa-lightbulb"></i> AI Suggestion</h3>
      <div class="score-display">
        <div class="score-circle ${scoreClass}">${sug.total_score}</div>
        <p style="color:var(--text-light);">out of 100</p>
      </div>
      <div class="alert ${recClass}">${sug.recommendation}</div>

      <h4 style="margin:16px 0 8px;">Scoring Factors:</h4>
      <ul class="factor-list">
        ${sug.factors.map(f => `
          <li>
            <div>
              <div class="factor-name">${f.factor}</div>
              <div style="font-size:0.8rem;color:var(--text-light);">${f.detail}</div>
            </div>
            <div class="factor-bar"><div class="factor-bar-fill" style="width:${(f.points/f.max_points)*100}%"></div></div>
            <div class="factor-points">${f.points}/${f.max_points}</div>
          </li>
        `).join('')}
      </ul>

      <div class="alert alert-info" style="margin-top:16px;">
        <strong>Cooperative Funds:</strong> ${formatMoney(sug.cooperative_funds.available_funds)} available
        ${sug.can_afford ? '(sufficient)' : '(insufficient for this loan)'}
      </div>

      ${loan.status === 'pending' ? `
        <div style="margin-top:20px;border-top:1px solid var(--border);padding-top:20px;">
          <h4 style="margin-bottom:12px;">Take Action</h4>
          <div class="form-group">
            <label>Comment</label>
            <textarea id="loanComment" rows="2" placeholder="Add a comment for the member">${loan.admin_comment || ''}</textarea>
          </div>
          <div class="flex gap-2 flex-wrap">
            <button class="btn btn-primary" onclick="updateLoanStatus('${loanId}', 'approved')">
              <i class="fas fa-check"></i> Accept
            </button>
            <button class="btn btn-accent" onclick="updateLoanStatus('${loanId}', 'in_progress')">
              <i class="fas fa-clock"></i> In Progress
            </button>
            <button class="btn btn-danger" onclick="updateLoanStatus('${loanId}', 'rejected')">
              <i class="fas fa-times"></i> Reject
            </button>
          </div>
        </div>
      ` : `
        <div class="alert ${loan.status === 'approved' ? 'alert-success' : loan.status === 'rejected' ? 'alert-error' : 'alert-warning'}" style="margin-top:16px;">
          <strong>Admin Comment:</strong> ${loan.admin_comment || 'No comment provided'}
        </div>
      `}
    `;

    document.getElementById('loanModal').classList.add('active');
  } catch (err) {
    showGlobalAlert(err.message, 'error');
  }
}

// Update loan status
async function updateLoanStatus(loanId, status) {
  const comment = document.getElementById('loanComment')?.value || '';
  try {
    const result = await apiCall('/admin/loans/' + loanId, 'PUT', {
      status,
      admin_comment: comment
    });
    showGlobalAlert(result.message, 'success');
    closeModal('loanModal');
    loadAdminDashboard();
  } catch (err) {
    showGlobalAlert(err.message, 'error');
  }
}

// View member details
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
      <div class="stats-grid" style="margin-bottom:20px;">
        <div class="stat-card">
          <div class="label">Weekly Savings</div>
          <div class="value">${formatMoney(s.weekly_total)}</div>
          <div class="sub">${s.weekly_weeks} weeks</div>
        </div>
        <div class="stat-card accent">
          <div class="label">Special Savings</div>
          <div class="value">${formatMoney(s.special_total)}</div>
        </div>
        <div class="stat-card info">
          <div class="label">Total Savings</div>
          <div class="value">${formatMoney(s.grand_total)}</div>
        </div>
        <div class="stat-card ${s.meets_12_week_requirement ? '' : 'danger'}">
          <div class="label">Max Loan Eligible</div>
          <div class="value">${formatMoney(s.max_loan_eligible)}</div>
          <div class="sub">${s.meets_12_week_requirement ? 'Eligible' : 'Not eligible (need 12 weeks)'}</div>
        </div>
      </div>

      <h3 style="color:var(--primary);margin-bottom:12px;">Loan History</h3>
      <div class="table-container mb-3">
        <table>
          <thead><tr><th>Date</th><th>Amount</th><th>Purpose</th><th>Status</th><th>Comment</th></tr></thead>
          <tbody>
            ${result.loans.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:var(--text-light);">No loans</td></tr>' :
              result.loans.map(l => `<tr>
                <td>${formatDate(l.created_at)}</td>
                <td>${formatMoney(l.amount_requested)}</td>
                <td>${l.purpose || '-'}</td>
                <td>${getStatusBadge(l.status)}</td>
                <td>${l.admin_comment || '-'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <h3 style="color:var(--primary);margin-bottom:12px;">Meeting Attendance</h3>
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
          <button class="btn btn-primary" onclick="updateMemberStatus('${memberId}', 'approved')">
            <i class="fas fa-check"></i> Approve Member
          </button>
          <button class="btn btn-danger" onclick="updateMemberStatus('${memberId}', 'rejected')">
            <i class="fas fa-times"></i> Reject Member
          </button>
        </div>
      ` : ''}
    `;

    document.getElementById('memberModal').classList.add('active');
  } catch (err) {
    showGlobalAlert(err.message, 'error');
  }
}

// Update member status
async function updateMemberStatus(memberId, status) {
  try {
    await apiCall('/admin/members/' + memberId + '/status', 'PUT', { status });
    showGlobalAlert('Member status updated to ' + status, 'success');
    closeModal('memberModal');
    loadAdminDashboard();
  } catch (err) {
    showGlobalAlert(err.message, 'error');
  }
}

// View meeting attendance
async function viewAttendance(meetingId, meetingDate) {
  try {
    const result = await apiCall('/admin/meetings/' + meetingId + '/attendance');
    document.getElementById('attendanceModalTitle').textContent = 'Attendance - ' + formatDate(meetingDate);
    document.getElementById('attendanceModalBody').innerHTML = `
      <div class="table-container">
        <table>
          <thead>
            <tr><th>Member</th><th>Phone</th><th>Payment</th><th>Time</th></tr>
          </thead>
          <tbody>
            ${result.attendance.length === 0 ?
              '<tr><td colspan="4" class="empty-state"><div class="icon"><i class="fas fa-users"></i></div>No one has checked in yet.</td></tr>' :
              result.attendance.map(a => `<tr>
                <td>${a.full_name}</td>
                <td>${a.phone}</td>
                <td>${a.payment_made ? formatMoney(a.payment_amount) : '<span class="badge badge-pending">No payment</span>'}</td>
                <td>${formatDateFull(a.created_at)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `;
    document.getElementById('attendanceModal').classList.add('active');
  } catch (err) {
    showGlobalAlert(err.message, 'error');
  }
}

// Meeting form handler
document.getElementById('meetingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());

  try {
    const result = await apiCall('/admin/meetings', 'POST', data);
    showGlobalAlert('Meeting created! Code: ' + result.meeting.meeting_code, 'success');
    e.target.reset();
    loadAdminDashboard();
  } catch (err) {
    showGlobalAlert(err.message, 'error');
  }
});

// Admin tab switching
function switchAdminTab(tabName, btn) {
  document.querySelectorAll('#adminDashboard .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#adminDashboard .tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('adminTab-' + tabName).classList.add('active');

  if (tabName === 'suggestions') {
    loadAllSuggestions();
  }
}

// Load all loan suggestions
async function loadAllSuggestions() {
  try {
    const result = await apiCall('/admin/loans/suggestions/all');
    const s = result.summary;
    const suggestions = result.suggestions;

    document.getElementById('suggestionsSummary').innerHTML = `
      <div class="stats-grid mb-3">
        <div class="stat-card">
          <div class="label">Pending Loans</div>
          <div class="value">${s.total_pending}</div>
        </div>
        <div class="stat-card">
          <div class="label">Suggest Accept</div>
          <div class="value">${s.accept}</div>
          <div class="sub">${formatMoney(s.total_acceptable_amount)}</div>
        </div>
        <div class="stat-card accent">
          <div class="label">Suggest Hold</div>
          <div class="value">${s.hold}</div>
        </div>
        <div class="stat-card danger">
          <div class="label">Suggest Reject</div>
          <div class="value">${s.reject}</div>
        </div>
        <div class="stat-card info">
          <div class="label">Available Funds</div>
          <div class="value">${formatMoney(s.available_funds)}</div>
          <div class="sub">After acceptance: ${formatMoney(s.remaining_after_acceptance)}</div>
        </div>
      </div>
      <div class="alert alert-info mb-3">
        <i class="fas fa-info-circle"></i> These suggestions are based on credit scores, savings consistency,
        meeting attendance, loan history, and cooperative available funds. Review each loan individually for the best decision.
      </div>
    `;

    if (suggestions.length === 0) {
      document.getElementById('suggestionsList').innerHTML = `
        <div class="empty-state"><div class="icon"><i class="fas fa-check-circle"></i></div>No pending loans to review.</div>
      `;
      return;
    }

    document.getElementById('suggestionsList').innerHTML = suggestions.map(s => {
      const scoreClass = s.score >= 60 ? 'score-high' : s.score >= 45 ? 'score-medium' : 'score-low';
      const actionBadge = s.action === 'accept' ? 'badge-success' : s.action === 'hold' ? 'badge-warning' : 'badge-danger';
      const actionText = s.action === 'accept' ? 'ACCEPT' : s.action === 'hold' ? 'HOLD' : 'REJECT';

      return `
        <div class="card" style="display:flex;align-items:center;gap:16px;">
          <div class="score-circle ${scoreClass}" style="width:60px;height:60px;font-size:1.2rem;flex-shrink:0;">${s.score}</div>
          <div style="flex:1;">
            <div class="flex-between mb-1">
              <strong>${s.member_name}</strong>
              <span class="badge ${actionBadge}">${actionText}</span>
            </div>
            <div style="font-size:0.85rem;color:var(--text-light);">
              ${formatMoney(s.amount)} requested | Credit: ${s.credit_score} | Weeks: ${s.weeks_saved} | Savings: ${formatMoney(s.weekly_savings)} | Max loan: ${formatMoney(s.max_loan)}
              ${!s.can_afford ? ' | <span style="color:var(--danger);">Insufficient funds</span>' : ''}
            </div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="viewLoan('${s.loan_id}')">
            <i class="fas fa-eye"></i> Review
          </button>
        </div>
      `;
    }).join('');
  } catch (err) {
    showGlobalAlert(err.message, 'error');
  }
}

// ============================================
// Initialize
// ============================================
updateNavLinks();

// Check if user is already logged in
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
