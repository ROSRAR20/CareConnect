'use strict';

// --- CONFIGURATION ---
const CONFIG = {
  CARETAKER_PIN: '1234',
  EMAILJS_PUBLIC_KEY: 'qFhlLXs7hGlscPU7d',
  EMAILJS_SERVICE_ID: 'service_b9op7vi',
  EMAILJS_MISSED_TEMPLATE_ID: 'template_ytwtarz',
  EMAILJS_SOS_TEMPLATE_ID: 'template_sos_alert',
  CARETAKER_EMAIL: 'caretaker@example.com',
  PATIENT_NAME: 'Grandma Rose',
  EMPATHY_LOOP_MS: 45 * 60 * 1000,
};

// --- STATE ---
const STATE = {
  currentView: 'patient',
  pinBuffer: '',
  schedule: [],
  currentMed: null,
  doseCount: 0,
  wellness: { water: false, walk: false, stretch: false },
  empathyTimerHandle: null,
  empathyTimerStart: null,
  prescriptionImageBase64: null,
  prescriptionImageMime: null,
  pendingMedications: [],
  clockHandle: null,
  todayLogs: [],
};

// --- DOM & UTILITY HELPERS ---
const $ = (id) => document.getElementById(id);

function parseTodayTime(hhmm) {
  if (!hhmm || !hhmm.includes(':')) return new Date();
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function formatMedDisplayName(med) {
  return med.nickname
    ? `${escapeHtml(med.nickname)} <span class="med-real-name" style="font-size:0.85em;color:var(--text-secondary);font-weight:normal;">(${escapeHtml(med.name)})</span>`
    : escapeHtml(med.name || 'Unknown');
}

function createMedicationDoc(med, source) {
  return {
    name:      med.name || 'Unknown',
    nickname:  med.nickname || '',
    time:      med.time || '08:00',
    dose:      med.dose || '',
    notes:     med.notes || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    source,
  };
}

function resetPinState() {
  STATE.pinBuffer = '';
  updatePinDots();
  const errorEl = $('pin-error');
  if (errorEl) errorEl.textContent = '';
}

// --- INITIALISATION ---
document.addEventListener('DOMContentLoaded', () => {
  if (typeof emailjs !== 'undefined' && CONFIG.EMAILJS_PUBLIC_KEY && !CONFIG.EMAILJS_PUBLIC_KEY.includes('YOUR_')) {
    emailjs.init(CONFIG.EMAILJS_PUBLIC_KEY);
  }

  const nameEl = $('patient-name');
  if (nameEl) nameEl.textContent = CONFIG.PATIENT_NAME;

  startClock();
  loadSchedule();
  restoreWellnessState();
  setInterval(checkEmpathyLoop, 60_000);

  const btnAdd = $('btn-add-extracted');
  if (btnAdd) {
    btnAdd.addEventListener('click', () => saveExtractedMedications(false));
  }

  const btnReplace = $('btn-replace-extracted');
  if (btnReplace) {
    btnReplace.addEventListener('click', () => saveExtractedMedications(true));
  }

  const cameraInput = $('camera-input');
  if (cameraInput) {
    cameraInput.addEventListener('change', handlePrescriptionImage);
  }

  const galleryInput = $('gallery-input');
  if (galleryInput) {
    galleryInput.addEventListener('change', handlePrescriptionImage);
  }

  console.log('[CareConnect] App initialised ✓');
});

// --- VIEW SWITCHING ---
function switchView(viewName) {
  STATE.currentView = viewName;

  const patientSection   = $('patient-view');
  const caretakerSection = $('caretaker-view');
  const btnPatient       = $('btn-patient-view');
  const btnCaretaker     = $('btn-caretaker-view');

  const isPatient = viewName === 'patient';
  if (patientSection) patientSection.classList.toggle('hidden', !isPatient);
  if (caretakerSection) caretakerSection.classList.toggle('hidden', isPatient);

  if (btnPatient) {
    btnPatient.classList.toggle('active', isPatient);
    btnPatient.setAttribute('aria-pressed', String(isPatient));
  }
  if (btnCaretaker) {
    btnCaretaker.classList.toggle('active', !isPatient);
    btnCaretaker.setAttribute('aria-pressed', String(!isPatient));
  }

  if (!isPatient) {
    loadCaretakerDashboard();
  }
}

// --- PIN AUTHENTICATION ---
function initCaretakerAccess() {
  if (sessionStorage.getItem('ct_authed') === 'true') {
    switchView('caretaker');
    return;
  }

  const overlay = $('pin-overlay');
  if (overlay) overlay.classList.remove('hidden');
  resetPinState();

  setTimeout(() => {
    const pinInput = $('pin-input');
    if (pinInput) pinInput.focus();
  }, 50);
}

function appendPin(digit) {
  if (STATE.pinBuffer.length >= 4) return;
  STATE.pinBuffer += String(digit);
  updatePinDots();

  if (STATE.pinBuffer.length === 4) {
    setTimeout(submitPin, 200);
  }
}

function clearPin() {
  STATE.pinBuffer = STATE.pinBuffer.slice(0, -1);
  updatePinDots();
  const errorEl = $('pin-error');
  if (errorEl) errorEl.textContent = '';
}

function updatePinDots() {
  const pinInput = $('pin-input');
  if (pinInput) pinInput.value = STATE.pinBuffer;

  for (let i = 0; i < 4; i++) {
    const dot = $(`dot-${i}`);
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

function submitPin() {
  const errorEl = $('pin-error');
  if (STATE.pinBuffer === CONFIG.CARETAKER_PIN) {
    sessionStorage.setItem('ct_authed', 'true');
    closePinOverlay();
    switchView('caretaker');
    showToast('Welcome back! 🩺', 'success');
  } else {
    for (let i = 0; i < 4; i++) {
      const dot = $(`dot-${i}`);
      if (dot) {
        dot.classList.remove('filled');
        dot.classList.add('error');
      }
    }
    if (errorEl) {
      errorEl.textContent = `Incorrect PIN. Default is ${CONFIG.CARETAKER_PIN}.`;
    }
    setTimeout(resetPinState, 900);
  }
}

function closePinOverlay() {
  const overlay = $('pin-overlay');
  if (overlay) overlay.classList.add('hidden');
  resetPinState();
}

function handlePinKeydown(event) {
  if (/^[0-9]$/.test(event.key)) {
    appendPin(event.key);
  } else if (event.key === 'Backspace') {
    clearPin();
  } else if (event.key === 'Enter') {
    submitPin();
  }
}

function caretakerLogout() {
  sessionStorage.removeItem('ct_authed');
  switchView('patient');
  showToast('Caretaker view locked 🔒');
}

// --- CLOCK & GREETING ---
function startClock() {
  updateClock();
  STATE.clockHandle = setInterval(updateClock, 1000);
}

function updateClock() {
  const now = new Date();
  const hour = now.getHours();

  let salutation = 'Good Evening';
  if (hour < 12) salutation = 'Good Morning';
  else if (hour < 17) salutation = 'Good Afternoon';

  const timeLabel = $('greeting-time-label');
  if (timeLabel) timeLabel.textContent = salutation;

  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const dateEl = $('greeting-date');
  if (dateEl) dateEl.textContent = dateStr;

  const ctDate = $('ct-date-label');
  if (ctDate) ctDate.textContent = dateStr;
}

// --- MEDICATION ENGINE ---
async function loadSchedule() {
  try {
    const snapshot = await db.collection('medications').orderBy('time', 'asc').get();
    STATE.schedule = !snapshot.empty
      ? snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      : getDemoSchedule();

    await loadTodayAdherence();
    renderPatientSchedule();
    determineCurrentMedication();
  } catch (err) {
    console.error('[Firestore] loadSchedule error:', err);
    // --- AI FALLBACK ---
    STATE.schedule = getDemoSchedule();
    await loadTodayAdherence();
    renderPatientSchedule();
    determineCurrentMedication();
  }
}

function getDemoSchedule() {
  return [
    { id: 'demo-1', name: 'Metformin 500mg',   nickname: 'Sugar Pill',          time: '08:00', dose: '1 tablet',  notes: 'Take with breakfast' },
    { id: 'demo-2', name: 'Lisinopril 10mg',   nickname: 'Blood Pressure Pill', time: '12:00', dose: '1 tablet',  notes: 'Take with water'    },
    { id: 'demo-3', name: 'Atorvastatin 20mg', nickname: 'Cholesterol Pill',    time: '20:00', dose: '1 tablet',  notes: 'Take at bedtime'    },
  ];
}

function isMedTakenToday(medId) {
  const logs = STATE.todayLogs || [];
  return logs.some(l => l.medId === medId && l.taken);
}

function determineCurrentMedication() {
  if (!STATE.schedule || !STATE.schedule.length) {
    STATE.currentMed = null;
    renderCurrentMedPanel();
    return;
  }

  const now = new Date();
  const sorted = [...STATE.schedule].sort((a, b) => a.time.localeCompare(b.time));
  const unTakenMeds = sorted.filter(med => !isMedTakenToday(med.id));

  if (!unTakenMeds.length) {
    STATE.currentMed = null;
    renderCurrentMedPanel();
    return;
  }

  const activeMed = unTakenMeds.find(med => {
    if (!med.time || !med.time.includes(':')) return false;
    const medTime = parseTodayTime(med.time);
    return now < new Date(medTime.getTime() + 60 * 60 * 1000);
  });

  STATE.currentMed = activeMed || unTakenMeds[unTakenMeds.length - 1];
  renderCurrentMedPanel();
}

function timeToMinutes(hhmm) {
  if (!hhmm || !hhmm.includes(':')) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function getOneHourPriorFormatted(hhmm) {
  const medMinutes = timeToMinutes(hhmm);
  const priorMinutes = (medMinutes - 60 + 1440) % 1440;
  const h = Math.floor(priorMinutes / 60);
  const m = priorMinutes % 60;
  const priorHhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return formatTime(priorHhmm);
}

// --- TIME WINDOW VALIDATION (+/- 60 min) ---
function renderCurrentMedPanel() {
  const med = STATE.currentMed;
  const nameEl = $('current-med-name');
  const timeEl = $('current-med-time');
  const doseEl = $('current-med-dose');
  const btnYes = $('btn-yes');
  const btnNo  = $('btn-no');
  const feedbackEl = $('med-feedback');

  if (!med) {
    const allTaken = STATE.schedule && STATE.schedule.length > 0 && STATE.schedule.every(m => isMedTakenToday(m.id));
    if (nameEl) nameEl.textContent = allTaken ? 'All medications completed today! 🎉' : 'No medications scheduled';
    if (timeEl) timeEl.textContent = allTaken ? 'Great job staying on track!' : '';
    if (doseEl) doseEl.textContent = '';
    if (btnYes) btnYes.disabled = true;
    if (btnNo)  btnNo.disabled = true;
    if (feedbackEl) {
      feedbackEl.textContent = '';
      feedbackEl.className = 'med-feedback';
    }
    return;
  }

  if (nameEl) nameEl.textContent = STATE.currentMed.nickname;
  if (timeEl) timeEl.textContent = `⏰ ${formatTime(med.time)}`;
  if (doseEl) {
    doseEl.textContent = `Dosage: (${STATE.currentMed.name}) ${STATE.currentMed.dose}`;
  }

  const now = new Date();
  const medTime = parseTodayTime(med.time);
  const diffMinutes = (now - medTime) / (1000 * 60);

  if (diffMinutes < -60) {
    if (btnYes) btnYes.disabled = true;
    if (btnNo)  btnNo.disabled = true;
    const openTime = new Date(medTime.getTime() - (60 * 60 * 1000));
    const openTimeStr = openTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (feedbackEl) {
      feedbackEl.textContent = `Not time yet. You can log this starting at ${openTimeStr}.`;
      feedbackEl.className = 'med-feedback warning';
    }
  } else if (diffMinutes > 60) {
    if (btnYes) btnYes.disabled = true;
    if (btnNo)  btnNo.disabled = true;
    if (feedbackEl) {
      feedbackEl.textContent = 'Time window closed. Caretaker has been notified.';
      feedbackEl.className = 'med-feedback error';
    }
  } else {
    if (btnYes) btnYes.disabled = false;
    if (btnNo)  btnNo.disabled = false;
    if (feedbackEl) {
      feedbackEl.textContent = '';
      feedbackEl.className = 'med-feedback';
    }
  }
}

function renderPatientSchedule() {
  const container = $('patient-schedule');
  if (!container) return;

  if (!STATE.schedule.length) {
    container.innerHTML = '<p class="loading-msg">No medications scheduled for today.</p>';
    return;
  }

  container.innerHTML = STATE.schedule.map(med => {
    const statusClass = getScheduleItemStatus(med);
    const statusLabel = { taken: '✅ Taken', missed: '⚠️ Missed', upcoming: '🔜 Upcoming' }[statusClass];
    return `
      <div class="schedule-item ${statusClass}" role="listitem">
        <span class="schedule-time">${formatTime(med.time)}</span>
        <div class="schedule-details">
          <div class="schedule-med-name">${formatMedDisplayName(med)}</div>
          <div class="schedule-dose">${escapeHtml(med.dose || '')}</div>
        </div>
        <span class="schedule-status-badge">${statusLabel}</span>
      </div>`;
  }).join('');
}

function getScheduleItemStatus(med) {
  const now  = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  const log = STATE.todayLogs || [];
  const takenEntry = log.find(l => l.medId === med.id && l.taken);
  if (takenEntry) return 'taken';
  const missedEntry = log.find(l => l.medId === med.id && !l.taken);
  if (missedEntry) return 'missed';

  return med.time > hhmm ? 'upcoming' : 'missed';
}

// --- CONFIRMATION FLOW ---
async function confirmMedication(taken) {
  if (!STATE.currentMed) {
    showToast('No medication to confirm right now.', 'warning');
    return;
  }

  const med = STATE.currentMed;
  const feedbackEl = $('med-feedback');

  setConfirmBtnsEnabled(false);

  // Optimistically register today's adherence in local state
  if (!STATE.todayLogs) STATE.todayLogs = [];
  STATE.todayLogs.push({
    medId:     med.id,
    medName:   med.name,
    time:      med.time,
    taken,
    timestamp: new Date(),
    date:      todayDateString(),
  });

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
  } catch (err) {
    console.error('[Firestore] Failed to write adherence log:', err);
  }

  if (taken) {
    clearEmpathyTimer();

    STATE.doseCount++;
    const counterEl = $('dose-counter');
    if (counterEl) {
      counterEl.textContent = STATE.doseCount;
      counterEl.classList.add('bump');
      setTimeout(() => counterEl.classList.remove('bump'), 350);
    }

    launchConfetti();

    const btnYes = $('btn-yes');
    if (btnYes) {
      btnYes.classList.add('confirmed');
      setTimeout(() => btnYes.classList.remove('confirmed'), 700);
    }

    showToast('✅ Dose confirmed — great job!', 'success');
  } else {
    if (feedbackEl) {
      feedbackEl.textContent = "No worries! I'll remind your caretaker if needed. 💙";
      feedbackEl.className   = 'med-feedback error';
    }

    // --- EMAILJS: Send Caretaker Alert ---
    const templateParams = {
      patient_name: "Grandma Rose",
      medication_name: STATE.currentMed ? (STATE.currentMed.nickname || STATE.currentMed.name) : "",
      med_name: STATE.currentMed ? (STATE.currentMed.nickname || STATE.currentMed.name) : "",
      time: STATE.currentMed ? STATE.currentMed.time : "",
      scheduled_time: STATE.currentMed ? formatTime(STATE.currentMed.time) : "",
      message: "Missed dose alert triggered from the CareConnect Patient Dashboard."
    };

    emailjs.send("service_b9op7vi", "template_ytwtarz", templateParams, "qFhlLXs7hGlscPU7d")
      .then(function(response) {
        console.log('✅ Caretaker Email Sent!', response.status, response.text);
        showToast("Caretaker Notified", "info");
      }, function(error) {
        console.error('❌ Email Failed...', error);
      });

    startEmpathyTimer(med);
    showToast("Reminder set — you have 45 minutes! ⏰", 'warning');
  }

  await loadTodayAdherence();
  renderPatientSchedule();
  determineCurrentMedication();

  if (!taken) {
    setTimeout(() => {
      if (STATE.currentMed) {
        const medTime = parseTodayTime(STATE.currentMed.time);
        const diffMinutes = (new Date() - medTime) / (1000 * 60);
        if (diffMinutes >= -60 && diffMinutes <= 60) {
          setConfirmBtnsEnabled(true);
        }
      }
    }, 1200);
  }
}

function setConfirmBtnsEnabled(enabled) {
  const btnYes = $('btn-yes');
  const btnNo  = $('btn-no');
  if (btnYes) btnYes.disabled = !enabled;
  if (btnNo)  btnNo.disabled  = !enabled;
}

// --- EMPATHY LOOP (45-min escalation) ---
function startEmpathyTimer(med) {
  clearEmpathyTimer();

  STATE.empathyTimerStart  = Date.now();
  STATE.empathyTimerHandle = setTimeout(() => {
    sendMissedDoseEmail(med);
  }, CONFIG.EMPATHY_LOOP_MS);
}

function clearEmpathyTimer() {
  if (STATE.empathyTimerHandle) {
    clearTimeout(STATE.empathyTimerHandle);
    STATE.empathyTimerHandle = null;
    STATE.empathyTimerStart  = null;
  }
}

function checkEmpathyLoop() {
  if (!STATE.currentMed || STATE.empathyTimerHandle) return;

  const now  = new Date();
  const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const med  = STATE.currentMed;

  if (med.time <= hhmm) {
    const log   = STATE.todayLogs || [];
    const entry = log.find(l => l.medId === med.id);
    if (!entry) {
      startEmpathyTimer(med);
    }
  }
}

// --- WELLNESS GOALS ---
function toggleWellnessGoal(goalKey, btn) {
  STATE.wellness[goalKey] = !STATE.wellness[goalKey];
  const isComplete = STATE.wellness[goalKey];

  btn.setAttribute('aria-pressed', String(isComplete));
  const checkEl = btn.querySelector('.goal-check');
  if (checkEl) checkEl.textContent = isComplete ? '✅' : '○';

  const storageKey = `wellness_${todayDateString()}`;
  localStorage.setItem(storageKey, JSON.stringify(STATE.wellness));

  updateWellnessUI();
  syncWellnessToFirestore();

  if (isComplete) showToast('Goal completed! 🌟', 'success');
}

function updateWellnessUI() {
  const count   = Object.values(STATE.wellness).filter(Boolean).length;
  const pct     = (count / 3) * 100;
  const fillEl  = $('wellness-progress-fill');
  const countEl = $('wellness-count');
  const barEl   = document.querySelector('.progress-bar');

  if (countEl)  countEl.textContent = count;
  if (fillEl)   fillEl.style.width  = `${pct}%`;
  if (barEl)    barEl.setAttribute('aria-valuenow', count);
}

function restoreWellnessState() {
  const storageKey = `wellness_${todayDateString()}`;
  const saved      = localStorage.getItem(storageKey);
  if (!saved) { updateWellnessUI(); return; }

  try {
    STATE.wellness = JSON.parse(saved);
  } catch {
    STATE.wellness = { water: false, walk: false, stretch: false };
  }

  for (const [key, done] of Object.entries(STATE.wellness)) {
    const btn = $(`goal-${key}`);
    if (!btn) continue;
    btn.setAttribute('aria-pressed', String(done));
    const checkEl = btn.querySelector('.goal-check');
    if (checkEl) checkEl.textContent = done ? '✅' : '○';
  }

  updateWellnessUI();
}

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

// --- GEMINI API PARSER ---
function handlePrescriptionImage(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    STATE.prescriptionImageBase64 = dataUrl.split(',')[1];
    STATE.prescriptionImageMime   = file.type;

    const previewImg  = $('img-preview');
    const previewWrap = $('img-preview-wrap');
    if (previewImg) previewImg.src = dataUrl;
    if (previewWrap) previewWrap.classList.remove('hidden');

    const parseBtn = $('parse-btn');
    if (parseBtn) parseBtn.classList.remove('hidden');
    const parseStatus = $('parse-status');
    if (parseStatus) parseStatus.textContent = '';
    const extractedData = $('extracted-data');
    if (extractedData) extractedData.classList.add('hidden');
  };
  reader.readAsDataURL(file);
}

async function parsePrescription() {
  const cameraInput  = $('camera-input');
  const galleryInput = $('gallery-input');
  const file = cameraInput?.files?.[0] || galleryInput?.files?.[0];

  if (!STATE.prescriptionImageBase64 && file) {
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

  const statusEl = $('parse-status');
  const parseBtn = $('parse-btn');
  if (parseBtn) parseBtn.disabled = true;
  if (statusEl) statusEl.innerHTML = '<div class="spinner"></div> Analysing prescription with AI…';

  try {
    const response = await fetch('/api/parse', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        imageBase64: STATE.prescriptionImageBase64,
        mimeType:    STATE.prescriptionImageMime,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Server Error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

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
    if (statusEl) statusEl.textContent = '';

  } catch (err) {
    console.error('[Parser] parsePrescription error:', err);
    if (statusEl) statusEl.textContent = `❌ Error: ${err.message}`;
    showToast('AI parsing failed — check console for details.', 'error');
  } finally {
    if (parseBtn) parseBtn.disabled = false;
  }
}

function renderExtractedMedications(medications) {
  STATE.pendingMedications = medications;

  const listEl = $('extracted-list');
  const wrapEl = $('extracted-data');

  if (!medications.length) {
    if (listEl) listEl.innerHTML = '<p class="loading-msg">No medications could be extracted from this image.</p>';
    if (wrapEl) wrapEl.classList.remove('hidden');
    return;
  }

  if (listEl) {
    listEl.innerHTML = medications.map(med => `
      <div class="extracted-item" role="listitem">
        <div>
          <div class="extracted-item-name">${formatMedDisplayName(med)}</div>
          <div class="extracted-item-meta">
            Dose: ${escapeHtml(med.dose || '—')}
            ${med.notes ? ` · ${escapeHtml(med.notes)}` : ''}
          </div>
        </div>
        <div class="extracted-item-time">${escapeHtml(med.time || '??:??')}</div>
      </div>
    `).join('');
  }

  if (wrapEl) wrapEl.classList.remove('hidden');
  showToast(`✨ ${medications.length} medication${medications.length !== 1 ? 's' : ''} extracted!`, 'success');
}

async function saveExtractedMedications(isReplace = false) {
  const meds = STATE.pendingMedications;
  if (!meds.length) return;

  try {
    if (isReplace) {
      const existingSnapshot = await db.collection('medications').get();
      if (!existingSnapshot.empty) {
        const deleteBatch = db.batch();
        existingSnapshot.forEach(doc => deleteBatch.delete(doc.ref));
        await deleteBatch.commit();
      }
    }

    const batch = db.batch();
    meds.forEach(med => {
      const ref = db.collection('medications').doc();
      batch.set(ref, createMedicationDoc(med, 'ai-parsed'));
    });
    await batch.commit();

    showToast(isReplace ? '🔄 Schedule replaced with extracted medications!' : `💾 ${meds.length} medication${meds.length !== 1 ? 's' : ''} saved!`, 'success');
    const extractedData = $('extracted-data');
    if (extractedData) extractedData.classList.add('hidden');
    STATE.pendingMedications = [];
    await loadSchedule();
    loadCaretakerDashboard();

  } catch (err) {
    console.error('[Firestore] saveExtractedMedications error:', err);
    showToast('Save failed — check Firestore connection.', 'error');
  }
}

// --- EMAIL ALERTS ---
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
    await emailjs.send(CONFIG.EMAILJS_SERVICE_ID, CONFIG.EMAILJS_MISSED_TEMPLATE_ID, templateParams, CONFIG.EMAILJS_PUBLIC_KEY);
    showToast('⚠️ Caretaker has been alerted!', 'warning');
  } catch (err) {
    console.error('[EmailJS] Failed to send missed-dose email:', err);
  }
}

async function sendSOSAlert() {
  const now = new Date();
  const templateParams = {
    patient_name: CONFIG.PATIENT_NAME,
    to_email:     CONFIG.CARETAKER_EMAIL,
    current_time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
    message:      `🆘 URGENT: ${CONFIG.PATIENT_NAME} has pressed the emergency alert button and needs immediate assistance!`,
  };

  showToast('🆘 Alerting your caretaker…', 'warning');

  try {
    await emailjs.send(CONFIG.EMAILJS_SERVICE_ID, CONFIG.EMAILJS_SOS_TEMPLATE_ID, templateParams, CONFIG.EMAILJS_PUBLIC_KEY);
    showToast('✅ Your caretaker has been alerted!', 'success');
  } catch (err) {
    console.error('[EmailJS] SOS email failed:', err);
    showToast('Alert sent (check your connection too).', 'warning');
  }
}

// --- CARETAKER DASHBOARD ---
async function loadCaretakerDashboard() {
  updateCaretakerStats();
  renderCaretakerSchedule();
  loadAdherenceLog();
  loadAppointments();
}

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
    const takenLog = logs.find(l => l.medId === med.id && l.taken);
    const missedLog = logs.find(l => l.medId === med.id && !l.taken);
    if (takenLog) {
      taken++;
    } else if (missedLog) {
      missed++;
    } else {
      med.time <= hhmm ? missed++ : upcoming++;
    }
  });

  const total     = taken + missed;
  const adherence = total > 0 ? Math.round((taken / total) * 100) : 100;

  const statTaken     = $('stat-taken');
  const statMissed    = $('stat-missed');
  const statUpcoming  = $('stat-upcoming');
  const statAdherence = $('stat-adherence');

  if (statTaken)     statTaken.textContent     = taken;
  if (statMissed)    statMissed.textContent    = missed;
  if (statUpcoming)  statUpcoming.textContent  = upcoming;
  if (statAdherence) statAdherence.textContent = `${adherence}%`;
}

