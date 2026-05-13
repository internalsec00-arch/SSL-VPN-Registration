/**
 * SSL-VPN Registration Form — Step 2 (Privacy Policy)
 * Handles consent checkbox, scroll detection, and navigation.
 */
(() => {
  'use strict';

  /* -------------------------------------------------------
     DOM References
     ------------------------------------------------------- */
  const form            = document.getElementById('policyForm');
  const nextBtn         = document.getElementById('nextBtn');
  const backBtn         = document.getElementById('backBtn');
  const consentCheckbox = document.getElementById('consentCheckbox');
  const consentError    = document.getElementById('consentError');
  const policyBox       = document.getElementById('policyBox');
  const scrollHint      = document.getElementById('scrollHint');

  /* -------------------------------------------------------
     Guard: Ensure Step 1 was completed
     If no Step 1 data in localStorage, redirect back.
     ------------------------------------------------------- */
  if (!localStorage.getItem('sslvpn_step1')) {
    window.location.href = '../';
  }

  /* -------------------------------------------------------
     Scroll Hint — Hide once user scrolls near the bottom
     ------------------------------------------------------- */
  let userHasScrolled = false;

  policyBox.addEventListener('scroll', () => {
    const { scrollTop, scrollHeight, clientHeight } = policyBox;
    const scrolledPercent = (scrollTop + clientHeight) / scrollHeight;

    // Hide hint when user has scrolled past 80%
    if (scrolledPercent > 0.8 && !userHasScrolled) {
      userHasScrolled = true;
      scrollHint.classList.add('is-hidden');
    }
  });

  // Also hide on very short content that doesn't scroll
  if (policyBox.scrollHeight <= policyBox.clientHeight) {
    scrollHint.classList.add('is-hidden');
  }

  /* -------------------------------------------------------
     Consent Checkbox — Enable / Disable Next button
     ------------------------------------------------------- */
  let hasInteracted = false;

  consentCheckbox.addEventListener('change', () => {
    hasInteracted = true;
    const isChecked = consentCheckbox.checked;

    // Enable / disable Next button
    nextBtn.disabled = !isChecked;

    // Show / hide error
    if (hasInteracted) {
      consentError.textContent = isChecked ? '' : 'You must accept the Privacy Policy to proceed.';
      consentError.classList.toggle('is-visible', !isChecked);
    }
  });

  /* -------------------------------------------------------
     Back Button — Navigate to Step 1
     ------------------------------------------------------- */
  backBtn.addEventListener('click', () => {
    window.location.href = '../index.html';
  });

  /* -------------------------------------------------------
     Form Submission — Save consent & navigate to Step 3
     ------------------------------------------------------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Ensure checkbox is checked
    if (!consentCheckbox.checked) {
      hasInteracted = true;
      consentError.textContent = 'You must accept the Privacy Policy to proceed.';
      consentError.classList.add('is-visible');
      return;
    }

    // Show loading state
    nextBtn.classList.add('is-loading');
    nextBtn.disabled = true;

    // Simulate saving delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Save consent to localStorage
    const consentData = {
      accepted: true,
      acceptedAt: new Date().toISOString()
    };
    localStorage.setItem('sslvpn_step2', JSON.stringify(consentData));

    // Navigate to Step 3
    window.location.href = '../page3/';
  });

  /* -------------------------------------------------------
     Restore state (if user navigates back from Step 3)
     ------------------------------------------------------- */
  function restoreState() {
    try {
      const saved = JSON.parse(localStorage.getItem('sslvpn_step2'));
      if (saved && saved.accepted) {
        consentCheckbox.checked = true;
        nextBtn.disabled = false;
      }
    } catch {
      // Ignore corrupt data
    }
  }

  restoreState();
})();
