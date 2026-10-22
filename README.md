# Cooperative Society Management System

A complete web application for managing a cooperative society with member registration, credit score verification, savings tracking, loan management, and Sunday meeting attendance.

## Features

### Member Features
- **Registration** with credit score check (minimum 550 to join)
- **Registration fee** payment of N5,000
- **Weekly savings** tracking (counts toward loan eligibility)
- **Special savings** tracking (does NOT count toward loans)
- **Loan application** - up to 2x total weekly savings, minimum 12 weeks of contributions
- **Sunday meeting check-in** with meeting code and payment

### Admin Features
- **Dashboard** with total members, savings, loans, and available funds
- **View all members** with full details (savings, loans, attendance)
- **Approve/reject loan requests** with comments
- **Set loan status**: Pending, Approved, In Progress, Rejected
- **AI-assisted loan suggestions** based on:
  - Credit score (25 pts)
  - Savings consistency (20 pts)
  - Loan-to-savings ratio (20 pts)
  - Meeting attendance (15 pts)
  - Loan history (10 pts)
  - Cooperative available funds (10 pts)
- **Batch loan suggestions** - see how many pending loans can be accepted based on available funds
- **Create Sunday meetings** with auto-generated meeting codes
- **View meeting attendance** and payments

## Getting Started

### Prerequisites
- Node.js (v18 or higher)

### Installation

```bash
npm install
```

### Running the Server

```bash
npm start
```

The server runs on `http://localhost:3000`

### Default Admin Account
- Email: `admin@cooperative.ng`
- Password: `admin123`

## How to Use

### For Members
1. Go to the homepage and click "Register Now"
2. Fill in the registration form (BVN is used for credit score check)
3. If your credit score is 550+, you'll be prompted to pay the N5,000 registration fee
4. After paying, your account is approved and you can access the dashboard
5. Add weekly savings each week to build your loan eligibility
6. After 12 weeks of weekly savings, you can apply for a loan up to 2x your total weekly savings
7. Every Sunday, check in using the meeting code provided by the admin

### For Admin
1. Login with the admin credentials
2. View dashboard statistics
3. Review loan requests with AI suggestions
4. Approve, set in progress, or reject loans with comments
5. Create Sunday meetings and share the meeting code with members
6. View member details and meeting attendance

## Contact
- Phone: +234 803 218 0923
- Phone: +234 810 875 9222

## Tech Stack
- Backend: Node.js + Express
- Database: SQLite (via sql.js - WebAssembly)
- Frontend: HTML, CSS, JavaScript (vanilla)
- Authentication: JWT tokens
