/**
 * ============================================================
 * firebase-config.js
 * ============================================================
 * Initialises Firebase Firestore in Compat mode for friction-less
 * reads and writes across the application without build tooling.
 * ============================================================
 */

// ── Your Firebase project configuration ────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyCJTEurnRvuwiGtgtVM2NC7lmi81EvDsqU",
  authDomain: "eldercare-94cda.firebaseapp.com",
  projectId: "eldercare-94cda",
  storageBucket: "eldercare-94cda.firebasestorage.app",
  messagingSenderId: "271860189897",
  appId: "1:271860189897:web:4b2bdf3d3f7f52b02b5b18",
  measurementId: "G-14ZTXZK6N9"
};

// ── Initialise Firebase (using compat SDK loaded via CDN) ───
if (typeof firebase !== 'undefined') {
  if (!firebase.apps || !firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
}

/**
 * Global Firestore database instance.
 * Accessible globally as `db` and `window.db` across all scripts.
 */
var db = (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore() : null;
window.db = db;

console.log('[Firebase] Firestore initialized for project:', firebaseConfig.projectId);
