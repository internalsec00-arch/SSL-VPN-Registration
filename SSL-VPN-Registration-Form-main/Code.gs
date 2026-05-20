/**
 * ============================================================
 *  SSL-VPN Registration — Google Apps Script Backend  v3.0.0
 * ============================================================
 *  Production-ready backend for SSL-VPN registration with:
 *    • OTP email verification (send / verify)
 *    • Automatic Google Sheets setup (headers, formatting)
 *    • Multi-submission support (logging mode)
 *    • Input sanitization & validation
 *    • Sensitive data masking (National ID, Phone)
 *    • Clean JSON API responses
 *
 *  Deploy as Web App:
 *    Execute as : Me
 *    Who has access : Anyone
 *
 *  Sheets managed automatically:
 *    1. OTP_Log        — OTP codes, status, expiry
 *    2. Registrations  — completed registration records
 * ============================================================
 */

// ─── CONFIGURATION ───────────────────────────────────────────

const SPREADSHEET_ID    = '1TYEHQBspkpfneiTBwBFw7xR5AaZ5yktDIKlIIR62mCM';
const OTP_SHEET_NAME    = 'OTP_Log';
const REG_SHEET_NAME    = 'Registrations';
const OTP_EXPIRY_MINUTES = 5;
const API_VERSION       = '3.0.0';
const TIMEZONE          = 'Asia/Bangkok';
const DATE_FORMAT       = 'yyyy-MM-dd HH:mm:ss';

/** Header definitions — single source of truth for sheet columns. */
const OTP_HEADERS = ['Timestamp', 'Email', 'OTP', 'Status', 'ExpiresAt'];
const REG_HEADERS = [
  'Timestamp',
  'First Name',
  'Last Name',
  'Company',
  'National ID Card Number',
  'Phone Number',
  'Email',
  'Privacy Accepted',
  'AUP Accepted'
];


// ─── MAIN ENTRY POINTS ──────────────────────────────────────

/**
 * doPost — Main API entry point.
 * Routes requests based on the `action` field in the JSON body.
 *
 * Supported actions:
 *   • sendOTP    — Generate & email a 6-digit OTP
 *   • verifyOTP  — Validate an OTP code
 *   • submitForm — Save a completed registration
 *
 * @param {Object} e - Apps Script event object
 * @returns {TextOutput} JSON response
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action  = (payload.action || '').trim();

    console.log('[doPost] Action: %s | Keys: %s', action, Object.keys(payload).join(', '));

    switch (action) {
      case 'sendOTP':
        return handleSendOTP(payload);

      case 'verifyOTP':
        return handleVerifyOTP(payload);

      case 'submitForm':
        return handleSubmitForm(payload);

      default:
        return jsonResponse({
          success: false,
          message: 'Unknown action: ' + action
        });
    }
  } catch (error) {
    console.error('[doPost] Error: %s\n%s', error.message, error.stack);
    return jsonResponse({
      success: false,
      message: 'Server error: ' + error.message
    });
  }
}

/**
 * doGet — Health-check endpoint.
 * Returns API status, timestamp, and version.
 */
function doGet() {
  return jsonResponse({
    success: true,
    message: 'SSL-VPN OTP Backend is online.',
    timestamp: formatThaiDate(new Date()),
    version: API_VERSION
  });
}


// ─── ACTION HANDLERS ─────────────────────────────────────────

/**
 * handleSendOTP — Generate OTP, save to OTP_Log, send email.
 *
 * Flow:
 *  1. Validate email format
 *  2. Expire previous pending OTPs for same email
 *  3. Generate new 6-digit OTP
 *  4. Save record to OTP_Log sheet
 *  5. Send OTP via email (MailApp)
 *  6. Return email to caller
 *
 * @param {Object} payload - { action, email }
 * @returns {TextOutput} JSON response
 */
