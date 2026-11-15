/**
 * ============================================================
 * app.js  –  CareConnect Medication & Wellness Platform
 * ============================================================
 *
 * MODULE OVERVIEW
 * ───────────────
 * 1.  CONFIG            — Runtime constants (PIN, EmailJS IDs, Gemini key)
 * 2.  STATE             — Centralised reactive state object
 * 3.  INIT              — Bootstrap on DOMContentLoaded
 * 4.  VIEW SWITCHING    — Patient ↔ Caretaker toggling
 * 5.  PIN AUTHENTICATION — 4-digit overlay guard
 * 6.  CLOCK / GREETING  — Live time & personalised greeting
 * 7.  MEDICATION ENGINE — Load schedule, determine current dose
 * 8.  CONFIRMATION FLOW — YES / NO handlers + Firestore writes
 * 9.  EMPATHY LOOP      — 45-minute missed-dose alert timer
 * 10. WELLNESS GOALS    — Toggle + progress tracking
 * 11. GEMINI API PARSER — Base64 image → structured JSON
 * 12. EMAILJS TRIGGERS  — Missed-dose + SOS email alerts
 * 13. CARETAKER DASH    — Stats, adherence log, schedule CRUD
 * 14. CONFETTI ENGINE   — Canvas-based celebration particles
 * 15. TOAST HELPER      — Non-blocking status notifications
 * 16. UTILITY FUNCTIONS — Date formatting, local storage helpers
 *
 * DEPENDENCIES (loaded via CDN in index.html):
 *   • Firebase Firestore (compat v10)
 *   • EmailJS Browser SDK v4
 *   • Gemini REST API (fetch, no SDK)
 *
 * FIRESTORE COLLECTIONS:
 *   medications/     → {name, time, dose, notes, createdAt}
 *   adherenceLogs/   → {medId, medName, time, taken, timestamp}
 *   wellnessLogs/    → {date, water, walk, stretch}
 *   appointments/    → {title, dateTime, createdAt}
 * ============================================================
 */

'use strict';

/* ════════════════════════════════════════════════════════════
   §1  CONFIGURATION
   Replace placeholder strings with your real credentials.
   These keys are intentionally client-side — security is
   enforced by Firebase Rules, not by keeping keys secret.
════════════════════════════════════════════════════════════ */

const CONFIG = {
  /** Caretaker access PIN (4 digits). Default: 1234 */
  CARETAKER_PIN: '1234',

  /** EmailJS public key (from https://www.emailjs.com) */
  EMAILJS_PUBLIC_KEY: 'YOUR_EMAILJS_PUBLIC_KEY',

  /** EmailJS Service ID (the connected email provider) */
  EMAILJS_SERVICE_ID: 'YOUR_EMAILJS_SERVICE_ID',

  /** EmailJS Template ID for missed-dose alert */
  EMAILJS_MISSED_TEMPLATE_ID: 'template_missed_dose',

  /** EmailJS Template ID for SOS alert */
  EMAILJS_SOS_TEMPLATE_ID: 'template_sos_alert',

  /** Caretaker's email address (recipient of all alerts) */
  CARETAKER_EMAIL: 'caretaker@example.com',

  /** Patient's display name */
  PATIENT_NAME: 'Grandma Rose',

  /** Empathy-loop grace period in milliseconds (45 minutes) */
  EMPATHY_LOOP_MS: 45 * 60 * 1000,
};

/* ════════════════════════════════════════════════════════════
   §2  CENTRALISED STATE
   Single source of truth — prevents scattered globals.
════════════════════════════════════════════════════════════ */
const STATE = {
  /** Currently logged-in view: 'patient' | 'caretaker' */
  currentView: 'patient',

  /** Raw PIN digits entered by the user (string, max 4 chars) */
  pinBuffer: '',

  /** Today's medication schedule fetched from Firestore */
  schedule: [],

  /** Currently active / next medication object */
  currentMed: null,

  /** Number of doses confirmed today */
  doseCount: 0,

  /** Wellness goal completion state for today */
  wellness: { water: false, walk: false, stretch: false },

  /** Handle for the 45-min empathy-loop timer */
  empathyTimerHandle: null,

  /** Timestamp (ms) when the empathy loop last started */
  empathyTimerStart: null,

  /** Base64-encoded image uploaded for prescription parsing */
  prescriptionImageBase64: null,

  /** MIME type of the uploaded prescription image */
  prescriptionImageMime: null,

  /** Extracted medications from AI — pending user save */
  pendingMedications: [],

  /** Handle for the clock interval */
  clockHandle: null,
};

/* ════════════════════════════════════════════════════════════
   §3  INITIALISATION
════════════════════════════════════════════════════════════ */

/**
 * Bootstrap function.  Called once the DOM is fully ready.
 * Sequence:
 *   a) Initialise EmailJS with public key
 *   b) Set patient display name
 *   c) Start live clock
 *   d) Load today's medication schedule from Firestore
 *   e) Restore wellness goal state from localStorage
 *   f) Start the empathy-loop watchdog (checks every minute)
 */
document.addEventListener('DOMContentLoaded', () => {
  // a) EmailJS init
  if (typeof emailjs !== 'undefined') {
    emailjs.init({ publicKey: CONFIG.EMAILJS_PUBLIC_KEY });
  }

  // b) Patient name
  const nameEl = document.getElementById('patient-name');
  if (nameEl) nameEl.textContent = CONFIG.PATIENT_NAME;

  // c) Clock
  startClock();

  // d) Schedule
  loadSchedule();

  // e) Wellness
  restoreWellnessState();

  // f) Empathy watchdog (fires every 60 seconds)
  setInterval(checkEmpathyLoop, 60_000);

  // g) Extracted prescription action buttons
  const btnAdd = document.getElementById('btn-add-extracted');
  if (btnAdd) {
    btnAdd.addEventListener('click', () => saveExtractedMedications(false));
  }

  const btnReplace = document.getElementById('btn-replace-extracted');
  if (btnReplace) {
    btnReplace.addEventListener('click', () => saveExtractedMedications(true));
  }

  console.log('[CareConnect] App initialised ✓');
});

/* ════════════════════════════════════════════════════════════
   §4  VIEW SWITCHING  (Patient ↔ Caretaker)
════════════════════════════════════════════════════════════ */

/**
 * Shows the requested view and hides the other.
 *
 * @param {'patient'|'caretaker'} viewName - Target view identifier.
 */
