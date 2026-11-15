export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { imageBase64, mimeType } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ error: 'Missing image data' });
  }

  // Securely pull the key from Vercel's hidden environment variables
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server missing API key configuration' });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;


  const prompt = req.body.prompt || `You are a clinical pharmacist AI assistant. Carefully examine this prescription image — it may contain handwritten or printed text, possibly messy or partially legible.
Extract EVERY medication listed and return ONLY a valid JSON array. Do NOT include any markdown, code fences, or explanatory text.
Each array element must have exactly these fields:
{
  "name": "Medication name and strength (string)",
  "nickname": "Generate a short, elder-friendly common name based on the medical purpose. CRITICAL: If multiple medications treat the exact same condition, make their nicknames distinctly unique so the patient doesn't confuse them (e.g., 'Primary BP Pill' and 'Secondary BP Pill', or append the dosage like 'BP Pill - 10mg').",
  "time": "Scheduled time in 24-hour HH:MM format (string)",
  "dose": "Dosage instruction (string)",
  "notes": "Any additional notes (string, empty string if none)"
}
If a time is ambiguous, create multiple entries. If unreadable, use best clinical judgment. If none extracted, return [].`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: imageBase64 } }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API Error: ${errText}`);
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Serverless Function Error:', error);
    return res.status(500).json({ error: error.message });
  }
}