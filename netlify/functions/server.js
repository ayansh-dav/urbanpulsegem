require('dotenv').config();
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

const DISTRICT_EMAILS = {
  Korba: 'corporationkorba@gmail.com',
  Raipur: 'dc_rmc@rediffmail.com',
  Bilaspur: 'commissionerbmcbilaspur@gmail.com',
  Durg: 'nigam_bhilai@yahoo.co.in',
  Raigarh: 'ulb.raigarh@gmail.com',
  Surguja: 'ambikapur.mc@gmail.com',
  Dhamtari: 'dhamtarimunicipal@gmail.com',
  Mahasamund: 'cmo.mahasamund@gmail.com'
};

const mail = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: SENDER, pass: APP_PASS }
});

const router = express.Router();

router.get('/bootstrap', (req, res) => {
  res.json({ visits: 1, directory: [], reports: [], users: [] });
});

router.post('/report', async (req, res) => {
  try {
    const b = req.body || {};
    const id = b.id || ('UP-' + Date.now().toString(36).toUpperCase());
    const district = b.district || 'Korba';
    const bodyName = b.body || `Municipal Corporation ${district}`;

    // Use the exact email from the selected location (or Admin-edited district email)
    const rawEmails = b.toEmail || DISTRICT_EMAILS[district] || 'uaddatacenter@gmail.com';
    const parsedEmails = String(rawEmails)
      .split(/[,;\s]+/)
      .map(e => e.trim())
      .filter(Boolean);

    // Include SENDER as a copy so you can verify delivery in your inbox
    const targetEmails = [...new Set([...parsedEmails, SENDER])];

    const r = {
      id,
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

    let emailStatus = 'sent';
    if (!DRY_RUN) {
      await mail.sendMail({
        from: `UrbanPulse Chhattisgarh <${SENDER}>`,
        to: targetEmails.join(','),
        subject: `[${r.tier === 'emergency' ? '🚨 EMERGENCY' : 'Civic Report'}] ${r.categoryLabel} - ${r.body} (${r.id})`,
        html: `
          <h2>New Civic Hazard Report (${r.id})</h2>
          <p><b>Target Authority:</b> ${r.body} (${r.district})</p>
          <p><b>Location:</b> Ward ${r.ward}, ${r.district} (GPS: ${r.lat}, ${r.lng})</p>
          <p><b>Category:</b> ${r.categoryLabel} [${r.tier.toUpperCase()}]</p>
          <p><b>Reported By:</b> ${r.name}</p>
          <p><b>Details & Landmark:</b> ${r.notes || 'No extra notes provided.'}</p>
        `,
        attachments: r.photo ? [{ filename: 'hazard.jpg', path: r.photo, cid: 'hazard' }] : []
      });
    } else {
      emailStatus = 'dry-run';
    }

    res.json({ ok: true, report: r, dispatch: { email: { to: targetEmails, status: emailStatus } } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use('/api', router);
module.exports.handler = serverless(app);
