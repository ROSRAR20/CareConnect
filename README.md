# 💊 CareConnect
**An empathetic, AI-powered medication adherence platform designed to prevent elderly polypharmacy errors.**

Built for the **CATALYST - Solo AI Hackathon** (MnM x PromptWars).

[![Live Demo](https://img.shields.io/badge/Live-Demo-brightgreen.svg)](https://careconnect-zeta-eight.vercel.app/)
[![AI Evaluation Score](https://img.shields.io/badge/AI_Evaluation-91.76%2F100-blue)](#)

## 🔍 The Problem: Elderly Polypharmacy
Elderly patients frequently manage multiple chronic conditions requiring complex, overlapping medication schedules. Traditional apps fail because they use dense medical jargon (e.g., "Lisinopril 10mg") and lack strict safety rails, leading to missed doses or dangerous double-dosing. 

## 💡 The CareConnect Solution
CareConnect bridges the gap between clinical accuracy and elder-friendly accessibility:
1. **AI Prescription Translation:** Using **Google Gemini 3.5 Flash-Lite**, complex clinical prescriptions are instantly parsed and translated into friendly UI nicknames (e.g., "Heart Pill", "Sugar Pill"). 
2. **Strict Time-Window Logic:** To prevent accidental double-dosing, medications only appear active on the patient dashboard within a strict +/- 60-minute rolling grace period. 
3. **Role-Based State Syncing:** Actions taken on the ultra-simplified Patient Dashboard instantly sync to a detailed Caretaker Dashboard via Firebase Firestore.

## 🏗️ Architecture & Tech Stack
CareConnect is built on a secure, first-principles architecture:

* **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3. Zero-bloat, highly accessible DOM manipulation and a bespoke "Warm Physical Care Journal" tactile design system.
* **Backend:** Serverless API Proxy deployed on **Vercel** (`api/parse.js`). Securely handles AI payloads without exposing the Gemini API key to the client.
* **Database:** **Firebase Firestore** (NoSQL compat v10) for real-time cross-device state syncing and adherence logs.
* **AI Engine:** **Google Gemini 3.5 Flash-Lite** (via REST API).
* **Alerts & Messaging:** **EmailJS** for instant caregiver notification webhooks on missed doses and SOS emergencies.
* **Mock Clinical Data:** Generated via **Adaptation AI Labs**.

## 🚀 Key Features
* **Smart AI Parsing:** Upload a prescription image, and the backend extracts the clinical name, formulates an elder-friendly nickname, schedules the dosage time, and captures meal notes (e.g., "Take with meals").
* **Collision Detection:** The client handles AI hallucinations. If the AI generates duplicate nicknames for two different pills, the UI automatically ensures physical distinction.
* **Non-Destructive Scheduling:** Caretakers can choose to add newly parsed medications to an existing schedule ("➕ Add to Schedule") or completely replace acute regimens ("⚠️ Replace Entire Schedule").
* **Instant Caretaker Webhook Alerts (EmailJS):** Triggers an immediate notification email to the caregiver when the patient marks a medication as "Not yet" or clicks the emergency SOS button.
* **45-Minute Empathy Loop:** Automated watchdog that tracks unconfirmed, past-due doses and automatically escalates alerts to caregivers if a dose is skipped.
* **Dual Camera & Gallery Upload:** Native mobile-friendly controls offering explicit "📷 Take Photo" (direct environment camera capture) and "📁 Upload from Gallery" options, with responsive desktop queries that optimize to gallery upload.
* **PIN-Protected Caretaker Portal:** 4-digit security PIN modal guarding the caretaker view with tactile numpad input and session-scoped authentication.
* **Daily Wellness Tracking:** Patient-facing hydration, light walking, and gentle stretching goals with real-time completion tracking and celebratory confetti animations.
* **Elder-Accessible "Physical Care Journal" UI:** Accessible, high-contrast palette with soft cream paper surfaces (`#FDFBF7`), physical offset drop shadows, generous typography hierarchy, and responsive push-button interactions.

## 📁 Project Structure
```text
├── api/
│   └── parse.js             # Vercel serverless function for Gemini API proxy
├── tests/
│   └── app.test.js          # Unit tests for time calculations and helpers
├── app.js                   # Application state, Time Window math, Firestore sync, EmailJS
├── index.html               # Dual-interface application shell (Patient & Caretaker)
├── styles.css               # Tactile "Physical Care Journal" design system
├── firebase-config.js       # Firebase Firestore configuration
└── README.md                # Project documentation
```

## ⚙️ Local Development
1. Clone the repository:
   ```bash
   git clone https://github.com/Alden-6/CareConnect.git
   cd CareConnect
   ```
2. Ensure you have a `.env` file in the root containing your Gemini API key:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```
3. Start the local server using Vercel CLI (or VS Code Live Server for client testing):
   ```bash
   npm install -g vercel
   vercel dev
   ```

   ```
   ## 🔮 Future Scope
While the current MVP successfully tackles immediate adherence and role-based syncing, the roadmap for CareConnect includes:
* **Medical API Integration:** Checking for dangerous drug-drug interactions (e.g., if a new uploaded prescription negatively interacts with an existing one).
* **Wearable Integration:** Pushing time-window alerts directly to smartwatches (Apple Watch/WearOS) for haptic feedback, as elderly patients may not always have their phones in hand.
* **Multilingual Voice Prompts:** Allowing the Gemini AI to generate audio reminders in regional languages for patients with visual impairments or lower literacy levels.
* **Direct E-Rx Fetching:** Integrating with hospital databases to pull prescriptions directly, bypassing the need for physical photo uploads.