function handleSendOTP(payload) {
  const email = sanitize(payload.email || '').toLowerCase();

  // Validate email format
  if (!email || !isValidEmail(email)) {
    return jsonResponse({
      success: false,
      message: 'Invalid email address.'
    });
  }

  // Generate OTP & timestamps
  const otp       = generateOTP();
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Invalidate any previous pending OTPs for this email
  invalidatePreviousOTPs(email);

  // Save OTP to sheet (auto-creates headers if needed)
  const sheet = getSheet(OTP_SHEET_NAME);
  sheet.appendRow([
    formatThaiDate(now),      // Timestamp (Thailand time)
    email,                    // Email
    otp,                      // OTP
    'Pending',                // Status
    formatThaiDate(expiresAt) // ExpiresAt (Thailand time)
  ]);

  // Send OTP email
  try {
    MailApp.sendEmail({
      to: email,
      subject: 'SSL-VPN Verification Code',
      htmlBody: buildOTPEmailHTML(otp),
      noReply: true
    });
  } catch (mailError) {
    console.error('[sendOTP] Mail error: %s', mailError.message);
    return jsonResponse({
      success: false,
      message: 'Failed to send email. Please try again.'
    });
  }

  console.log('[sendOTP] ✓ OTP sent to %s', email);

  return jsonResponse({
    success: true,
    message: 'OTP sent successfully.',
    email: email
  });
}

/**
 * handleVerifyOTP — Validate an OTP code against OTP_Log.
 *
 * Delegates to verifyLatestOTP() helper, then updates the
 * sheet status accordingly.
 *
 * Error codes returned on failure:
 *   • NO_OTP   — No pending OTP found for email
 *   • EXPIRED  — OTP has expired
 *   • INVALID  — OTP does not match
 *
 * @param {Object} payload - { action, email, otp }
 * @returns {TextOutput} JSON response
 */
function handleVerifyOTP(payload) {
  const email = sanitize(payload.email || '').toLowerCase();
  const otp   = sanitize(payload.otp || '');

  if (!email || !otp) {
    return jsonResponse({
      success: false,
      message: 'Email and OTP are required.'
    });
  }

  const sheet  = getSheet(OTP_SHEET_NAME);
  const result = verifyLatestOTP(sheet, email, otp);

  if (result.valid) {
    // Mark as Verified
    sheet.getRange(result.row, 4).setValue('Verified');
    console.log('[verifyOTP] ✓ OTP verified for %s', email);

    return jsonResponse({
      success: true,
      message: 'OTP verified successfully.'
    });
  }

  // Handle failure cases
  if (result.code === 'EXPIRED' && result.row) {
    sheet.getRange(result.row, 4).setValue('Expired');
  }

  const messages = {
    NO_OTP:  'No pending OTP found. Please request a new code.',
    EXPIRED: 'OTP expired. Please request a new code.',
    INVALID: 'Incorrect OTP. Please check and try again.'
  };

  return jsonResponse({
    success: false,
    message: messages[result.code] || 'Verification failed.',
    code: result.code
  });
}

/**
 * handleSubmitForm — Save registration data to Registrations sheet.
 *
 * Operates in logging mode: every valid submission creates a new row,
 * even if identical data was previously submitted.
 *
 * Pre-checks:
 *   1. All required fields are present
 *   2. National ID must be exactly 13 digits
 *   3. Email has a verified OTP in OTP_Log
 *
 * Sensitive fields are masked before storage:
 *   • National ID: *********0123
 *   • Phone:       ******4567
 *   • Email:       stored in full (not masked)
 *
 * @param {Object} payload - { action, firstName, lastName, company, nationalId, phone, email, privacyAccepted, aupAccepted }
 * @returns {TextOutput} JSON response
 */
