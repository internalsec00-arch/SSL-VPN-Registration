/**
 * ============================================================
 *  SSL-VPN Registration Form — Step 1
 *  Email OTP Verification System
 * ============================================================
 *  Handles:
 *  - Field validation (name, company, phone, email)
 *  - Request OTP via Google Apps Script backend
 *  - 6-digit OTP input boxes with auto-advance
 *  - Verify OTP via backend
 *  - Resend OTP with 5-minute cooldown
 *  - Form submission & navigation to Step 2
 * ============================================================
 */
(() => {
  'use strict';

  /* -------------------------------------------------------
     ⚙️ CONFIGURATION
     Replace this URL with your deployed Google Apps Script
     Web App URL after deployment.
     ------------------------------------------------------- */
  const GAS_URL = 'https://script.google.com/macros/s/AKfycbxC3jfs0YFQS8bwLb89UuSjBpEw7bGc4XkZudYXKk04U8bTDT8rUbc9jGHTTgSdqlhqMw/exec';

  /* -------------------------------------------------------
     Constants
     ------------------------------------------------------- */
  const RESEND_COOLDOWN = 300; // seconds between resend attempts

  /* -------------------------------------------------------
     DOM References
     ------------------------------------------------------- */
  const form = document.getElementById('registrationForm');
  const nextBtn = document.getElementById('nextBtn');
  const requestOtpBtn = document.getElementById('requestOtpBtn');
  const otpSection = document.getElementById('otpSection');

  // OTP Status Messages (below email field)
  const otpSuccessMsg = document.getElementById('otpSuccessMsg');
  const otpErrorMsg = document.getElementById('otpErrorMsg');
  const otpExpiredMsg = document.getElementById('otpExpiredMsg');

  // OTP Verification Messages (below OTP boxes)
  const otpInvalidMsg = document.getElementById('otpInvalidMsg');
  const otpExpiredVerifyMsg = document.getElementById('otpExpiredVerifyMsg');
  const otpVerifiedMsg = document.getElementById('otpVerifiedMsg');

  /* -------------------------------------------------------
     Standard field definitions
     ------------------------------------------------------- */
  const fields = {
    firstName: {
      input: document.getElementById('firstName'),
      error: document.getElementById('firstNameError'),
      validate: v => v.trim().length > 0,
      message: 'First name is required.'
    },
    lastName: {
      input: document.getElementById('lastName'),
      error: document.getElementById('lastNameError'),
      validate: v => v.trim().length > 0,
      message: 'Last name is required.'
    },
    company: {
      input: document.getElementById('company'),
      error: document.getElementById('companyError'),
      validate: v => v.trim().length > 0,
      message: 'Company name is required.'
    },
    nationalId: {
      input: document.getElementById('nationalId'),
      error: document.getElementById('nationalIdError'),
      validate: v => /^\d{13}$/.test(v.trim()),
      message: 'Please enter a valid 13-digit National ID.'
    },
    phone: {
      input: document.getElementById('phone'),
      error: document.getElementById('phoneError'),
      validate: v => /^\d+$/.test(v.trim()),
      message: 'Please enter a valid phone number (digits only).'
    },
    email: {
      input: document.getElementById('email'),
      error: document.getElementById('emailError'),
      validate: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
      message: 'Please enter a valid email address.'
    }
  };

  /* -------------------------------------------------------
     OTP — DOM references
     ------------------------------------------------------- */
  const otpBoxes = document.querySelectorAll('.otp-box');
  const otpContainer = document.getElementById('otpBoxes');
  const otpError = document.getElementById('otpError');
  const resendTimer = document.getElementById('resendTimer');
  const otpResend = document.getElementById('otpResend');

  /* -------------------------------------------------------
     State Management
     ------------------------------------------------------- */
  const touched = new Set();
  let otpTouched = false;
  let otpVerified = false;   // Set to true only after backend verification
  let otpRequested = false;   // Whether OTP has been requested at least once
  let isVerifying = false;   // Prevent duplicate verification requests
  let lastResendTime = 0;     // Timestamp of last OTP send (for cooldown)
  let countdown = RESEND_COOLDOWN;
  let timerInterval = null;

  /* -------------------------------------------------------
     Validate a single standard field
     ------------------------------------------------------- */
  function validateField(name) {
    const f = fields[name];
    const value = f.input.value;
    const valid = f.validate(value);

    if (touched.has(name)) {
      f.error.textContent = valid ? '' : f.message;
      f.error.classList.toggle('is-visible', !valid);
      f.input.classList.toggle('is-valid', valid);
      f.input.classList.toggle('is-invalid', !valid);
    }

    return valid;
  }

  /* -------------------------------------------------------
     All Fields Valid → Enable/Disable Request OTP button
     ------------------------------------------------------- */
  function updateRequestOtpButton() {
    const allFieldsValid = Object.keys(fields).every(name => {
      const f = fields[name];
      return f.validate(f.input.value);
    });
    // Only enable if ALL fields are valid AND not currently loading AND not already verified
    requestOtpBtn.disabled = !allFieldsValid || requestOtpBtn.classList.contains('is-loading') || otpVerified;
  }

  /* -------------------------------------------------------
     OTP — Get combined value from all 6 boxes
     ------------------------------------------------------- */
  function getOtpValue() {
    return Array.from(otpBoxes).map(box => box.value).join('');
  }

  /* -------------------------------------------------------
     OTP — Check if all 6 digits are filled
     ------------------------------------------------------- */
  function isOtpComplete() {
    return /^\d{6}$/.test(getOtpValue());
  }

  /* -------------------------------------------------------
     OTP — Update visual states (filled, complete, error)
     ------------------------------------------------------- */
  function updateOtpVisuals() {
    const complete = isOtpComplete();

    // Mark individual boxes as filled
    otpBoxes.forEach(box => {
      box.classList.toggle('is-filled', box.value.length === 1);
    });

    // Complete state — green glow (only if not yet verified)
    if (!otpVerified) {
      otpContainer.classList.toggle('is-complete', complete);
    }

    // Error state — remove if correcting
    if (complete) {
      otpContainer.classList.remove('is-error');
    }

    // Error message
    if (otpTouched) {
      const showError = !complete && getOtpValue().length > 0;
      otpError.textContent = showError ? 'Please enter complete 6-digit OTP' : '';
      otpError.classList.toggle('is-visible', showError);
    }

    // Auto-verify when all 6 digits are entered
    if (complete && !otpVerified && !isVerifying) {
      verifyOTP();
    }
  }

  /* -------------------------------------------------------
     OTP — Show shake animation for invalid
     ------------------------------------------------------- */
  function shakeOtp() {
    otpContainer.classList.remove('is-error');
    void otpContainer.offsetWidth;
    otpContainer.classList.add('is-error');
    otpError.textContent = 'Please enter complete 6-digit OTP';
    otpError.classList.add('is-visible');
  }

  /* -------------------------------------------------------
     Hide all OTP status messages
     ------------------------------------------------------- */
  function hideAllOtpMessages() {
    [otpSuccessMsg, otpErrorMsg, otpExpiredMsg,
      otpInvalidMsg, otpExpiredVerifyMsg, otpVerifiedMsg].forEach(el => {
        el.classList.remove('is-visible');
        el.textContent = '';
      });
  }

  /* -------------------------------------------------------
     Show a specific OTP message
     ------------------------------------------------------- */
  function showMessage(element, text) {
    hideAllOtpMessages();
    element.textContent = text;
    element.classList.add('is-visible');
  }

  /* -------------------------------------------------------
     Sanitize input — strip HTML
     ------------------------------------------------------- */
  function sanitize(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* -------------------------------------------------------
     Check ALL fields + OTP verified — enable/disable Next
     ------------------------------------------------------- */
  function checkFormValidity() {
    const standardValid = Object.keys(fields).every(name => {
      const f = fields[name];
      return f.validate(f.input.value);
    });
    // Next button requires: all fields valid + OTP verified by backend
    nextBtn.disabled = !(standardValid && otpVerified);
  }

  /* -------------------------------------------------------
     📧 SEND OTP — Request OTP from Google Apps Script
     ------------------------------------------------------- */
  async function sendOTP() {
    const email = fields.email.input.value.trim();

    if (!fields.email.validate(email)) {
      showMessage(otpErrorMsg, 'Please enter a valid email address.');
      return;
    }

    // Enforce cooldown
    const now = Date.now();
    const elapsed = (now - lastResendTime) / 1000;
    if (lastResendTime > 0 && elapsed < RESEND_COOLDOWN) {
      const remaining = Math.ceil(RESEND_COOLDOWN - elapsed);
      showMessage(otpErrorMsg, `Please wait ${remaining} seconds before requesting another OTP.`);
      return;
    }

    // Show loading state
    requestOtpBtn.classList.add('is-loading');
    requestOtpBtn.disabled = true;
    hideAllOtpMessages();

    try {
      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'sendOTP',
          email: email
        }),
        redirect: 'follow'
      });

      const text = await response.text();
      console.log('[OTP] Send response:', text);
      const result = JSON.parse(text);

      if (result.success) {
        // Success — show OTP section
        otpRequested = true;
        lastResendTime = Date.now();
        otpVerified = false;

        // Show success message with masked email
        showMessage(otpSuccessMsg, `✓ OTP sent to ${result.maskedEmail || email}`);

        // Show OTP section with animation
        otpSection.classList.add('is-visible');

        // Reset OTP boxes
        otpBoxes.forEach(box => {
          box.value = '';
          box.classList.remove('is-filled');
        });
        otpContainer.classList.remove('is-complete', 'is-error', 'is-verified');

        // Focus first OTP box
        setTimeout(() => otpBoxes[0].focus(), 400);

        // Start countdown timer
        startResendTimer();

        // Update button state
        requestOtpBtn.classList.remove('is-loading');
        requestOtpBtn.classList.add('is-sent');
        requestOtpBtn.querySelector('.btn--otp__text').textContent = 'OTP Sent';
        requestOtpBtn.disabled = true;

      } else {
        // Error from backend
        showMessage(otpErrorMsg, result.message || 'Failed to send OTP. Please try again.');
        requestOtpBtn.classList.remove('is-loading');
        requestOtpBtn.disabled = false;
      }

    } catch (error) {
      console.error('Send OTP error:', error);
      showMessage(otpErrorMsg, 'Network error. Please check your connection and try again.');
      requestOtpBtn.classList.remove('is-loading');
      requestOtpBtn.disabled = false;
    }
  }

  /* -------------------------------------------------------
     ✅ VERIFY OTP — Validate OTP with Google Apps Script
     ------------------------------------------------------- */
  async function verifyOTP() {
    const email = fields.email.input.value.trim();
    const otp = getOtpValue();

    if (!isOtpComplete()) {
      shakeOtp();
      return;
    }

    if (isVerifying) return;
    isVerifying = true;

    // Clear previous verification messages
    [otpInvalidMsg, otpExpiredVerifyMsg, otpVerifiedMsg].forEach(el => {
      el.classList.remove('is-visible');
      el.textContent = '';
    });

    try {
      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: JSON.stringify({
          action: 'verifyOTP',
          email: email,
          otp: otp
        }),
        redirect: 'follow'
      });

      const text = await response.text();
      console.log('[OTP] Verify response:', text);
      const result = JSON.parse(text);

      if (result.success) {
        // ✅ OTP Verified Successfully
        otpVerified = true;

        // Visual feedback
        otpContainer.classList.remove('is-complete', 'is-error');
        otpContainer.classList.add('is-verified');
        showMessage(otpVerifiedMsg, '✓ Email verified successfully');

        // Lock OTP boxes
        otpBoxes.forEach(box => {
          box.disabled = true;
        });

        // Stop timer
        if (timerInterval) clearInterval(timerInterval);
        otpResend.style.display = 'none';

        // Enable Next button
        checkFormValidity();

      } else {
        // ❌ Verification failed
        otpVerified = false;

        if (result.code === 'EXPIRED') {
          showMessage(otpExpiredVerifyMsg, '⚠ OTP expired. Please request a new code.');
          otpContainer.classList.remove('is-complete');
        } else {
          showMessage(otpInvalidMsg, '✗ Incorrect or expired OTP. Please try again.');
          // Shake animation
          shakeOtp();
        }

        checkFormValidity();
      }

    } catch (error) {
      console.error('Verify OTP error:', error);
      showMessage(otpInvalidMsg, 'Network error. Please try again.');
    } finally {
      isVerifying = false;
    }
  }

  /* -------------------------------------------------------
     Attach listeners to standard fields
     ------------------------------------------------------- */
  Object.keys(fields).forEach(name => {
    const input = fields[name].input;

    input.addEventListener('input', () => {
      validateField(name);
      checkFormValidity();
      updateRequestOtpButton();

      // If email changes after OTP was verified, reset OTP state
      if (name === 'email' && otpVerified) {
        otpVerified = false;
        otpRequested = false;
        otpSection.classList.remove('is-visible');
        requestOtpBtn.classList.remove('is-sent');
        requestOtpBtn.querySelector('.btn--otp__text').textContent = 'Request OTP';
        hideAllOtpMessages();
        otpBoxes.forEach(box => {
          box.value = '';
          box.disabled = false;
          box.classList.remove('is-filled');
        });
        otpContainer.classList.remove('is-complete', 'is-error', 'is-verified');
        checkFormValidity();
      }
    });

    input.addEventListener('blur', () => {
      touched.add(name);
      validateField(name);
    });
  });

  /* -------------------------------------------------------
     Restrict Phone & National ID to numeric characters only
     ------------------------------------------------------- */
  fields.phone.input.addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '');
  });

  fields.nationalId.input.addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '');
  });

  /* -------------------------------------------------------
     Request OTP Button — Click Handler
     ------------------------------------------------------- */
  requestOtpBtn.addEventListener('click', () => {
    sendOTP();
  });

  /* -------------------------------------------------------
     OTP Box — Input handler (auto-advance, numeric only)
     ------------------------------------------------------- */
  otpBoxes.forEach((box, index) => {
    // Handle input — allow only digits, auto-advance
    box.addEventListener('input', (e) => {
      // Strip non-digits
      box.value = box.value.replace(/\D/g, '');

      // Keep only last character if somehow multiple
      if (box.value.length > 1) {
        box.value = box.value.slice(-1);
      }

      // Auto-advance to next box
      if (box.value.length === 1 && index < otpBoxes.length - 1) {
        otpBoxes[index + 1].focus();
      }

      otpTouched = true;
      updateOtpVisuals();
      checkFormValidity();
    });

    // Handle keydown — backspace moves to previous box
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (box.value === '' && index > 0) {
          // Move to previous box and clear it
          otpBoxes[index - 1].value = '';
          otpBoxes[index - 1].focus();
          e.preventDefault();
        } else {
          box.value = '';
        }
        otpTouched = true;

        // Reset verification state if user is changing OTP
        if (otpVerified) {
          otpVerified = false;
          otpContainer.classList.remove('is-verified');
          hideAllOtpMessages();
        }

        updateOtpVisuals();
        checkFormValidity();
      }

      // Arrow keys navigation
      if (e.key === 'ArrowLeft' && index > 0) {
        otpBoxes[index - 1].focus();
        e.preventDefault();
      }
      if (e.key === 'ArrowRight' && index < otpBoxes.length - 1) {
        otpBoxes[index + 1].focus();
        e.preventDefault();
      }
    });

    // Handle paste — fill all boxes from pasted content
    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData)
        .getData('text')
        .replace(/\D/g, '')
        .slice(0, 6);

      if (pasteData.length > 0) {
        otpBoxes.forEach((b, i) => {
          b.value = pasteData[i] || '';
        });

        // Focus the next empty box, or last box
        const nextEmpty = Array.from(otpBoxes).findIndex(b => b.value === '');
        if (nextEmpty !== -1) {
          otpBoxes[nextEmpty].focus();
        } else {
          otpBoxes[otpBoxes.length - 1].focus();
        }

        otpTouched = true;
        updateOtpVisuals();
        checkFormValidity();
      }
    });

    // Handle focus — select content for easy overwrite
    box.addEventListener('focus', () => {
      box.select();
    });

    // Handle blur — mark as touched
    box.addEventListener('blur', () => {
      otpTouched = true;
    });
  });

  /* -------------------------------------------------------
     Resend OTP Countdown Timer
     ------------------------------------------------------- */
  function startResendTimer() {
    countdown = RESEND_COOLDOWN;

    // Reset resend area to timer mode
    otpResend.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
           stroke="currentColor" stroke-width="2" width="14" height="14">
        <path stroke-linecap="round" stroke-linejoin="round"
              d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
      </svg>
      <span id="resendText">Resend OTP available in <strong id="resendTimer">${formatTime(countdown)}</strong></span>
    `;
    otpResend.style.display = '';

    // Clear any existing interval
    if (timerInterval) clearInterval(timerInterval);

    timerInterval = setInterval(() => {
      countdown--;
      const timerEl = document.getElementById('resendTimer');
      if (timerEl) {
        timerEl.textContent = formatTime(countdown);
      }

      if (countdown <= 0) {
        clearInterval(timerInterval);
        timerInterval = null;
        // Show resend button
        otpResend.innerHTML =
          '<button class="otp-resend-btn" id="resendBtn" type="button">Resend OTP</button>';
        document.getElementById('resendBtn').addEventListener('click', () => {
          // Reset Request OTP button state
          requestOtpBtn.classList.remove('is-sent');
          requestOtpBtn.querySelector('.btn--otp__text').textContent = 'Request OTP';

          // Reset OTP verification state
          otpVerified = false;
          otpContainer.classList.remove('is-verified', 'is-complete', 'is-error');
          otpBoxes.forEach(box => {
            box.value = '';
            box.disabled = false;
            box.classList.remove('is-filled');
          });
          hideAllOtpMessages();

          // Send new OTP
          sendOTP();
        });
      }
    }, 1000);
  }

  function formatTime(seconds) {
    const mins = String(Math.floor(seconds / 60)).padStart(2, '0');
    const secs = String(seconds % 60).padStart(2, '0');
    return `${mins}:${secs}`;
  }

  /* -------------------------------------------------------
     Form Submission — Save to localStorage & Navigate
     ------------------------------------------------------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Touch all standard fields
    Object.keys(fields).forEach(name => {
      touched.add(name);
      validateField(name);
    });
    otpTouched = true;

    // Check standard fields
    const standardValid = Object.keys(fields).every(name => validateField(name));

    // Check OTP verified
    if (!otpVerified) {
      if (!otpRequested) {
        showMessage(otpErrorMsg, 'Please request an OTP to verify your email.');
      } else if (!isOtpComplete()) {
        shakeOtp();
      } else {
        showMessage(otpInvalidMsg, 'Please verify your OTP before proceeding.');
      }
      return;
    }

    if (!standardValid) return;

    // Show loading state
    nextBtn.classList.add('is-loading');
    nextBtn.disabled = true;

    // Small delay for visual feedback
    await new Promise(resolve => setTimeout(resolve, 600));

    // Save form data to localStorage
    const formData = {};
    Object.keys(fields).forEach(name => {
      formData[name] = sanitize(fields[name].input.value.trim());
    });
    formData.otpVerified = true;

    localStorage.setItem('sslvpn_step1', JSON.stringify(formData));

    // Navigate to Step 2
    window.location.href = 'page2/';
  });

  /* -------------------------------------------------------
     Restore previously saved data (if user navigates back)
     ------------------------------------------------------- */
  function restoreFormData() {
    try {
      const saved = JSON.parse(localStorage.getItem('sslvpn_step1'));
      if (!saved) return;

      // Restore standard fields
      Object.keys(fields).forEach(name => {
        if (saved[name]) {
          fields[name].input.value = saved[name];
          touched.add(name);
          validateField(name);
        }
      });

      // If OTP was previously verified, restore that state
      if (saved.otpVerified === true) {
        otpVerified = true;
        otpRequested = true;

        // Show OTP section in verified state
        otpSection.classList.add('is-visible');
        otpContainer.classList.add('is-verified');
        showMessage(otpVerifiedMsg, '✓ Email previously verified');

        // Disable OTP boxes and show placeholder
        otpBoxes.forEach(box => {
          box.value = '•';
          box.disabled = true;
          box.classList.add('is-filled');
        });

        // Update Request OTP button
        requestOtpBtn.classList.add('is-sent');
        requestOtpBtn.querySelector('.btn--otp__text').textContent = 'Verified';
        requestOtpBtn.disabled = true;

        // Hide timer
        otpResend.style.display = 'none';
      }

      checkFormValidity();
      updateRequestOtpButton();
    } catch {
      // Ignore corrupt localStorage data
    }
  }

  // Initialize
  restoreFormData();
  updateRequestOtpButton();
})();
