// netlify/functions/login.js
// PP Hub login — reads the Login tab of the Hub sheet via the Google Sheets API
// and returns the trainee's name + week-access number.
//
// Mirrors the proven V1 Coach function pattern (same CORS headers, same Sheets API
// read via SHEETS_API_KEY). Built for THIS sheet's columns:
//   A Email | B First Name | C Last Name | D Active | E WeekAccess
//   E values: "Week 0", "Week 0+", "Week 1", "Week 2", "Week 3", "Week 4", "Week 5"
//
// Requires Netlify environment variable: SHEETS_API_KEY

const SHEET_ID = '1exPnnxupK6yJuOatesqGpbiZq7QCIMilWxF7EpbBOZw';
const CACHE_TTL_MS = 60 * 1000; // cache the Login tab for 60s to absorb login spikes

let cachedRows = null;
let cacheTimestamp = 0;

async function fetchLoginTab(apiKey) {
  const now = Date.now();
  if (cachedRows && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedRows;
  }
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent('Login!A:E')}?key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to fetch Login tab: ${res.status} ${txt}`);
  }
  const data = await res.json();
  cachedRows = data.values || [];
  cacheTimestamp = now;
  return cachedRows;
}

// Map the dropdown values in the Login sheet's WeekAccess column to numeric state codes.
//   "Week 0"   -> 0     (PFFU)
//   "Week 0+"  -> 0.5   (post-PFFU practice game)
//   "Week 1"   -> 1     (Game 1)
//   "Week 2"   -> 2     (Game 2)
//   "Week 3"   -> 3     (Game 3)
//   "Week 4"   -> 4     (Game 4 / final test)
//   "Week 5"   -> 5     (Passed — Result page unlocked, full $150 earned)
// Anything unrecognised falls back to 0 so the trainee lands on the PFFU page.
function parseWeek(raw) {
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  switch (v) {
    case 'week 0':  return 0;
    case 'week 0+': return 0.5;
    case 'week 1':  return 1;
    case 'week 2':  return 2;
    case 'week 3':  return 3;
    case 'week 4':  return 4;
    case 'week 5':  return 5;
    default:        return 0;
  }
}

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, message: 'Method not allowed' }) };
  }

  try {
    const apiKey = process.env.SHEETS_API_KEY;
    if (!apiKey) throw new Error('Missing SHEETS_API_KEY');

    const body = JSON.parse(event.body || '{}');
    const email = (body.email || '').toLowerCase().trim();

    if (!email || email.indexOf('@') === -1) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: false, message: 'Please enter a valid email address.' }) };
    }

    const rows = await fetchLoginTab(apiKey);

    // rows[0] is the header; data starts at row index 1.
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const rowEmail = (r[0] || '').toLowerCase().trim();   // A = Email
      if (rowEmail === email) {
        const active = (r[3] || '').toString().trim().toLowerCase() === 'active'; // D = Active
        if (!active) {
          return { statusCode: 200, headers, body: JSON.stringify({ ok: false, message: "Your access isn't currently active. Please contact Simon Chester at pffacademy@teamworks.com." }) };
        }
        const name = [String(r[1] || '').trim(), String(r[2] || '').trim()].filter(Boolean).join(' ') || 'Trainee'; // B + C
        const week = parseWeek(r[4]); // E = WeekAccess
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, name, week }) };
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, message: "We couldn't find that email. Use the email you applied with, or contact Simon Chester at pffacademy@teamworks.com." }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, message: 'Server error. Please try again shortly.' }) };
  }
};
