/**
 * ============================================================
 *  SSL-VPN Registration — Google Apps Script Backend
 * ============================================================
 *  Deploy as Web App:
 *    Execute as: Me
 *    Who has access: Anyone
 *
 *  Sheets required (create these tabs in your spreadsheet):
 *    1. OTP_Log       — stores OTP codes
 *    2. Registrations — stores completed registrations
 * ============================================================
 */

// ─── CONFIGURATION ───────────────────────────────────────────
// Replace with your Google Sheet ID (from the sheet URL)
const SPREADSHEET_ID = '1TYEHQBspkpfneiTBwBFw7xR5AaZ5yktDIKlIIR62mCM';
const OTP_SHEET_NAME = 'OTP_Log';
const REG_SHEET_NAME = 'Registrations';
const OTP_EXPIRY_MINUTES = 5;

// ─── MAIN ENTRY POINTS ──────────────────────────────────────

/**
 * doPost — Main entry point for all frontend requests.
 * Dispatches based on `action` parameter in JSON body.
 *
 * @param {Object} e - Event object from Apps Script
 * @returns {TextOutput} JSON response
 */
function doPost(e) {
  try {
    // Parse incoming JSON payload
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    switch (action) {
      case 'sendOTP':
        return handleSendOTP(payload);

      case 'verifyOTP':
        return handleVerifyOTP(payload);

      case 'submitForm':
        return handleSubmitForm(payload);

      default:
        return jsonResponse({ success: false, message: 'Unknown action: ' + action });
    }

  } catch (error) {
    return jsonResponse({ success: false, message: 'Server error: ' + error.message });
  }
}

/**
 * doGet — Simple health-check endpoint.
 */
function doGet(e) {
  return jsonResponse({
    success: true,
    message: 'SSL-VPN OTP Backend is running.',
    timestamp: new Date().toISOString()
  });
}


// ─── ACTION HANDLERS ─────────────────────────────────────────

/**
 * handleSendOTP — Generate OTP, save to sheet, send email.
 *
 * @param {Object} payload - { action, email }
 * @returns {TextOutput} JSON response
 */
function handleSendOTP(payload) {
  const email = (payload.email || '').trim().toLowerCase();

  // Validate email format
  if (!email || !isValidEmail(email)) {
    return jsonResponse({ success: false, message: 'Invalid email address.' });
  }

  // Generate 6-digit OTP
  const otp = generateOTP();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Invalidate any previous pending OTPs for this email
  invalidatePreviousOTPs(email);

  // Save OTP to Google Sheets
  const sheet = getSheet(OTP_SHEET_NAME);
  sheet.appendRow([
    now.toISOString(),          // Timestamp
    email,                      // Email
    otp,                        // OTP
    'Pending',                  // Status
    expiresAt.toISOString()     // ExpiresAt
  ]);

  // Send email with OTP
  try {
    MailApp.sendEmail({
      to: email,
      subject: 'SSL-VPN Verification Code',
      htmlBody: buildOTPEmailHTML(otp),
      noReply: true
    });
  } catch (mailError) {
    return jsonResponse({ success: false, message: 'Failed to send email. Please try again.' });
  }

  // Return success with masked email
  return jsonResponse({
    success: true,
    message: 'OTP sent successfully.',
    maskedEmail: maskEmail(email)
  });
}

/**
 * handleVerifyOTP — Validate OTP code against stored record.
 *
 * @param {Object} payload - { action, email, otp }
 * @returns {TextOutput} JSON response
 */
