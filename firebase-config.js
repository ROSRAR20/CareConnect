/**
 * ============================================================
 * firebase-config.js
 * ============================================================
 * Initialises the Firebase app and exports `db` (Firestore).
 *
 * HOW TO USE:
 *   1. Create a Firebase project at https://console.firebase.google.com
 *   2. Add a "Web app" to get your firebaseConfig object.
 *   3. Enable Firestore (Start in TEST MODE for hackathon dev).
 *   4. Replace every placeholder value below with your real
 *      project credentials.
 *
 * SECURITY NOTE:
 *   These keys are intentionally client-side — Firebase enforces
 *   access via Firestore Security Rules, not secret API keys.
 *   For production, tighten the rules to authenticated users only.
 *
 * FIRESTORE COLLECTIONS USED BY THIS APP:
 *   medications/     — scheduled medication slots
 *   adherenceLogs/   — patient YES/NO confirmation records
 *   wellnessLogs/    — daily wellness goal completions
 *   appointments/    — upcoming doctor appointments
 * ============================================================
 */

// ── Your Firebase project configuration ────────────────────
// Replace each value with the ones from your Firebase console
// (Project Settings → Your apps → SDK setup and configuration).
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// ── Initialise Firebase (compat SDK — no bundler required) ─
firebase.initializeApp(firebaseConfig);

/**
 * Firestore database instance.
 *
 * Exported as a global so app.js can import it without ES-module
 * syntax (keeping the project bundler-free for hackathon simplicity).
 *
 * Usage in app.js:
 *   const ref = db.collection('medications').doc('morning');
 */
const db = firebase.firestore();

// ── Optional: Enable offline persistence for resilience ─────
// Uncomment the block below if you want the app to work when
// the user briefly loses their internet connection.
//
// db.enablePersistence({ synchronizeTabs: true })
//   .then(() => console.log('[Firebase] Offline persistence enabled.'))
//   .catch(err => {
//     if (err.code === 'failed-precondition') {
//       console.warn('[Firebase] Persistence unavailable — multiple tabs open.');
//     } else if (err.code === 'unimplemented') {
//       console.warn('[Firebase] Persistence not supported by this browser.');
//     }
//   });

console.log('[Firebase] Firestore initialised for project:', firebaseConfig.projectId);