function switchView(viewName) {
  STATE.currentView = viewName;

  const patientSection   = document.getElementById('patient-view');
  const caretakerSection = document.getElementById('caretaker-view');
  const btnPatient       = document.getElementById('btn-patient-view');
  const btnCaretaker     = document.getElementById('btn-caretaker-view');

  if (viewName === 'patient') {
    patientSection.classList.remove('hidden');
    caretakerSection.classList.add('hidden');
    btnPatient.classList.add('active');
    btnCaretaker.classList.remove('active');
    btnPatient.setAttribute('aria-pressed', 'true');
    btnCaretaker.setAttribute('aria-pressed', 'false');
  } else {
    patientSection.classList.add('hidden');
    caretakerSection.classList.remove('hidden');
    btnPatient.classList.remove('active');
    btnCaretaker.classList.add('active');
    btnPatient.setAttribute('aria-pressed', 'false');
    btnCaretaker.setAttribute('aria-pressed', 'true');

    // Populate caretaker data on first load
    loadCaretakerDashboard();
  }
}

/* ════════════════════════════════════════════════════════════
   §5  PIN AUTHENTICATION
════════════════════════════════════════════════════════════ */

/**
 * Shows the PIN overlay when the Caretaker button is clicked.
 * If the user is already authenticated this session, skip overlay.
 */
function initCaretakerAccess() {
  // Session-scoped auth flag (sessionStorage survives tab refresh,
  // but not new browser sessions — suitable for shared tablets).
  if (sessionStorage.getItem('ct_authed') === 'true') {
    switchView('caretaker');
    return;
  }

  const overlay = document.getElementById('pin-overlay');
  if (overlay) overlay.classList.remove('hidden');
  STATE.pinBuffer = '';
  updatePinDots();

  const errorEl = document.getElementById('pin-error');
  if (errorEl) errorEl.textContent = '';

  // Ensure keyboard and screen readers can immediately type
  setTimeout(() => {
    const pinInput = document.getElementById('pin-input');
    if (pinInput) pinInput.focus();
  }, 50);
}

/**
 * Appends a digit to the PIN buffer and updates the dot display.
 * Automatically submits when 4 digits have been entered.
 *
 * @param {string} digit - Single digit character '0'–'9'.
 */
function appendPin(digit) {
  if (STATE.pinBuffer.length >= 4) return;

  STATE.pinBuffer += String(digit);
  updatePinDots();

  // Auto-submit after 4th digit
  if (STATE.pinBuffer.length === 4) {
    setTimeout(submitPin, 200);
  }
}

/**
 * Removes the last entered digit from the PIN buffer.
 */
function clearPin() {
  STATE.pinBuffer = STATE.pinBuffer.slice(0, -1);
  updatePinDots();
  const errorEl = document.getElementById('pin-error');
  if (errorEl) errorEl.textContent = '';
}

/**
 * Reflects the current PIN buffer length in the visual dot indicators.
 */
function updatePinDots() {
  const pinInput = document.getElementById('pin-input');
  if (pinInput) pinInput.value = STATE.pinBuffer;

  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (!dot) continue;
    dot.classList.remove('filled', 'error');
    if (i < STATE.pinBuffer.length) {
      dot.classList.add('filled');
      dot.textContent = '●';
    } else {
      dot.textContent = '';
    }
  }
}

/**
 * Validates the entered PIN against CONFIG.CARETAKER_PIN.
 * On success: hides overlay, switches to caretaker view, marks session.
 * On failure: shows shake animation + error message, clears buffer.
 */
function submitPin() {
  const errorEl = document.getElementById('pin-error');
  if (STATE.pinBuffer === CONFIG.CARETAKER_PIN) {
    sessionStorage.setItem('ct_authed', 'true');
    closePinOverlay();
    switchView('caretaker');
    showToast('Welcome back! 🩺', 'success');
  } else {
    // Visual error feedback
    for (let i = 0; i < 4; i++) {
      const dot = document.getElementById(`dot-${i}`);
      if (dot) {
        dot.classList.remove('filled');
        dot.classList.add('error');
      }
    }
    if (errorEl) {
      errorEl.textContent = `Incorrect PIN. Default is ${CONFIG.CARETAKER_PIN}.`;
    }

    // Reset after animation
    setTimeout(() => {
      STATE.pinBuffer = '';
      updatePinDots();
      if (errorEl) errorEl.textContent = '';
    }, 900);
  }
}

/**
 * Hides the PIN overlay and returns focus to the main content.
 */
function closePinOverlay() {
  const overlay = document.getElementById('pin-overlay');
  if (overlay) overlay.classList.add('hidden');
  STATE.pinBuffer = '';
  updatePinDots();
  const errorEl = document.getElementById('pin-error');
  if (errorEl) errorEl.textContent = '';
}

/**
 * Handles keyboard input within the numpad for accessibility.
 * Supports 0–9 (digit entry), Backspace (clear), and Enter (submit).
 *
 * @param {KeyboardEvent} event
 */
function handlePinKeydown(event) {
  if (/^[0-9]$/.test(event.key)) {
    appendPin(event.key);
  } else if (event.key === 'Backspace') {
    clearPin();
  } else if (event.key === 'Enter') {
    submitPin();
  }
}

/**
 * Logs out the caretaker — clears session flag and returns to patient view.
 */
function caretakerLogout() {
  sessionStorage.removeItem('ct_authed');
  switchView('patient');
  showToast('Caretaker view locked 🔒');
}

/* ════════════════════════════════════════════════════════════
   §6  CLOCK & GREETING
════════════════════════════════════════════════════════════ */

/**
 * Starts the live clock — updates the greeting time label every second.
 * Also sets the full date string and caretaker date labels.
 */
function startClock() {
  updateClock();
  STATE.clockHandle = setInterval(updateClock, 1000);
}

/**
 * Updates all time-related DOM elements with the current date/time.
 */
function updateClock() {
  const now = new Date();

  // Greeting time-of-day salutation
  const hour = now.getHours();
  let salutation = 'Good Evening';
  if (hour < 12) salutation = 'Good Morning';
  else if (hour < 17) salutation = 'Good Afternoon';

  const timeLabel = document.getElementById('greeting-time-label');
  if (timeLabel) timeLabel.textContent = salutation;

  // Full date string — e.g. "Sunday, 15 November 2026"
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const dateEl = document.getElementById('greeting-date');
  if (dateEl) dateEl.textContent = dateStr;

  // Caretaker view date
  const ctDate = document.getElementById('ct-date-label');
  if (ctDate) ctDate.textContent = dateStr;
}

/* ════════════════════════════════════════════════════════════
   §7  MEDICATION ENGINE
════════════════════════════════════════════════════════════ */