function handleSubmitForm(payload) {
  console.log('[submitForm] Starting submission...');

  // Sanitize all inputs
  const firstName       = sanitize(payload.firstName || '');
  const lastName        = sanitize(payload.lastName || '');
  const company         = sanitize(payload.company || '');
  const nationalId      = sanitize(payload.nationalId || '');
  const phone           = sanitize(payload.phone || '');
  const email           = sanitize(payload.email || '').toLowerCase();
  const privacyAccepted = payload.privacyAccepted || 'No';
  const aupAccepted     = payload.aupAccepted || 'No';

  console.log('[submitForm] Fields — firstName: %s, lastName: %s, company: %s, nationalId: %s, phone: %s, email: %s',
    firstName, lastName, company,
    nationalId ? 'provided' : 'MISSING',
    phone ? 'provided' : 'MISSING',
    email ? 'provided' : 'MISSING');

  // ── Validation: all required fields ──
  if (!firstName || !lastName || !company || !nationalId || !phone || !email) {
    console.error('[submitForm] Validation failed — missing required fields');
    return jsonResponse({
      success: false,
      message: 'All fields are required.'
    });
  }

  // ── Validation: National ID must be exactly 13 digits ──
  if (!/^\d{13}$/.test(nationalId)) {
    console.error('[submitForm] Invalid National ID format');
    return jsonResponse({
      success: false,
      message: 'National ID Card Number must be exactly 13 digits.'
    });
  }

  if (!isValidEmail(email)) {
    return jsonResponse({
      success: false,
      message: 'Invalid email address.'
    });
  }

  // ── Security: OTP must be verified before submit ──
  if (!isOTPVerifiedForEmail(email)) {
    console.error('[submitForm] OTP not verified for: %s', email);
    return jsonResponse({
      success: false,
      message: 'Email must be verified via OTP before submitting.'
    });
  }

  // ── Mask sensitive data before storage ──
  const maskedNationalId = maskNationalId(nationalId);
  const maskedPhone      = maskPhone(phone);

  // ── Write to Registrations sheet ──
  try {
    const sheet      = getSheet(REG_SHEET_NAME);
    const rowsBefore = sheet.getLastRow();

    sheet.appendRow([
      formatThaiDate(new Date()),  // Timestamp (Thailand time)
      firstName,                 // First Name
      lastName,                  // Last Name
      company,                   // Company
      maskedNationalId,          // National ID Card Number (masked)
      maskedPhone,               // Phone Number (masked)
      email,                     // Email (full, not masked)
      privacyAccepted,           // Privacy Accepted
      aupAccepted                // AUP Accepted
    ]);

    // Flush to ensure write
    SpreadsheetApp.flush();

    const rowsAfter = sheet.getLastRow();

    if (rowsAfter <= rowsBefore) {
      console.error('[submitForm] Row count did not increase — write may have failed');
      return jsonResponse({
        success: false,
        message: 'Data write verification failed. Please try again.'
      });
    }

    console.log('[submitForm] ✓ Registration saved (row %d)', rowsAfter);

    return jsonResponse({
      success: true,
      message: 'Registration submitted successfully.',
      row: rowsAfter
    });

  } catch (sheetError) {
    console.error('[submitForm] Sheet error: %s\n%s', sheetError.message, sheetError.stack);
    return jsonResponse({
      success: false,
      message: 'Failed to save data: ' + sheetError.message
    });
  }
}


// ─── CORE HELPERS ────────────────────────────────────────────

/**
 * Format a Date object as Thailand local time string.
 * Uses Asia/Bangkok timezone (GMT+7).
 *
 * @param {Date} date - Date object to format
 * @returns {string} Formatted string e.g. "2026-05-13 13:34:12"
 */
function formatThaiDate(date) {
  return Utilities.formatDate(date, TIMEZONE, DATE_FORMAT);
}

/**
 * Parse a Thai-format datetime string back into a Date object.
 * Handles both "yyyy-MM-dd HH:mm:ss" (Thai local) and ISO formats.
 *
 * @param {*} value - Date string or Date object from sheet
 * @returns {Date} Parsed Date object
 */
function parseThaiDate(value) {
  // If already a Date object (Google Sheets auto-parse), return as-is
  if (value instanceof Date) return value;

  var str = String(value).trim();

  // ISO format (legacy data) — parse directly
  if (str.indexOf('T') !== -1) return new Date(str);

  // Thai format "yyyy-MM-dd HH:mm:ss" — parse as Bangkok time
  // Append timezone offset to ensure correct parsing
  return new Date(str.replace(' ', 'T') + '+07:00');
}



/**
 * Generate a random 6-digit OTP code.
 * @returns {string} 6-digit string (e.g. "482917")
 */
function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Validate email format.
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Sanitize input — strip HTML tags, trim whitespace.
 * @param {string} str
 * @returns {string}
 */
function sanitize(str) {
  return String(str).replace(/<[^>]*>/g, '').trim();
}

// maskEmail removed — emails are now displayed in full for easier verification.


// ─── DATA MASKING ────────────────────────────────────────────
// Note: Only National ID and Phone are masked. Email is stored in full.

/**
 * Mask National ID — show only last 4 digits.
 * e.g. "1234567890123" → "*********0123"
 *
 * @param {string} id - Full National ID string
 * @returns {string} Masked ID
 */
function maskNationalId(id) {
  if (!id || id.length <= 4) return id;
  return '*'.repeat(id.length - 4) + id.slice(-4);
}

/**
 * Mask Phone Number — show only last 4 digits.
 * e.g. "0891234567" → "******4567"
 *
 * @param {string} phone - Full phone number
 * @returns {string} Masked phone
 */
