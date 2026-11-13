require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const serverless = require('serverless-http');

const app = express();
app.use(cors());
app.use(express.json({ limit: '12mb' }));

const SENDER = process.env.SENDER_EMAIL || 'alexisanshu12r@gmail.com';
const APP_PASS = (process.env.GMAIL_APP_PASSWORD || 'emus bijt gjng llrz').replace(/\s+/g, '');
const DRY_RUN = process.env.DRY_RUN === 'true';

const DB_FILE = path.join('/tmp', 'urbanport_cloud_state.json');

const DEFAULT_DISTRICTS = [
  { dist: 'Korba', body: 'Municipal Corporation Korba', email: 'corporationkorba@gmail.com', phone: '07759-221333', lat: 22.3600, lng: 82.7500 },
  { dist: 'Raipur', body: 'Raipur Municipal Corporation', email: 'dc_rmc@rediffmail.com', phone: '0771-2535780', lat: 21.2514, lng: 81.6296 },
  { dist: 'Bilaspur', body: 'Nagar Nigam Bilaspur', email: 'commissionerbmcbilaspur@gmail.com', phone: '07752-222642', lat: 22.0797, lng: 82.1409 },
  { dist: 'Durg', body: 'Nagar Nigam Bhilai', email: 'nigam_bhilai@yahoo.co.in', phone: '+917882295055', lat: 21.2090, lng: 81.3790 },
  { dist: 'Raigarh', body: 'Raigarh Municipal Corporation', email: 'ulb.raigarh@gmail.com', phone: '07762-222404', lat: 21.8974, lng: 83.3950 },
  { dist: 'Surguja', body: 'Municipal Corporation Ambikapur', email: 'ambikapur.mc@gmail.com', phone: '07774-236396', lat: 23.1200, lng: 83.2000 },
  { dist: 'Dhamtari', body: 'Dhamtari Municipal Corporation', email: 'dhamtarimunicipal@gmail.com', phone: '07722-237555', lat: 20.7072, lng: 81.5497 },
  { dist: 'Mahasamund', body: 'Municipality Mahasamund', email: 'cmo.mahasamund@gmail.com', phone: '07723-222230', lat: 21.1070, lng: 82.0979 }
];

let memoryState = {
  districts: JSON.parse(JSON.stringify(DEFAULT_DISTRICTS)),
  users: [
    {
      uid: 'U-ADMIN',
      name: 'ayansh',
      pass: '231238',
      district: 'Korba',
      contact: 'alexisanshu12r@gmail.com',
      bonus: 100
    }
  ],
  reports: [
    {
      id: 'UPT-DEMO1',
      uid: 'U-ADMIN',
      name: 'ayansh',
      district: 'Korba',
      body: 'Municipal Corporation Korba',
      ward: 14,
      categoryLabel: 'Pothole / Damaged Road',
      notes: 'Deep crater near ITI Chowk main arterial road causing traffic slowdown.',
      lat: 22.3612,
      lng: 82.7515,
      status: 'open',
      tier: 'standard',
      at: Date.now() - 3600000
    }
  ],
  banner: '',
  updatedAt: Date.now()
};

function loadState() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.districts) && parsed.districts.length) {
        memoryState = parsed;
      }
    }
  } catch (e) {
    // Fallback to in-memory state
  }
  return memoryState;
}

function saveState(nextState) {
  memoryState = {
    districts: Array.isArray(nextState.districts) && nextState.districts.length ? nextState.districts : memoryState.districts,
    users: Array.isArray(nextState.users) && nextState.users.length ? nextState.users : memoryState.users,
    reports: Array.isArray(nextState.reports) ? nextState.reports : memoryState.reports,
    banner: typeof nextState.banner === 'string' ? nextState.banner : memoryState.banner,
    updatedAt: Date.now()
  };
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(memoryState), 'utf8');
  } catch (e) {
    // Ignore write error if read-only fs
  }
  return memoryState;
}

const mail = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: SENDER, pass: APP_PASS }
});

const router = express.Router();

// Cross-device state fetch
router.get('/bootstrap', (req, res) => {
  const st = loadState();
  res.json({ ok: true, state: st });
});