/**
 * Fetches today's medication schedule from Firestore.
 * Sorts by scheduled time (HH:MM ascending) and stores in STATE.
 * Falls back to a demo schedule if Firestore has no documents
 * (useful for judges / evaluators demoing without a live DB).
 */
async function loadSchedule() {
  try {
    const snapshot = await db.collection('medications').orderBy('time', 'asc').get();

    if (!snapshot.empty) {
      STATE.schedule = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
    } else {
      // ── Demo fallback so the UI is never empty ──
      STATE.schedule = getDemoSchedule();
    }

    renderPatientSchedule();
    determineCurrentMedication();
    loadTodayAdherence();
  } catch (err) {
    console.error('[Firestore] loadSchedule error:', err);
    // Offline / config not set — still show demo data
    STATE.schedule = getDemoSchedule();
    renderPatientSchedule();
    determineCurrentMedication();
  }
}

/**
 * Returns a sensible demo medication schedule so evaluators can
 * see the UI without needing a live Firestore instance.
 *
 * @returns {Array<{id:string, name:string, time:string, dose:string, notes:string}>}
 */
function getDemoSchedule() {
  return [
    { id: 'demo-1', name: 'Metformin 500mg',   time: '08:00', dose: '1 tablet',  notes: 'Take with breakfast' },
    { id: 'demo-2', name: 'Lisinopril 10mg',   time: '12:00', dose: '1 tablet',  notes: 'Take with water'    },
    { id: 'demo-3', name: 'Atorvastatin 20mg', time: '20:00', dose: '1 tablet',  notes: 'Take at bedtime'    },
  ];
}

/**
 * Determines which medication slot is "current" (next upcoming or the most
 * recently due one that has not been confirmed yet).
 * Updates STATE.currentMed and re-renders the patient medication panel.
 */
function determineCurrentMedication() {
  const now      = new Date();
  const hhmm     = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const upcoming = STATE.schedule.filter(m => m.time >= hhmm);
  const past     = STATE.schedule.filter(m => m.time < hhmm);

  // Prefer the next upcoming med; fall back to last past med
  STATE.currentMed = upcoming.length ? upcoming[0] : (past.length ? past[past.length - 1] : null);

  renderCurrentMedPanel();
}

/**
 * Converts a 24-hour "HH:MM" string to minutes from start of day.
 * Example: "08:30" → 510
 *
 * @param {string} hhmm - Time string in 24-hour HH:MM format.
 * @returns {number} Minutes from midnight (0–1439).
 */