function maskPhone(phone) {
  if (!phone || phone.length <= 4) return phone;
  return '*'.repeat(phone.length - 4) + phone.slice(-4);
}

/**
 * Build a formatted JSON response.
 * @param {Object} data - Response payload
 * @returns {TextOutput} ContentService JSON output
 */
function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


// ─── SHEET MANAGEMENT ────────────────────────────────────────

/**
 * Get a sheet by name from the configured spreadsheet.
 * Creates the sheet and writes formatted headers if it doesn't exist.
 *
 * @param {string} sheetName - Name of the sheet tab
 * @returns {Sheet} Google Sheets Sheet object
 */
function getSheet(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    // Create new sheet tab
    sheet = ss.insertSheet(sheetName);
    console.log('[getSheet] Created new sheet: %s', sheetName);
  }

  // Determine correct headers and ensure they exist
  if (sheetName === OTP_SHEET_NAME) {
    ensureHeaders(sheet, OTP_HEADERS);
  } else if (sheetName === REG_SHEET_NAME) {
    ensureHeaders(sheet, REG_HEADERS);
  }

  return sheet;
}

/**
 * Ensure a sheet has the correct header row.
 *
 * Rules:
 *   • If row 1 is empty or sheet has no data → write headers
 *   • Header row is bold, first row frozen
 *   • Auto-resize all columns for readability
 *   • Never duplicates headers if they already exist
 *   • Data starts at row 2
 *
 * @param {Sheet} sheet   - Target sheet
 * @param {Array} headers - Array of header strings
 */
function ensureHeaders(sheet, headers) {
  const lastRow = sheet.getLastRow();

  // Check if headers already exist
  if (lastRow >= 1) {
    const existingHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    const headersMatch = headers.every(function(header, index) {
      return (existingHeaders[index] || '').toString().trim() === header;
    });

    if (headersMatch) {
      return; // Headers already correct — skip
    }

    // If row 1 has data but wrong headers, only write if row 1 is completely empty
    const row1Empty = existingHeaders.every(function(cell) {
      return (cell || '').toString().trim() === '';
    });

    if (!row1Empty) {
      return; // Row 1 has other data — don't overwrite
    }
  }

  // Write headers
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight('bold');

  // Freeze header row
  sheet.setFrozenRows(1);

  // Auto-resize all columns
  for (var col = 1; col <= headers.length; col++) {
    sheet.autoResizeColumn(col);
  }

  console.log('[ensureHeaders] ✓ Headers set for sheet with %d columns', headers.length);
}


// ─── OTP HELPERS ─────────────────────────────────────────────

/**
 * Invalidate (expire) all previous pending OTPs for an email.
 * Sets their status to "Superseded" so only the latest OTP is valid.
 *
 * @param {string} email - Lowercase email address
 */
function invalidatePreviousOTPs(email) {
  const sheet = getSheet(OTP_SHEET_NAME);
  const data  = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var rowEmail  = (data[i][1] || '').toString().trim().toLowerCase();
    var rowStatus = (data[i][3] || '').toString().trim();

    if (rowEmail === email && rowStatus === 'Pending') {
      sheet.getRange(i + 1, 4).setValue('Superseded');
    }
  }
}

/**
 * Verify the latest pending OTP for an email.
 *
 * Searches the OTP_Log sheet from bottom to top for the most
 * recent "Pending" entry matching the given email.
 *
 * @param {Sheet}  sheet - OTP_Log sheet
 * @param {string} email - Lowercase email
 * @param {string} otp   - User-provided OTP code
 * @returns {Object} { valid: boolean, code?: string, row?: number }
 *   code values: 'NO_OTP' | 'EXPIRED' | 'INVALID'
 *   row: 1-indexed sheet row of the matched record
 */
function verifyLatestOTP(sheet, email, otp) {
  const data = sheet.getDataRange().getValues();
  const now  = new Date();

  // Search from bottom for latest pending OTP
  for (var i = data.length - 1; i >= 1; i--) {
    var rowEmail  = (data[i][1] || '').toString().trim().toLowerCase();
    var rowStatus = (data[i][3] || '').toString().trim();

    if (rowEmail === email && rowStatus === 'Pending') {
      var sheetRow   = i + 1;  // 1-indexed
      var storedOTP  = (data[i][2] || '').toString().trim();
      var expiresAt  = parseThaiDate(data[i][4]);

      // Check expiration
      if (now > expiresAt) {
        return { valid: false, code: 'EXPIRED', row: sheetRow };
      }

      // Compare OTP
      if (otp !== storedOTP) {
        return { valid: false, code: 'INVALID', row: sheetRow };
      }

      // ✓ Valid
      return { valid: true, row: sheetRow };
    }
  }

  // No pending OTP found
  return { valid: false, code: 'NO_OTP' };
}