async function loadTodayAdherence() {
  try {
    const snapshot = await db.collection('adherenceLogs')
      .where('date', '==', todayDateString())
      .get();
    const remoteLogs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const merged = [...remoteLogs];
    (STATE.todayLogs || []).forEach(local => {
      if (!merged.some(m => m.medId === local.medId && m.taken === local.taken)) {
        merged.push(local);
      }
    });
    STATE.todayLogs = merged;
  } catch (err) {
    console.warn('[Firestore] loadTodayAdherence error (offline?):', err);
    STATE.todayLogs = STATE.todayLogs || [];
  }
}

async function loadAdherenceLog() {
  const container = $('adherence-log');
  if (!container) return;
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
      const d           = doc.data();
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

function renderCaretakerSchedule() {
  const container = $('caretaker-schedule');
  if (!container) return;

  if (!STATE.schedule.length) {
    container.innerHTML = '<p class="loading-msg">No medications added yet.</p>';
    return;
  }

  container.innerHTML = STATE.schedule.map(med => `
    <div class="schedule-item" role="listitem">
      <span class="schedule-time">${formatTime(med.time)}</span>
      <div class="schedule-details">
        <div class="schedule-med-name">${formatMedDisplayName(med)}</div>
        <div class="schedule-dose">${escapeHtml(med.dose || '')} ${med.notes ? '· ' + escapeHtml(med.notes) : ''}</div>
      </div>
      <button
        class="delete-med-btn"
        aria-label="Delete ${escapeHtml(med.nickname || med.name)}"
        onclick="deleteMedication('${med.id}')"
      >🗑</button>
    </div>`).join('');
}

async function addMedicationManually(event) {
  event.preventDefault();

  const name  = $('med-name-input')?.value.trim();
  const time  = $('med-time-input')?.value;
  const dose  = $('med-dose-input')?.value.trim();
  const notes = $('med-notes-input')?.value.trim();
  const nickname = $('med-nickname-input')?.value.trim() || '';

  if (!name || !time) {
    showToast('Please fill in the name and time fields.', 'error');
    return;
  }

  try {
    await db.collection('medications').add(createMedicationDoc({ name, nickname, time, dose, notes }, 'manual'));
    showToast(`✅ ${nickname || name} added to schedule!`, 'success');
    event.target.reset();
    await loadSchedule();
    renderCaretakerSchedule();
  } catch (err) {
    console.error('[Firestore] addMedicationManually error:', err);
    showToast('Could not save medication — check connection.', 'error');
  }
}

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

async function loadAppointments() {
  const container = $('appointments-list');
  if (!container) return;
  container.innerHTML = '<p class="loading-msg">Loading…</p>';

  try {
    const snapshot = await db.collection('appointments').orderBy('dateTime', 'asc').get();

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

async function addAppointment(event) {
  event.preventDefault();

  const title    = $('appt-title-input')?.value.trim();
  const dateTime = $('appt-date-input')?.value;

  if (!title) {
    showToast('Please enter an appointment title.', 'error');
    return;
  }

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

// --- CONFETTI & UI EFFECTS ---
function launchConfetti() {
  const canvas = $('confetti-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const colours = ['#1a56db','#0e9f6e','#f59e0b','#ec4899','#8b5cf6','#10b981'];
  const particles = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height - canvas.height,
    r: Math.random() * 8 + 4,
    d: Math.random() * 120,
    colour: colours[Math.floor(Math.random() * colours.length)],
    tilt: Math.floor(Math.random() * 10) - 10,
    tiltAngle: 0,
    tiltAngleDelta: Math.random() * 0.07 + 0.05,
  }));

  let angle = 0;
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
      ctx.lineWidth   = p.r;
      ctx.strokeStyle = p.colour;
      ctx.globalAlpha = Math.max(0, 1 - frameCount / maxFrames);
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

let _toastHandle = null;
function showToast(message, type = 'default') {
  const toast = $('toast');
  if (!toast) return;

  if (_toastHandle) clearTimeout(_toastHandle);

  toast.textContent = message;
  toast.className   = `toast${type !== 'default' ? ` ${type}` : ''}`;

  _toastHandle = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3500);
}

// --- UTILITIES ---
function formatTime(hhmm) {
  if (!hhmm || !hhmm.includes(':')) return hhmm || '—';
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- GLOBAL EXPORTS ---
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
window.determineCurrentMedication = determineCurrentMedication;
window.updateNextMedication = determineCurrentMedication;
window.updatePatientDashboard = determineCurrentMedication;
window.formatTime = formatTime;
window.escapeHtml = escapeHtml;
window.todayDateString = todayDateString;
window.timeToMinutes = timeToMinutes;
window.getOneHourPriorFormatted = getOneHourPriorFormatted;
window.isMedTakenToday = isMedTakenToday;
window.STATE = STATE;