// Cross-device state sync (Admin district edits, user updates, report status, banner)
router.post('/sync', (req, res) => {
  const current = loadState();
  const b = req.body || {};
  const updated = saveState({
    districts: b.districts !== undefined ? b.districts : current.districts,
    users: b.users !== undefined ? b.users : current.users,
    reports: b.reports !== undefined ? b.reports : current.reports,
    banner: b.banner !== undefined ? b.banner : current.banner
  });
  res.json({ ok: true, state: updated });
});

// Submit civic report & dispatch email
router.post('/report', async (req, res) => {
  try {
    const st = loadState();
    const b = req.body || {};
    const id = b.id || ('UPT-' + Date.now().toString(36).toUpperCase());
    const district = b.district || 'Korba';

    const matchedDist = st.districts.find(d => d.dist.toLowerCase() === district.toLowerCase());
    const bodyName = b.body || (matchedDist ? matchedDist.body : `Municipal Corporation ${district}`);
    const rawEmails = b.toEmail || (matchedDist ? matchedDist.email : 'corporationkorba@gmail.com');

    const parsedEmails = String(rawEmails)
      .split(/[,;\s]+/)
      .map(e => e.trim())
      .filter(Boolean);

    const targetEmails = [...new Set([...parsedEmails, SENDER])];

    const r = {
      id,
      uid: b.uid || 'U-CITIZEN',
      name: b.name || 'Citizen',
      district,
      body: bodyName,
      ward: +b.ward || 1,
      categoryLabel: b.categoryLabel || 'Civic Hazard',
      notes: String(b.notes || ''),
      lat: +b.lat || 22.36,
      lng: +b.lng || 82.75,
      photo: b.photo || null,
      status: 'open',
      tier: b.tier || 'standard',
      to: targetEmails,
      at: Date.now()
    };

    st.reports.unshift(r);
    saveState(st);

    let emailStatus = 'sent';
    if (!DRY_RUN) {
      await mail.sendMail({
        from: `UrbanPort Civic Command <${SENDER}>`,
        to: targetEmails.join(','),
        subject: `[${r.tier === 'emergency' ? '🚨 URGENT EMERGENCY' : 'UrbanPort Dispatch'}] ${r.categoryLabel} — ${r.body} (${r.id})`,
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:580px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">
            <div style="background:#0f172a;color:#ffffff;padding:18px 22px">
              <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#38bdf8;font-weight:700">UrbanPort Chhattisgarh · Automated Municipal Telemetry</div>
              <h2 style="margin:6px 0 0;font-size:20px">${r.categoryLabel} (${r.id})</h2>
            </div>
            <div style="padding:20px 22px;background:#ffffff;color:#1e293b;line-height:1.6">
              <p style="margin:0 0 10px"><b>Target Authority:</b> ${r.body} (${r.district})</p>
              <p style="margin:0 0 10px"><b>Ward & Sector:</b> Ward ${r.ward}, ${r.district}</p>
              <p style="margin:0 0 10px"><b>GPS Telemetry:</b> ${r.lat}, ${r.lng} (<a href="https://www.google.com/maps?q=${r.lat},${r.lng}">Open in Google Maps</a>)</p>
              <p style="margin:0 0 10px"><b>Priority Tier:</b> <span style="font-weight:700;color:${r.tier === 'emergency' ? '#dc2626' : '#0284c7'}">${r.tier.toUpperCase()}</span></p>
              <p style="margin:0 0 10px"><b>Reported By:</b> ${r.name}</p>
              <div style="background:#f8fafc;border-left:4px solid #0284c7;padding:12px 14px;margin-top:14px;border-radius:4px">
                <b>Field Notes & Landmark:</b><br>${r.notes || 'No extra notes provided.'}
              </div>
            </div>
          </div>
        `,
        attachments: r.photo ? [{ filename: 'urbanport-evidence.jpg', path: r.photo, cid: 'hazard' }] : []
      });
    } else {
      emailStatus = 'dry-run';
    }

    res.json({ ok: true, report: r, state: st, dispatch: { email: { to: targetEmails, status: emailStatus } } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use('/api', router);
module.exports.handler = serverless(app);
