# 💊 CareConnect
**An empathetic, AI-powered medication adherence platform designed to prevent elderly polypharmacy errors.**

Built for the **CATALYST - Solo AI Hackathon** (MnM x PromptWars).

[![Live Demo](https://img.shields.io/badge/Live-Demo-brightgreen.svg)](#) https://careconnect-zeta-eight.vercel.app/
[![AI Evaluation Score](https://img.shields.io/badge/AI_Evaluation-91.76%2F100-blue)]

## 🔍 The Problem: Elderly Polypharmacy
Elderly patients frequently manage multiple chronic conditions requiring complex, overlapping medication schedules. Traditional apps fail because they use dense medical jargon (e.g., "Lisinopril 10mg") and lack strict safety rails, leading to missed doses or dangerous double-dosing. 

## 💡 The CareConnect Solution
CareConnect bridges the gap between clinical accuracy and elder-friendly accessibility. 
1. **AI Prescription Translation:** Using **Gemini 3.5 Flash-Lite**, complex clinical prescriptions are instantly parsed and translated into friendly UI nicknames (e.g., "Heart Pill", "Sugar Pill"). 
2. **Strict Time-Window Logic:** To prevent accidental double-dosing, medications only appear on the patient dashboard within a strict +/- 60-minute rolling grace period. 
3. **Role-Based State Syncing:** Actions taken on the ultra-simplified Patient Dashboard instantly sync to a detailed Caretaker Dashboard via Firebase.

## 🏗️ Architecture & Tech Stack
I bypassed the standard hackathon trap of bloated frameworks and client-side API leaks by focusing on a secure, first-principles architecture:

* **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3. Zero-bloat, highly accessible DOM manipulation.
* **Backend:** Serverless API Proxy deployed on **Vercel** (Node.js). Securely handles AI payloads without exposing the Gemini API key to the client.
* **Database:** **Firebase Firestore** (NoSQL). Handles real-time cross-device state syncing.
* **AI Engine:** **Google Gemini 3.5 Flash-Lite** (via REST API).
* **Mock Clinical Data:** Generated via **Adaptation AI Labs**.

## 🚀 Key Features
* **Smart Parsing:** Upload a prescription image, and the backend extracts the clinical name, formulates an empathetic nickname, schedules the time, and notes food requirements (e.g., "Take with meals").
* **Collision Detection:** The client handles AI hallucinations. If the AI generates duplicate nicknames for two different pills, the UI automatically appends the time to ensure physical distinction.
* **Non-Destructive Scheduling:** Caretakers can choose to add new prescriptions to an existing schedule or completely replace acute regimens.

## ⚙️ Local Development
1. Clone the repository.
2. Ensure you have a `.env` file in the root with your `GEMINI_API_KEY`.
3. Start a local server (e.g., VS Code Live Server for the frontend, Vercel CLI for the backend).
   ```bash
   npm install -g vercel
   vercel dev