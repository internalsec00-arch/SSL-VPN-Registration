/**
 * ============================================================
 *  SSL-VPN Registration — Step 3 (AUP & Submit)
 *  Handles AUP consent, Google Apps Script submission,
 *  and result modal.
 * ============================================================
 */
(() => {
  'use strict';

  /* -------------------------------------------------------
     ⚙️ CONFIGURATION
     Replace this URL with your deployed Google Apps Script
     Web App URL (same one used in Page 1 for OTP).
     ------------------------------------------------------- */
  const GAS_URL = 'https://script.google.com/macros/s/AKfycbxC3jfs0YFQS8bwLb89UuSjBpEw7bGc4XkZudYXKk04U8bTDT8rUbc9jGHTTgSdqlhqMw/exec';

  /* -------------------------------------------------------
     DOM References
     ------------------------------------------------------- */
  const form = document.getElementById('aupForm');
  const submitBtn = document.getElementById('submitBtn');
  const backBtn = document.getElementById('backBtn');
  const aupCheckbox = document.getElementById('aupCheckbox');
  const aupError = document.getElementById('aupError');
  const policyBox = document.getElementById('policyBox');
  const scrollHint = document.getElementById('scrollHint');

  // Modal elements
  const modalOverlay = document.getElementById('modalOverlay');
  const modalSuccess = document.getElementById('modalSuccess');
  const modalError = document.getElementById('modalError');
  const modalSummary = document.getElementById('modalSummary');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const errorCloseBtn = document.getElementById('errorCloseBtn');
  const retryBtn = document.getElementById('retryBtn');
  const errorMessage = document.getElementById('errorMessage');

  /* -------------------------------------------------------
     Guard: Ensure Steps 1 & 2 were completed
     ------------------------------------------------------- */
  if (!localStorage.getItem('sslvpn_step1') || !localStorage.getItem('sslvpn_step2')) {
    window.location.href = !localStorage.getItem('sslvpn_step1') ? '../' : '../page2/';
  }

  /* -------------------------------------------------------
     Scroll Hint — Hide when user scrolls near bottom
     ------------------------------------------------------- */
  let userHasScrolled = false;

  policyBox.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = policyBox;
    if ((scrollTop + clientHeight) / scrollHeight > 0.8 && !userHasScrolled) {
      userHasScrolled = true;
      scrollHint.classList.add('is-hidden');
    }
  });

  if (policyBox.scrollHeight <= policyBox.clientHeight) {
    scrollHint.classList.add('is-hidden');
  }

  /* -------------------------------------------------------
     AUP Checkbox — Enable / Disable Submit button
     ------------------------------------------------------- */
  let hasInteracted = false;

  aupCheckbox.addEventListener('change', () => {
    hasInteracted = true;
    const checked = aupCheckbox.checked;
    submitBtn.disabled = !checked;

    if (hasInteracted) {
      aupError.textContent = checked ? '' : 'You must accept the AUP to submit your registration.';
      aupError.classList.toggle('is-visible', !checked);
    }
  });

  /* -------------------------------------------------------
     Back Button — Navigate to Step 2
     ------------------------------------------------------- */
  backBtn.addEventListener('click', () => {
    window.location.href = '../page2/';
  });

  /* -------------------------------------------------------
     Collect all registration data from localStorage
     ------------------------------------------------------- */
  function collectAllData() {
    const step1 = JSON.parse(localStorage.getItem('sslvpn_step1') || '{}');
    const step2 = JSON.parse(localStorage.getItem('sslvpn_step2') || '{}');

    return {
      firstName: step1.firstName || '',
      lastName: step1.lastName || '',
      company: step1.company || '',
      nationalId: step1.nationalId || '',
      phone: step1.phone || '',
      email: step1.email || '',
      privacyAccepted: step2.accepted ? 'Yes' : 'No',
      privacyDate: step2.acceptedAt || '',
      aupAccepted: 'Yes',
      aupDate: new Date().toISOString()
    };
  }

  /* -------------------------------------------------------
     Sanitize input — strip HTML tags
     ------------------------------------------------------- */
  function sanitize(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* -------------------------------------------------------
     Submit to Google Apps Script Backend
     ------------------------------------------------------- */
  async function submitToGAS(data) {
    // Frontend validation — ensure all required fields exist
    if (!data.firstName || !data.lastName || !data.company || !data.nationalId || !data.phone || !data.email) {
      console.error('[Page3] Missing required fields:', data);
      throw new Error('ข้อมูลไม่ครบ กรุณากลับไปกรอกข้อมูลใน Step 1 ใหม่');
    }

    const payload = JSON.stringify({
      action: 'submitForm',
      firstName: sanitize(data.firstName),
      lastName: sanitize(data.lastName),
      company: sanitize(data.company),
      nationalId: sanitize(data.nationalId),
      phone: sanitize(data.phone),
      email: data.email,
      privacyAccepted: data.privacyAccepted,
      aupAccepted: data.aupAccepted
    });

    console.log('[Page3] Submitting to GAS:', payload);

    try {
      const response = await fetch(GAS_URL, {
        method: 'POST',
        body: payload,
        redirect: 'follow'
      });

      // Read the response text first, then parse as JSON
      const text = await response.text();
      console.log('[Page3] GAS raw response:', text);

      let result;
      try {
        result = JSON.parse(text);
      } catch (parseErr) {
        // Non-JSON response — if HTTP status is OK, treat as success
        if (response.ok || response.redirected) {
          console.log('[Page3] Non-JSON but HTTP OK — treating as success');
          return { success: true, message: 'Registration submitted.' };
        }
        throw new Error('เซิร์ฟเวอร์ตอบกลับผิดปกติ (Status: ' + response.status + ')');
      }

      // GAS returned a valid JSON response — check success flag
      if (!result.success) {
        throw new Error(result.message || 'การส่งข้อมูลล้มเหลว');
      }

      return result;

    } catch (err) {
      // If the error is from GAS (validation error), do NOT retry with no-cors
      // Only use no-cors fallback for actual network/CORS failures
      if (err.message && (
        err.message.includes('fields are required') ||
        err.message.includes('ข้อมูลไม่ครบ') ||
        err.message.includes('Submission failed') ||
        err.message.includes('ล้มเหลว') ||
        err.message.includes('ผิดปกติ')
      )) {
        // This is a server-side validation error — don't retry
        console.error('[Page3] GAS validation error:', err.message);
        throw err;
      }

      // Network error — try no-cors fallback
      console.warn('[Page3] Network error, trying no-cors fallback:', err.message);
      try {
        await fetch(GAS_URL, {
          method: 'POST',
          mode: 'no-cors',
          body: payload
        });
        console.log('[Page3] no-cors fallback sent successfully');
        return { success: true, message: 'Registration submitted.' };
      } catch (fallbackErr) {
        console.error('[Page3] All fetch attempts failed:', fallbackErr);
        throw new Error('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
      }
    }
  }

  /* -------------------------------------------------------
     Show Modal — Success or Error
     ------------------------------------------------------- */
  function showModal(type, data) {
    if (type === 'success') {
      modalSuccess.style.display = '';
      modalError.style.display = 'none';

      // Build summary rows
      modalSummary.innerHTML = '';
      const maskId = (id) => id.length > 4 ? '*'.repeat(id.length - 4) + id.slice(-4) : id;
      const maskPhone = (ph) => ph.length > 4 ? '*'.repeat(ph.length - 4) + ph.slice(-4) : ph;
      const maskEmail = (em) => { const [l, d] = em.split('@'); return l.length <= 1 ? '*@' + d : l[0] + '***@' + d; };

      const rows = [
        { label: 'First Name', value: data.firstName },
        { label: 'Last Name', value: data.lastName },
        { label: 'Company', value: data.company },
        { label: 'National ID', value: maskId(data.nationalId) },
        { label: 'Phone', value: maskPhone(data.phone) },
        { label: 'Email', value: maskEmail(data.email) },
        { label: 'Privacy', value: '✓ Accepted' },
        { label: 'AUP', value: '✓ Accepted' }
      ];

      rows.forEach(r => {
        const row = document.createElement('div');
        row.className = 'modal__summary-row';
        row.innerHTML =
          '<span class="modal__summary-label">' + sanitize(r.label) + '</span>' +
          '<span class="modal__summary-value">' + sanitize(r.value) + '</span>';
        modalSummary.appendChild(row);
      });
    } else {
      modalSuccess.style.display = 'none';
      modalError.style.display = '';
      errorMessage.textContent = data || 'An error occurred. Please try again.';
    }

    modalOverlay.classList.add('is-visible');
    modalOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function hideModal() {
    modalOverlay.classList.remove('is-visible');
    modalOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  /* -------------------------------------------------------
     Form Submission
     ------------------------------------------------------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!aupCheckbox.checked) {
      hasInteracted = true;
      aupError.textContent = 'You must accept the AUP to submit your registration.';
      aupError.classList.add('is-visible');
      return;
    }

    // Show loading state
    submitBtn.classList.add('is-loading');
    submitBtn.disabled = true;

    const data = collectAllData();

    try {
      // Submit to Google Apps Script
      await submitToGAS(data);

      // Clear all localStorage data on success
      localStorage.removeItem('sslvpn_step1');
      localStorage.removeItem('sslvpn_step2');

      // Show success modal
      showModal('success', data);

    } catch (err) {
      console.error('Submission error:', err);
      showModal('error', err.message || 'Failed to submit registration. Please check your connection and try again.');

      // Re-enable button on error
      submitBtn.classList.remove('is-loading');
      submitBtn.disabled = false;
    }
  });

  /* -------------------------------------------------------
     Modal Button Handlers
     ------------------------------------------------------- */

  // Success — Done button: redirect to start
  modalCloseBtn.addEventListener('click', () => {
    hideModal();
    window.location.href = '../';
  });

  // Error — Close button
  errorCloseBtn.addEventListener('click', () => {
    hideModal();
  });

  // Error — Retry button: re-trigger submit
  retryBtn.addEventListener('click', () => {
    hideModal();
    // Small delay then re-submit
    setTimeout(() => {
      form.dispatchEvent(new Event('submit', { cancelable: true }));
    }, 300);
  });

  // Close modal on overlay click
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      hideModal();
    }
  });

  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay.classList.contains('is-visible')) {
      hideModal();
    }
  });
})();