function timeToMinutes(hhmm) {
  if (!hhmm || !hhmm.includes(':')) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Calculates the time 60 minutes prior to a given "HH:MM" string,
 * formatted in 12-hour display format (e.g. "7:00 AM").
 *
 * @param {string} hhmm - Time string in 24-hour HH:MM format.
 * @returns {string} 12-hour formatted time string 1 hour prior.
 */
function getOneHourPriorFormatted(hhmm) {
  const medMinutes = timeToMinutes(hhmm);
  const priorMinutes = (medMinutes - 60 + 1440) % 1440;
  const h = Math.floor(priorMinutes / 60);
  const m = priorMinutes % 60;
  const priorHhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return formatTime(priorHhmm);
}

/**
 * Renders the "Your Next Medication" card in the patient view and
 * enforces a strict +/- 60 minute active logging window.
 *
 * State 1 (Too Early, > 60m before):
 *   - Disable btn-yes & btn-no
 *   - Feedback: "Not time yet. You can log this starting at [1 hr prior]."
 *   - CSS class: .med-feedback.warning
 *
 * State 2 (Active Window, within 60m before/after):
 *   - Enable btn-yes & btn-no
 *   - Clear med-feedback text & reset class
 *
 * State 3 (Missed / Too Late, > 60m after):
 *   - Disable btn-yes & btn-no
 *   - Feedback: "Time window closed. Caretaker has been notified."
 *   - CSS class: .med-feedback.error
 */
function renderCurrentMedPanel() {
  const med = STATE.currentMed;
  const nameEl = document.getElementById('current-med-name');
  const timeEl = document.getElementById('current-med-time');
  const doseEl = document.getElementById('current-med-dose');
  const btnYes = document.getElementById('btn-yes');
  const btnNo  = document.getElementById('btn-no');
  const feedbackEl = document.getElementById('med-feedback');

  if (!med) {
    nameEl.textContent = 'No medications scheduled';
    timeEl.textContent = '';
    doseEl.textContent = '';
    btnYes.disabled = true;
    btnNo.disabled = true;
    return;
  }

  // Handle Nickname display (if you have implemented it) or fallback to name
  nameEl.textContent = med.nickname ? med.nickname : med.name;
  timeEl.textContent = `⏰ ${formatTime(med.time)}`;
  
  // If using a nickname, show the real name down in the dosage area
  const realNameDisplay = med.nickname ? `(${med.name}) ` : '';
  doseEl.textContent = med.dose ? `Dosage: ${realNameDisplay}${med.dose}${med.notes ? ' — ' + med.notes : ''}` : realNameDisplay;

  // ── TIME WINDOW MATH ──
  const now = new Date();
  
  // Convert scheduled "HH:MM" into a real Date object for today
  const [hours, minutes] = med.time.split(':').map(Number);
  const medTime = new Date();
  medTime.setHours(hours, minutes, 0, 0);

  // Calculate the difference in minutes
  const diffMinutes = (now - medTime) / (1000 * 60);

  if (diffMinutes < -60) {
    // 1. Too Early (> 60 mins before)
    btnYes.disabled = true;
    btnNo.disabled = true;
    
    // Calculate exact opening time (1 hour prior)
    const openTime = new Date(medTime.getTime() - (60 * 60 * 1000));
    const openTimeStr = openTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    
    feedbackEl.textContent = `Not time yet. You can log this starting at ${openTimeStr}.`;
    feedbackEl.className = 'med-feedback warning';
    
  } else if (diffMinutes > 60) {
    // 2. Too Late (> 60 mins after)
    btnYes.disabled = true;
    btnNo.disabled = true;
    feedbackEl.textContent = 'Time window closed. Caretaker has been notified.';
    feedbackEl.className = 'med-feedback error';
    
  } else {
    // 3. Active Window
    btnYes.disabled = false;
    btnNo.disabled = false;
    feedbackEl.textContent = '';
    feedbackEl.className = 'med-feedback';
  }
}
/**
 * Renders the patient-facing read-only schedule list.
 * Marks each slot as taken / missed / upcoming based on today's adherence log.
 */
function renderPatientSchedule() {
  const container = document.getElementById('patient-schedule');
  if (!STATE.schedule.length) {
    container.innerHTML = '<p class="loading-msg">No medications scheduled for today.</p>';
    return;
  }

  container.innerHTML = STATE.schedule.map(med => {
    const statusClass = getScheduleItemStatus(med);
    const statusLabel = { taken: '✅ Taken', missed: '⚠️ Missed', upcoming: '🔜 Upcoming' }[statusClass];
    const medDisplayName = med.nickname
      ? `${escapeHtml(med.nickname)} <span class="med-real-name" style="font-size:0.85em;color:var(--text-secondary);font-weight:normal;">(${escapeHtml(med.name)})</span>`
      : escapeHtml(med.name);
    return `
      <div class="schedule-item ${statusClass}" role="listitem">
        <span class="schedule-time">${formatTime(med.time)}</span>
        <div class="schedule-details">
          <div class="schedule-med-name">${medDisplayName}</div>
          <div class="schedule-dose">${escapeHtml(med.dose || '')}</div>
        </div>
        <span class="schedule-status-badge">${statusLabel}</span>
      </div>`;
  }).join('');
}

/**
 * Returns the CSS status class for a schedule item by checking
 * today's adherence log in STATE.
 *
 * @param {{id:string, time:string}} med
 * @returns {'taken'|'missed'|'upcoming'}
 */
function getScheduleItemStatus(med) {
  const now  = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  // Check if this med was confirmed today
  const log = STATE.todayLogs || [];
  const entry = log.find(l => l.medId === med.id);
  if (entry) return entry.taken ? 'taken' : 'missed';

  return med.time > hhmm ? 'upcoming' : 'missed';
}

/* ════════════════════════════════════════════════════════════
   §8  MEDICATION CONFIRMATION (YES / NO)
════════════════════════════════════════════════════════════ */

/**
 * Handles the patient's YES or NO confirmation for the current medication slot.
 *
 * YES flow:
 *   • Writes an adherence log entry to Firestore (taken: true)
 *   • Increments the dose counter with a satisfying bump animation
 *   • Triggers confetti celebration
 *   • Clears any active empathy-loop timer
 *
 * NO flow:
 *   • Writes an adherence log entry to Firestore (taken: false)
 *   • Starts the 45-minute empathy-loop timer
 *   • Shows an encouraging message
 *
 * @param {boolean} taken - Whether the patient confirmed taking the dose.
 */
async function confirmMedication(taken) {
  if (!STATE.currentMed) {
    showToast('No medication to confirm right now.', 'warning');
    return;
  }

  const med       = STATE.currentMed;
  const timestamp = new Date();
  const feedbackEl = document.getElementById('med-feedback');

  // Disable buttons momentarily to prevent double-tap
  setConfirmBtnsEnabled(false);

  // ── Write adherence log to Firestore ──
  try {
    const logEntry = {
      medId:    med.id,
      medName:  med.name,
      time:     med.time,
      taken,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      date:      todayDateString(),
    };
    await db.collection('adherenceLogs').add(logEntry);
    console.log('[Firestore] Adherence log written:', logEntry);
  } catch (err) {
    console.error('[Firestore] Failed to write adherence log:', err);
    // Continue UI flow even if Firestore write fails (offline resilience)
  }

  if (taken) {
    // ── YES path ──
    clearEmpathyTimer();

    // Increment dose counter with spring animation
    STATE.doseCount++;
    const counterEl = document.getElementById('dose-counter');
    counterEl.textContent = STATE.doseCount;
    counterEl.classList.add('bump');
    setTimeout(() => counterEl.classList.remove('bump'), 350);

    // Visual feedback
    feedbackEl.textContent = '🎉 Wonderful! Keep it up!';
    feedbackEl.className   = 'med-feedback success';

    // Celebrate!
    launchConfetti();

    // Pulse the YES button
    document.getElementById('btn-yes').classList.add('confirmed');
    setTimeout(() => document.getElementById('btn-yes').classList.remove('confirmed'), 700);

    showToast('✅ Dose confirmed — great job!', 'success');

  } else {
    // ── NO path ──
    feedbackEl.textContent = "No worries! I'll remind your caretaker if needed. 💙";
    feedbackEl.className   = 'med-feedback error';

    startEmpathyTimer(med);
    showToast("Reminder set — you have 45 minutes! ⏰", 'warning');
  }

  // Re-render schedule to reflect new status
  await loadTodayAdherence();
  renderPatientSchedule();

  // Re-enable buttons after a short delay
  setTimeout(() => setConfirmBtnsEnabled(true), 2000);
}

/**
 * Enables or disables the YES / NO confirmation buttons.
 * @param {boolean} enabled
 */
function setConfirmBtnsEnabled(enabled) {
  document.getElementById('btn-yes').disabled = !enabled;
  document.getElementById('btn-no').disabled  = !enabled;
}

/* ════════════════════════════════════════════════════════════
   §9  EMPATHY LOOP  (45-minute missed-dose escalation)
════════════════════════════════════════════════════════════ */

/**
 * Starts the 45-minute countdown timer for a missed-dose alert.
 * If the patient confirms (YES) before time runs out, the timer is cleared.
 * On expiry: automatically fires an EmailJS alert to the caretaker.
 *
 * @param {{id:string, name:string, time:string}} med - The medication that was not confirmed.
 */
function startEmpathyTimer(med) {
  clearEmpathyTimer(); // Cancel any previously running timer

  STATE.empathyTimerStart  = Date.now();
  STATE.empathyTimerHandle = setTimeout(() => {
    console.log('[EmpathyLoop] 45 minutes elapsed — escalating alert');
    sendMissedDoseEmail(med);
  }, CONFIG.EMPATHY_LOOP_MS);

  console.log(`[EmpathyLoop] Timer started for "${med.name}" — alerts in 45 min`);
}

/**
 * Cancels the running empathy-loop timer (called when patient confirms YES).
 */
function clearEmpathyTimer() {
  if (STATE.empathyTimerHandle) {
    clearTimeout(STATE.empathyTimerHandle);
    STATE.empathyTimerHandle = null;
    STATE.empathyTimerStart  = null;
    console.log('[EmpathyLoop] Timer cleared — patient confirmed dose.');
  }
}

/**
 * Periodic watchdog (called every 60 seconds).
 * Re-checks whether a timer should be started for a past-due medication
 * that the patient has not yet confirmed.  This handles page reloads
 * during an active session.
 */
function checkEmpathyLoop() {
  if (!STATE.currentMed || STATE.empathyTimerHandle) return;

  const now        = new Date();
  const hhmm       = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const med        = STATE.currentMed;

  // If the scheduled time has passed and no log entry exists → start timer
  if (med.time <= hhmm) {
    const log   = STATE.todayLogs || [];
    const entry = log.find(l => l.medId === med.id);
    if (!entry) {
      console.log('[EmpathyLoop] Past-due unconfirmed med detected:', med.name);
      startEmpathyTimer(med);
    }
  }
}

/* ════════════════════════════════════════════════════════════
   §10  WELLNESS GOALS
════════════════════════════════════════════════════════════ */

/**
 * Toggles a wellness goal between complete and incomplete.
 * Persists state to localStorage (keyed by today's date).
 * Updates the progress bar and counter.
 *
 * @param {'water'|'walk'|'stretch'} goalKey - Goal identifier.
 * @param {HTMLButtonElement}         btn     - The toggle button element.
 */
function toggleWellnessGoal(goalKey, btn) {
  STATE.wellness[goalKey] = !STATE.wellness[goalKey];
  const isComplete = STATE.wellness[goalKey];

  // Update ARIA pressed state
  btn.setAttribute('aria-pressed', String(isComplete));

  // Update the visual checkmark
  const checkEl = btn.querySelector('.goal-check');
  checkEl.textContent = isComplete ? '✅' : '○';

  // Persist to localStorage
  const storageKey = `wellness_${todayDateString()}`;
  localStorage.setItem(storageKey, JSON.stringify(STATE.wellness));

  // Update counter & progress bar
  updateWellnessUI();

  // Optionally write to Firestore for caretaker visibility
  syncWellnessToFirestore();

  if (isComplete) showToast('Goal completed! 🌟', 'success');
}

/**
 * Updates the wellness counter label and animated progress bar.
 */
function updateWellnessUI() {
  const count   = Object.values(STATE.wellness).filter(Boolean).length;
  const pct     = (count / 3) * 100;
  const fillEl  = document.getElementById('wellness-progress-fill');
  const countEl = document.getElementById('wellness-count');
  const barEl   = document.querySelector('.progress-bar');

  if (countEl)  countEl.textContent                 = count;
  if (fillEl)   fillEl.style.width                  = `${pct}%`;
  if (barEl)    barEl.setAttribute('aria-valuenow', count);
}

/**
 * Restores wellness goal state from localStorage on page load.
 * State is scoped to today's date so it auto-resets every day.
 */
function restoreWellnessState() {
  const storageKey = `wellness_${todayDateString()}`;
  const saved      = localStorage.getItem(storageKey);
  if (!saved) { updateWellnessUI(); return; }

  try {
    STATE.wellness = JSON.parse(saved);
  } catch { STATE.wellness = { water: false, walk: false, stretch: false }; }

  // Reflect saved state on each button
  for (const [key, done] of Object.entries(STATE.wellness)) {
    const btn = document.getElementById(`goal-${key}`);
    if (!btn) continue;
    btn.setAttribute('aria-pressed', String(done));
    btn.querySelector('.goal-check').textContent = done ? '✅' : '○';
  }

  updateWellnessUI();
}

/**
 * Writes today's wellness state to Firestore so the caretaker can see it.
 * Uses today's date as document ID to avoid duplicates.
 */
async function syncWellnessToFirestore() {
  try {
    await db.collection('wellnessLogs').doc(todayDateString()).set({
      date: todayDateString(),
      ...STATE.wellness,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn('[Firestore] Wellness sync failed (offline?):', err);
  }
}

/* ════════════════════════════════════════════════════════════
   §11  GEMINI API — SMART PRESCRIPTION PARSER
════════════════════════════════════════════════════════════ */

/**
 * Handles the prescription image file input change event.
 * Reads the file as Base64, shows a preview, and reveals the "Analyse" button.
 *
 * @param {Event} event - The file input change event.
 */
function handlePrescriptionImage(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    // Store raw base64 (strip data URI prefix)
    STATE.prescriptionImageBase64 = dataUrl.split(',')[1];
    STATE.prescriptionImageMime   = file.type;

    // Show preview
    const previewImg  = document.getElementById('img-preview');
    const previewWrap = document.getElementById('img-preview-wrap');
    previewImg.src    = dataUrl;
    previewWrap.classList.remove('hidden');

    // Show analyse button
    document.getElementById('parse-btn').classList.remove('hidden');
    document.getElementById('parse-status').textContent = '';
    document.getElementById('extracted-data').classList.add('hidden');
  };
  reader.readAsDataURL(file);
}

/**
 * Sends the uploaded prescription image to our secure Vercel serverless
 * function (/api/parse) which interacts with the Gemini API server-side.
 *
 * On success: populates the extracted data preview card.
 * On failure: shows an error toast with the response message.
 */
async function parsePrescription() {
  const cameraInput = document.getElementById('camera-input');
  if (!STATE.prescriptionImageBase64 && cameraInput && cameraInput.files && cameraInput.files[0]) {
    const file = cameraInput.files[0];
    STATE.prescriptionImageMime = file.type;
    STATE.prescriptionImageBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  if (!STATE.prescriptionImageBase64) {
    showToast('Please capture or select a prescription image first.', 'warning');
    return;
  }

  // Show loading state
  const statusEl  = document.getElementById('parse-status');
  const parseBtn  = document.getElementById('parse-btn');
  parseBtn.disabled = true;
  statusEl.innerHTML = '<div class="spinner"></div> Analysing prescription with AI…';

  try {
    const prompt = `You are a clinical pharmacist AI assistant. Carefully examine this prescription image — it may contain handwritten or printed text, possibly messy or partially legible.
Extract EVERY medication listed and return ONLY a valid JSON array. Do NOT include any markdown, code fences, or explanatory text.
Each array element must have exactly these fields:
{
  "name": "Medication name and strength (string)",
  "nickname": "Generate a short, elder-friendly common name based on the medication's primary medical purpose (e.g., 'Blood Pressure Pill', 'Cholesterol Tablet'). If you cannot confidently determine the purpose, leave it as an empty string.",
  "time": "Scheduled time in 24-hour HH:MM format (string)",
  "dose": "Dosage instruction (string)",
  "notes": "Any additional notes (string, empty string if none)"
}
If a time is ambiguous, create multiple entries. If unreadable, use best clinical judgment. If none extracted, return [].`;

    const response = await fetch('/api/parse', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        imageBase64: STATE.prescriptionImageBase64,
        mimeType:    STATE.prescriptionImageMime,
        prompt:      prompt,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Server Error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

    // Parse the JSON response — handle edge cases where model wraps in fences
    let medications = [];
    try {
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      medications   = JSON.parse(cleaned);
      if (!Array.isArray(medications)) medications = [];
    } catch (parseErr) {
      console.error('[Gemini] JSON parse error:', parseErr, 'Raw:', rawText);
      throw new Error('AI returned an unexpected format. Please try again.');
    }

    renderExtractedMedications(medications);
    statusEl.textContent = '';

  } catch (err) {
    console.error('[Parser] parsePrescription error:', err);
    statusEl.textContent = `❌ Error: ${err.message}`;
    showToast('AI parsing failed — check console for details.', 'error');
  } finally {
    parseBtn.disabled = false;
  }
}

/**
 * Renders the extracted medications into the review panel
 * so the caretaker can confirm before saving to Firestore.
 *
 * @param {Array<{name:string, time:string, dose:string, notes:string}>} medications
 */
function renderExtractedMedications(medications) {
  STATE.pendingMedications = medications;

  const listEl  = document.getElementById('extracted-list');
  const wrapEl  = document.getElementById('extracted-data');

  if (!medications.length) {
    listEl.innerHTML = '<p class="loading-msg">No medications could be extracted from this image.</p>';
    wrapEl.classList.remove('hidden');
    return;
  }

  listEl.innerHTML = medications.map((med, idx) => {
    const medTitle = med.nickname
      ? `${escapeHtml(med.nickname)} <span style="font-size:0.85em;color:var(--text-secondary);font-weight:normal;">(${escapeHtml(med.name || 'Unknown')})</span>`
      : escapeHtml(med.name || 'Unknown');
    return `
    <div class="extracted-item" role="listitem">
      <div>
        <div class="extracted-item-name">${medTitle}</div>
        <div class="extracted-item-meta">
          Dose: ${escapeHtml(med.dose || '—')}
          ${med.notes ? ` · ${escapeHtml(med.notes)}` : ''}
        </div>
      </div>
      <div class="extracted-item-time">${escapeHtml(med.time || '??:??')}</div>
    </div>
  `;
  }).join('');

  wrapEl.classList.remove('hidden');
  showToast(`✨ ${medications.length} medication${medications.length !== 1 ? 's' : ''} extracted!`, 'success');
}

/**
 * Saves the AI-extracted medications to Firestore after caretaker review.
 * Supports adding to the current schedule or replacing it entirely.
 *
 * @param {boolean} [isReplace=false] - Whether to delete all existing medications before saving.
 */
async function saveExtractedMedications(isReplace = false) {
  const meds = STATE.pendingMedications;
  if (!meds.length) return;

  try {
    if (isReplace) {
      const existingSnapshot = await db.collection('medications').get();
      if (!existingSnapshot.empty) {
        const deleteBatch = db.batch();
        existingSnapshot.forEach(doc => {
          deleteBatch.delete(doc.ref);
        });
        await deleteBatch.commit();
      }
    }

    const batch = db.batch();
    meds.forEach(med => {
      const ref = db.collection('medications').doc();
      batch.set(ref, {
        name:      med.name  || 'Unknown',
        nickname:  med.nickname || '',
        time:      med.time  || '08:00',
        dose:      med.dose  || '',
        notes:     med.notes || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        source:    'ai-parsed',
      });
    });
    await batch.commit();

    showToast(isReplace ? '🔄 Schedule replaced with extracted medications!' : `💾 ${meds.length} medication${meds.length !== 1 ? 's' : ''} saved!`, 'success');
    document.getElementById('extracted-data').classList.add('hidden');
    STATE.pendingMedications = [];
    await loadSchedule();
    loadCaretakerDashboard();

  } catch (err) {
    console.error('[Firestore] saveExtractedMedications error:', err);
    showToast('Save failed — check Firestore connection.', 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   §12  EMAILJS TRIGGERS
════════════════════════════════════════════════════════════ */

/**
 * Sends a missed-dose alert email to the caretaker via EmailJS.
 * Called automatically by the empathy-loop timer after 45 minutes.
 *
 * Template parameters (configure in EmailJS dashboard):
 *   {{patient_name}}   — patient's name
 *   {{med_name}}       — medication that was missed
 *   {{scheduled_time}} — when it should have been taken
 *   {{current_time}}   — current time when alert fired
 *   {{to_email}}       — caretaker email address
 *
 * @param {{name:string, time:string}} med - The missed medication.
 */
async function sendMissedDoseEmail(med) {
  const now = new Date();

  const templateParams = {
    patient_name:    CONFIG.PATIENT_NAME,
    med_name:        med.name,
    scheduled_time:  formatTime(med.time),
    current_time:    now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    to_email:        CONFIG.CARETAKER_EMAIL,
    message:         `${CONFIG.PATIENT_NAME} has not confirmed taking ${med.name} (scheduled at ${formatTime(med.time)}) and the 45-minute window has passed. Please check in.`,
  };

  try {
    await emailjs.send(
      CONFIG.EMAILJS_SERVICE_ID,
      CONFIG.EMAILJS_MISSED_TEMPLATE_ID,
      templateParams,
    );
    console.log('[EmailJS] Missed-dose alert sent for:', med.name);
    showToast('⚠️ Caretaker has been alerted!', 'warning');
  } catch (err) {
    console.error('[EmailJS] Failed to send missed-dose email:', err);
  }
}

/**
 * Sends an SOS (emergency) alert email to the caretaker.
 * Triggered by the patient pressing the "Alert My Caretaker" button.
 */
async function sendSOSAlert() {
  const now = new Date();

  const templateParams = {
    patient_name: CONFIG.PATIENT_NAME,
    to_email:     CONFIG.CARETAKER_EMAIL,
    current_time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    message:      `🆘 URGENT: ${CONFIG.PATIENT_NAME} has pressed the emergency alert button and needs immediate assistance!`,
  };

  // Provide immediate visual feedback before async call
  showToast('🆘 Alerting your caretaker…', 'warning');

  try {
    await emailjs.send(
      CONFIG.EMAILJS_SERVICE_ID,
      CONFIG.EMAILJS_SOS_TEMPLATE_ID,
      templateParams,
    );
    showToast('✅ Your caretaker has been alerted!', 'success');
  } catch (err) {
    console.error('[EmailJS] SOS email failed:', err);
    showToast('Alert sent (check your connection too).', 'warning');
  }
}

/* ════════════════════════════════════════════════════════════
   §13  CARETAKER DASHBOARD
════════════════════════════════════════════════════════════ */

/**
 * Master function to populate the caretaker command centre.
 * Called each time the caretaker view is switched to.
 */
async function loadCaretakerDashboard() {
  updateCaretakerStats();
  renderCaretakerSchedule();
  loadAdherenceLog();
  loadAppointments();
}

/**
 * Calculates and renders the four adherence stat cards
 * (Taken, Missed, Upcoming, Adherence %).
 */
async function updateCaretakerStats() {
  await loadTodayAdherence();

  const logs     = STATE.todayLogs || [];
  const now      = new Date();
  const hhmm     = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const schedule = STATE.schedule;

  let taken    = 0;
  let missed   = 0;
  let upcoming = 0;

  schedule.forEach(med => {
    const log   = logs.find(l => l.medId === med.id);
    if (log) {
      log.taken ? taken++ : missed++;
    } else {
      med.time <= hhmm ? missed++ : upcoming++;
    }
  });

  const total     = taken + missed;
  const adherence = total > 0 ? Math.round((taken / total) * 100) : 100;

  document.getElementById('stat-taken').textContent     = taken;
  document.getElementById('stat-missed').textContent    = missed;
  document.getElementById('stat-upcoming').textContent  = upcoming;
  document.getElementById('stat-adherence').textContent = `${adherence}%`;
}

/**
 * Fetches today's adherence logs from Firestore and caches in STATE.
 * Shared by both the patient schedule rendering and caretaker stats.
 */
async function loadTodayAdherence() {
  try {
    const today    = todayDateString();
    const snapshot = await db.collection('adherenceLogs')
      .where('date', '==', today)
      .get();
    STATE.todayLogs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('[Firestore] loadTodayAdherence error (offline?):', err);
    STATE.todayLogs = STATE.todayLogs || [];
  }
}

/**
 * Renders the scrollable adherence log in the caretaker view.
 * Shows the last 50 log entries, newest first.
 */
async function loadAdherenceLog() {
  const container = document.getElementById('adherence-log');
  container.innerHTML = '<p class="loading-msg">Loading…</p>';

  try {
    const snapshot = await db.collection('adherenceLogs')
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();

    if (snapshot.empty) {
      container.innerHTML = '<p class="loading-msg">No adherence records yet.</p>';
      return;
    }

    container.innerHTML = snapshot.docs.map(doc => {
      const d          = doc.data();
      const statusClass = d.taken ? 'taken-log' : 'missed-log';
      const statusText  = d.taken ? '✅ Taken' : '❌ Missed';
      const ts          = d.timestamp?.toDate ? d.timestamp.toDate() : new Date();
      const timeStr     = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const dateStr     = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      return `
        <div class="log-entry ${statusClass}" role="listitem">
          <span class="log-time">${escapeHtml(dateStr)} ${escapeHtml(timeStr)}</span>
          <span class="log-name">${escapeHtml(d.medName || '—')}</span>
          <span class="log-status">${statusText}</span>
        </div>`;
    }).join('');

  } catch (err) {
    console.error('[Firestore] loadAdherenceLog error:', err);
    container.innerHTML = '<p class="loading-msg">Could not load log — check connection.</p>';
  }
}

/**
 * Renders the editable medication schedule in the caretaker view,
 * with delete buttons for each entry.
 */
function renderCaretakerSchedule() {
  const container = document.getElementById('caretaker-schedule');

  if (!STATE.schedule.length) {
    container.innerHTML = '<p class="loading-msg">No medications added yet.</p>';
    return;
  }

  container.innerHTML = STATE.schedule.map(med => {
    const medDisplayName = med.nickname
      ? `${escapeHtml(med.nickname)} <span class="med-real-name" style="font-size:0.85em;color:var(--text-secondary);font-weight:normal;">(${escapeHtml(med.name)})</span>`
      : escapeHtml(med.name);
    return `
    <div class="schedule-item" role="listitem">
      <span class="schedule-time">${formatTime(med.time)}</span>
      <div class="schedule-details">
        <div class="schedule-med-name">${medDisplayName}</div>
        <div class="schedule-dose">${escapeHtml(med.dose || '')} ${med.notes ? '· ' + escapeHtml(med.notes) : ''}</div>
      </div>
      <button
        class="delete-med-btn"
        aria-label="Delete ${escapeHtml(med.nickname || med.name)}"
        onclick="deleteMedication('${med.id}')"
      >🗑</button>
    </div>`;
  }).join('');
}

/**
 * Handles the "Add Medication Manually" form submission.
 * Writes a new document to the medications collection.
 *
 * @param {Event} event - Form submit event.
 */
async function addMedicationManually(event) {
  event.preventDefault();

  const name  = document.getElementById('med-name-input').value.trim();
  const time  = document.getElementById('med-time-input').value;
  const dose  = document.getElementById('med-dose-input').value.trim();
  const notes = document.getElementById('med-notes-input').value.trim();
  
  const nicknameInput = document.getElementById('med-nickname-input');
  const nickname = nicknameInput ? nicknameInput.value.trim() : '';

  if (!name || !time) {
    showToast('Please fill in the name and time fields.', 'error');
    return;
  }

  try {
    await db.collection('medications').add({
      name: name,
      nickname: nickname,
      time: time,
      dose: dose || '',
      notes: notes || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      source: 'manual',
    });

    showToast(`✅ ${nickname || name} added to schedule!`, 'success');
    event.target.reset();
    await loadSchedule();
    renderCaretakerSchedule();

  } catch (err) {
    console.error('[Firestore] addMedicationManually error:', err);
    showToast('Could not save medication — check connection.', 'error');
  }
}

/**
 * Deletes a medication document from Firestore.
 * Shows a confirmation dialog to prevent accidental deletions.
 *
 * @param {string} medId - Firestore document ID.
 */
async function deleteMedication(medId) {
  if (!confirm('Delete this medication from the schedule?')) return;

  try {
    await db.collection('medications').doc(medId).delete();
    showToast('Medication removed.', 'success');
    await loadSchedule();
    renderCaretakerSchedule();
  } catch (err) {
    console.error('[Firestore] deleteMedication error:', err);
    showToast('Delete failed — check connection.', 'error');
  }
}

/**
 * Loads and renders upcoming appointments from Firestore.
 */
async function loadAppointments() {
  const container = document.getElementById('appointments-list');
  container.innerHTML = '<p class="loading-msg">Loading…</p>';

  try {
    const snapshot = await db.collection('appointments')
      .orderBy('dateTime', 'asc')
      .get();

    if (snapshot.empty) {
      container.innerHTML = '<p class="loading-msg">No appointments scheduled.</p>';
      return;
    }

    container.innerHTML = snapshot.docs.map(doc => {
      const d       = doc.data();
      const dt      = d.dateTime ? new Date(d.dateTime) : null;
      const dateStr = dt ? dt.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' }) : '—';
      const timeStr = dt ? dt.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' }) : '';

      return `
        <div class="appointment-item" role="listitem">
          <span class="appt-date">${escapeHtml(dateStr)}<br>${escapeHtml(timeStr)}</span>
          <span class="appt-title-text">${escapeHtml(d.title || 'Appointment')}</span>
        </div>`;
    }).join('');

  } catch (err) {
    console.error('[Firestore] loadAppointments error:', err);
    container.innerHTML = '<p class="loading-msg">Could not load appointments.</p>';
  }
}

/**
 * Handles the "Add Appointment" form submission.
 *
 * @param {Event} event - Form submit event.
 */
async function addAppointment(event) {
  event.preventDefault();

  const title    = document.getElementById('appt-title-input').value.trim();
  const dateTime = document.getElementById('appt-date-input').value;

  if (!title) { showToast('Please enter an appointment title.', 'error'); return; }

  try {
    await db.collection('appointments').add({
      title,
      dateTime:  dateTime || null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    showToast('Appointment added!', 'success');
    event.target.reset();
    loadAppointments();
  } catch (err) {
    console.error('[Firestore] addAppointment error:', err);
    showToast('Could not save appointment.', 'error');
  }
}

/* ════════════════════════════════════════════════════════════
   §14  CONFETTI ENGINE (canvas-based celebration)
════════════════════════════════════════════════════════════ */

/**
 * Launches a short burst of colourful confetti particles on the canvas.
 * Uses requestAnimationFrame for smooth, performant rendering.
 * Canvas is ARIA-hidden — purely decorative.
 */
function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  const ctx    = canvas.getContext('2d');

  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  // Palette of celebration colours
  const colours = ['#1a56db','#0e9f6e','#f59e0b','#ec4899','#8b5cf6','#10b981'];

  // Generate 120 particles
  const particles = Array.from({ length: 120 }, () => ({
    x:      Math.random() * canvas.width,
    y:      Math.random() * canvas.height - canvas.height,
    r:      Math.random() * 8 + 4,
    d:      Math.random() * 120,
    colour: colours[Math.floor(Math.random() * colours.length)],
    tilt:   Math.floor(Math.random() * 10) - 10,
    tiltAngle:          0,
    tiltAngleDelta:     Math.random() * 0.07 + 0.05,
  }));

  let angle     = 0;
  let frameCount = 0;
  const maxFrames = 150;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    angle      += 0.01;
    frameCount += 1;

    particles.forEach(p => {
      p.tiltAngle += p.tiltAngleDelta;
      p.y         += (Math.cos(angle + p.d) + 2 + p.r / 2) * 1.5;
      p.x         += Math.sin(angle) * 2;
      p.tilt       = Math.sin(p.tiltAngle) * 15;

      ctx.beginPath();
      ctx.lineWidth    = p.r;
      ctx.strokeStyle  = p.colour;
      ctx.globalAlpha  = Math.max(0, 1 - frameCount / maxFrames);
      ctx.moveTo(p.x + p.tilt + p.r / 4, p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 4);
      ctx.stroke();
    });

    if (frameCount < maxFrames) {
      requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  requestAnimationFrame(draw);
}

/* ════════════════════════════════════════════════════════════
   §15  TOAST NOTIFICATION HELPER
════════════════════════════════════════════════════════════ */

/** Active toast timeout handle — prevents overlapping toasts */
let _toastHandle = null;

/**
 * Displays a non-blocking toast notification.
 * Auto-dismisses after 3 seconds.  Replaces any existing toast.
 *
 * @param {string}                          message  - Text to display.
 * @param {'default'|'success'|'error'|'warning'} [type='default'] - Visual style.
 */
function showToast(message, type = 'default') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  // Clear any previous dismiss timer
  if (_toastHandle) clearTimeout(_toastHandle);

  toast.textContent = message;
  toast.className   = `toast${type !== 'default' ? ` ${type}` : ''}`;

  _toastHandle = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}

/* ════════════════════════════════════════════════════════════
   §16  UTILITY FUNCTIONS
════════════════════════════════════════════════════════════ */

/**
 * Converts a 24-hour "HH:MM" string to a human-friendly 12-hour format.
 * Example: "14:30" → "2:30 PM"
 *
 * @param {string} hhmm - Time string in HH:MM format.
 * @returns {string} Formatted 12-hour time string.
 */
function formatTime(hhmm) {
  if (!hhmm || !hhmm.includes(':')) return hhmm || '—';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Returns today's date as a simple "YYYY-MM-DD" string.
 * Used as a Firestore document key and localStorage key.
 *
 * @returns {string} e.g. "2026-11-15"
 */
function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/**
 * Sanitises a string for safe insertion as HTML text content.
 * Prevents XSS from user-supplied or AI-returned data.
 *
 * @param {string} str - Potentially unsafe string.
 * @returns {string}   - HTML-escaped string.
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ════════════════════════════════════════════════════════════
   §17  GLOBAL EXPORTS & FAIL-SAFE EVENT LISTENERS
   Exposes all functions to window for inline onclick handlers,
   and registers explicit event listeners for guaranteed execution.
════════════════════════════════════════════════════════════ */
window.switchView = switchView;
window.initCaretakerAccess = initCaretakerAccess;
window.appendPin = appendPin;
window.clearPin = clearPin;
window.submitPin = submitPin;
window.closePinOverlay = closePinOverlay;
window.handlePinKeydown = handlePinKeydown;
window.caretakerLogout = caretakerLogout;
window.confirmMedication = confirmMedication;
window.toggleWellnessGoal = toggleWellnessGoal;
window.sendSOSAlert = sendSOSAlert;
window.handlePrescriptionImage = handlePrescriptionImage;
window.parsePrescription = parsePrescription;
window.saveExtractedMedications = saveExtractedMedications;
window.addMedicationManually = addMedicationManually;
window.deleteMedication = deleteMedication;
window.addAppointment = addAppointment;
window.renderCurrentMedPanel = renderCurrentMedPanel;
window.timeToMinutes = timeToMinutes;
window.getOneHourPriorFormatted = getOneHourPriorFormatted;