function handleVerifyOTP(payload) {
  const email = (payload.email || '').trim().toLowerCase();
  const otp = (payload.otp || '').trim();

  if (!email || !otp) {
    return jsonResponse({ success: false, message: 'Email and OTP are required.' });
  }

  const sheet = getSheet(OTP_SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const now = new Date();

  // Find the latest pending OTP for this email (search from bottom)
  let matchRow = -1;
  let matchOTP = '';
  let matchExpiry = null;

  for (let i = data.length - 1; i >= 1; i--) {
    const rowEmail = (data[i][1] || '').toString().trim().toLowerCase();
    const rowStatus = (data[i][3] || '').toString().trim();

    if (rowEmail === email && rowStatus === 'Pending') {
      matchRow = i + 1; // 1-indexed for Sheets
      matchOTP = (data[i][2] || '').toString().trim();
      matchExpiry = new Date(data[i][4]);
      break;
    }
  }

  // No pending OTP found
  if (matchRow === -1) {
    return jsonResponse({
      success: false,
      message: 'No pending OTP found. Please request a new code.',
      code: 'NO_OTP'
    });
  }

  // Check expiration
  if (now > matchExpiry) {
    // Mark as expired
    sheet.getRange(matchRow, 4).setValue('Expired');
    return jsonResponse({
      success: false,
      message: 'OTP expired. Please request a new code.',
      code: 'EXPIRED'
    });
  }

  // Compare OTP
  if (otp !== matchOTP) {
    return jsonResponse({
      success: false,
      message: 'Incorrect OTP. Please check and try again.',
      code: 'INVALID'
    });
  }

  // OTP is valid — mark as Verified
  sheet.getRange(matchRow, 4).setValue('Verified');

  return jsonResponse({
    success: true,
    message: 'OTP verified successfully.'
  });
}

/**
 * handleSubmitForm — Save final registration data to Registrations sheet.
 * Sensitive fields (National ID, Phone, Email) are masked before storage.
 *
 * @param {Object} payload - { action, firstName, lastName, company, nationalId, phone, email, privacyAccepted, aupAccepted }
 * @returns {TextOutput} JSON response
 */
function handleSubmitForm(payload) {
  const firstName = sanitize(payload.firstName || '');
  const lastName = sanitize(payload.lastName || '');
  const company = sanitize(payload.company || '');
  const nationalId = sanitize(payload.nationalId || '');
  const phone = sanitize(payload.phone || '');
  const email = (payload.email || '').trim().toLowerCase();
  const privacyAccepted = payload.privacyAccepted || 'No';
  const aupAccepted = payload.aupAccepted || 'No';

  if (!firstName || !lastName || !company || !nationalId || !phone || !email) {
    return jsonResponse({ success: false, message: 'All fields are required.' });
  }

  // Apply data masking for privacy protection
  const maskedNationalId = maskNationalId(nationalId);
  const maskedPhone = maskPhone(phone);
  const maskedEmail = maskEmail(email);

  const sheet = getSheet(REG_SHEET_NAME);
  sheet.appendRow([
    new Date().toISOString(),   // Timestamp
    firstName,                  // First Name
    lastName,                   // Last Name
    company,                    // Company
    maskedNationalId,           // National ID (masked)
    maskedPhone,                // Phone (masked)
    maskedEmail,                // Email (masked)
    privacyAccepted,            // Privacy Accepted
    aupAccepted                 // AUP Accepted
  ]);

  return jsonResponse({
    success: true,
    message: 'Registration submitted successfully.'
  });
}


// ─── HELPER FUNCTIONS ────────────────────────────────────────

/**
 * Generate a random 6-digit OTP.
 */
function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Mask email for display (e.g., "j***@gmail.com").
 */
function maskEmail(email) {
  const [local, domain] = email.split('@');
  if (local.length <= 1) return '*@' + domain;
  return local[0] + '***@' + domain;
}

/**
 * Validate email format.
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Sanitize input — strip HTML tags and trim.
 */
function sanitize(str) {
  return String(str).replace(/<[^>]*>/g, '').trim();
}

// ─── DATA MASKING FUNCTIONS ──────────────────────────────────

/**
 * Mask National ID — show only last 4 digits.
 * e.g. "1234567890123" → "*********0123"
 */
function maskNationalId(id) {
  if (!id || id.length <= 4) return id;
  return '*'.repeat(id.length - 4) + id.slice(-4);
}

/**
 * Mask Phone — show only last 4 digits.
 * e.g. "0812345678" → "******5678"
 */
function maskPhone(phone) {
  if (!phone || phone.length <= 4) return phone;
  return '*'.repeat(phone.length - 4) + phone.slice(-4);
}

/**
 * Mask Email — show first character + *** + domain.
 * e.g. "john@gmail.com" → "j***@gmail.com"
 */
function maskEmail(email) {
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const local = parts[0];
  const domain = parts[1];
  if (local.length <= 1) return '*@' + domain;
  return local[0] + '***@' + domain;
}

/**
 * Invalidate (expire) all previous pending OTPs for an email.
 * Ensures only the latest OTP is valid.
 */
function invalidatePreviousOTPs(email) {
  const sheet = getSheet(OTP_SHEET_NAME);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const rowEmail = (data[i][1] || '').toString().trim().toLowerCase();
    const rowStatus = (data[i][3] || '').toString().trim();

    if (rowEmail === email && rowStatus === 'Pending') {
      sheet.getRange(i + 1, 4).setValue('Superseded');
    }
  }
}

/**
 * Get a sheet by name from the configured spreadsheet.
 * Creates the sheet with headers if it doesn't exist.
 */
function getSheet(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);

    // Add headers based on sheet type
    if (sheetName === OTP_SHEET_NAME) {
      sheet.appendRow(['Timestamp', 'Email', 'OTP', 'Status', 'ExpiresAt']);
      sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
    } else if (sheetName === REG_SHEET_NAME) {
      sheet.appendRow(['Timestamp', 'First Name', 'Last Name', 'Company', 'National ID', 'Phone', 'Email', 'Privacy Accepted', 'AUP Accepted']);
      sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
    }
  }

  return sheet;
}

/**
 * Build a formatted JSON response.
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Build HTML email body for OTP.
 */
function buildOTPEmailHTML(otp) {
  return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <div style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); border-radius: 12px; padding: 32px; text-align: center; color: #ffffff;">
        <div style="font-size: 24px; font-weight: 700; margin-bottom: 8px;">🔐 SSL-VPN Verification</div>
        <div style="font-size: 14px; opacity: 0.9;">Secure Access Registration</div>
      </div>
      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; margin-top: 16px; text-align: center;">
        <p style="font-size: 15px; color: #475569; margin-bottom: 24px;">
          Your verification code is:
        </p>
        <div style="background: #f8fafc; border: 2px dashed #3b82f6; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
          <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #1e293b; font-family: 'Courier New', monospace;">
            ${otp}
          </span>
        </div>
        <p style="font-size: 13px; color: #94a3b8; margin-bottom: 4px;">
          This code expires in <strong style="color: #f59e0b;">${OTP_EXPIRY_MINUTES} minutes</strong>.
        </p>
        <p style="font-size: 12px; color: #cbd5e1;">
          If you did not request this code, please ignore this email.
        </p>
      </div>
      <div style="text-align: center; margin-top: 16px; font-size: 11px; color: #94a3b8;">
        &copy; ${new Date().getFullYear()} SSL-VPN Secure Access
      </div>
    </div>
  `;
}