/**
 * Check if a "Verified" OTP exists for an email in OTP_Log.
 * Must be verified before form submission is allowed.
 *
 * @param {string} email - Lowercase email
 * @returns {boolean} true if a verified OTP record exists
 */
function isOTPVerifiedForEmail(email) {
  const sheet = getSheet(OTP_SHEET_NAME);
  const data  = sheet.getDataRange().getValues();

  // Search from bottom (most recent first)
  for (var i = data.length - 1; i >= 1; i--) {
    var rowEmail  = (data[i][1] || '').toString().trim().toLowerCase();
    var rowStatus = (data[i][3] || '').toString().trim();

    if (rowEmail === email && rowStatus === 'Verified') {
      return true;
    }
  }

  return false;
}




// ─── EMAIL TEMPLATE ──────────────────────────────────────────

/**
 * Build a modern, branded HTML email for OTP delivery.
 *
 * Features:
 *   • Gradient header with shield branding
 *   • Large OTP digits with letter-spacing
 *   • Expiry warning in amber
 *   • Security notice
 *   • Responsive design
 *
 * @param {string} otp - The 6-digit OTP code
 * @returns {string} HTML email body
 */
function buildOTPEmailHTML(otp) {
  return `
    <div style="font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 0; background-color: #f1f5f9;">
      <!-- Header Banner -->
      <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 50%, #06b6d4 100%); border-radius: 16px 16px 0 0; padding: 36px 32px; text-align: center;">
        <div style="width: 56px; height: 56px; margin: 0 auto 16px; background: rgba(255,255,255,0.15); border-radius: 14px; display: flex; align-items: center; justify-content: center;">
          <span style="font-size: 28px; line-height: 56px;">🔐</span>
        </div>
        <div style="font-size: 22px; font-weight: 700; color: #ffffff; margin-bottom: 6px; letter-spacing: -0.3px;">
          SSL-VPN Verification
        </div>
        <div style="font-size: 14px; color: rgba(255,255,255,0.85); font-weight: 400;">
          Secure Access Registration
        </div>
      </div>

      <!-- Content Card -->
      <div style="background: #ffffff; padding: 36px 32px 32px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
        <p style="font-size: 15px; color: #334155; margin: 0 0 8px; line-height: 1.6; text-align: center;">
          Your email verification code is:
        </p>
        <p style="font-size: 13px; color: #94a3b8; margin: 0 0 24px; text-align: center;">
          Enter this code in the registration form to verify your email.
        </p>

        <!-- OTP Code Box -->
        <div style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border: 2px dashed #3b82f6; border-radius: 14px; padding: 24px 16px; text-align: center; margin-bottom: 24px;">
          <div style="font-size: 42px; font-weight: 800; letter-spacing: 12px; color: #0f172a; font-family: 'Courier New', 'Consolas', monospace; padding-left: 12px;">
            ${otp}
          </div>
        </div>

        <!-- Expiry Warning -->
        <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 14px 18px; margin-bottom: 20px; text-align: center;">
          <span style="font-size: 13px; color: #92400e;">
            ⏱ This code expires in <strong style="color: #d97706;">${OTP_EXPIRY_MINUTES} minutes</strong>
          </span>
        </div>

        <!-- Security Notice -->
        <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; padding: 14px 18px; text-align: center;">
          <span style="font-size: 12px; color: #0369a1;">
            🛡 Do not share this code with anyone. Our team will never ask for your OTP.
          </span>
        </div>
      </div>

      <!-- Footer -->
      <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; border-radius: 0 0 16px 16px; padding: 20px 32px; text-align: center;">
        <p style="font-size: 11px; color: #94a3b8; margin: 0 0 4px;">
          If you did not request this code, you can safely ignore this email.
        </p>
        <p style="font-size: 11px; color: #cbd5e1; margin: 0;">
          &copy; ${new Date().getFullYear()} SSL-VPN Secure Access &middot; All rights reserved
        </p>
      </div>
    </div>
  `;
}
