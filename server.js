// server.js - demo backend (Node.js + Express)
// NOTE: replace placeholders with real keys before going live

const express = require('express');
const fetch = require('node-fetch'); // if Node < 18 install node-fetch
const bodyParser = require('body-parser');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());
app.use(express.static('../public')); // serve frontend

const PORT = process.env.PORT || 3000;
const FLW_SECRET = process.env.FLW_SECRET || 'FLW_SECRET_KEY_HERE'; // put real key in .env
const PLAY_AMOUNT = 5000; // UGX

// Simple in-memory store for demo purposes:
const sessions = {}; // tx_ref -> { status, winner, createdAt, flutterResp }

function generate10Digit() {
  // crypto.randomInt with upper bound 10_000_000_000 (exclusive)
  // returns 0..9999999999
  const n = crypto.randomInt(0, 10000000000);
  return String(n).padStart(10,'0');
}

// Create payment using Flutterwave (mobile_money_uganda)
// Note: exact endpoint/payload may change; adapt to provider docs when you paste keys
app.post('/api/create-payment', async (req, res) => {
  try {
    const amount = Number(req.body.amount) || PLAY_AMOUNT;
    if (amount !== PLAY_AMOUNT) {
      return res.status(400).json({ message: 'Invalid amount. Server enforces UGX ' + PLAY_AMOUNT });
    }

    // tx_ref for tracking
    const tx_ref = 'ankwata_' + Date.now() + '_' + Math.floor(Math.random()*1000);

    // Example payload for Flutterwave - adapt to current Flutterwave API when you enable live keys
    const payload = {
      tx_ref,
      amount: String(amount),
      currency: "UGX",
      // For mobile money Uganda: endpoint usually expects payment type and phone number.
      // Here we request the gateway to initialize a collection. In practice you'll collect payer phone or redirect.
      payment_options: "mobilemoneyuganda",
      customer: {
        email: "anonymous@ankwata.local",
        phonenumber: "2567XXXXXXXX", // optional; gateway may require real number
        name: "ANKWATA Player"
      },
      meta: {
        platform: "ankwata_web"
      }
    };

    // CALL FLUTTERWAVE - demo: show placeholder response if no key
    if (!FLW_SECRET || FLW_SECRET === 'FLW_SECRET_KEY_HERE') {
      // pretend we created a payment; client will poll /api/check-payment
      sessions[tx_ref] = { status: 'pending', createdAt: Date.now(), flutterResp: null };
      return res.json({ tx_ref, message: 'demo: payment initiated (no FLW key configured)' });
    }

    // production: call Flutterwave (example endpoint - confirm exact endpoint with Flutterwave docs)
    const resp = await fetch('https://api.flutterwave.com/v3/charges?type=mobile_money_uganda', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FLW_SECRET}`
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();
    if (!resp.ok) {
      console.error('Flutterwave error', data);
      return res.status(400).json({ message: 'payment init error', data });
    }

    // Save session
    sessions[tx_ref] = { status: 'pending', createdAt: Date.now(), flutterResp: data };

    // return tx_ref and any instruction for the frontend
    return res.json({
      tx_ref,
      message: 'payment initiated',
      payment_instructions: data.meta || null,
      flutter: data
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'server error' });
  }
});

// Poll/check endpoint (demo)
app.get('/api/check-payment', (req, res) => {
  const tx = req.query.tx_ref;
  if (!tx || !sessions[tx]) return res.status(404).json({ ok:false, message:'not found' });
  return res.json({ ok:true, status: sessions[tx].status });
});

// Webhook endpoint: your payment provider should call this when payment completes.
// For demo we allow manual call to simulate success.
app.post('/api/webhook', (req, res) => {
  // IMPORTANT: verify signature header per provider docs in production!
  // Flutterwave sends a signature (check their docs) - verify here.

  const payload = req.body;
  // Example payload shape depends on provider. We'll expect { tx_ref, status } inside payload.data
  const tx_ref = payload.data && payload.data.tx_ref;
  const status = payload.data && payload.data.status;

  if (!tx_ref) {
    // allow manual webhook simulation: accept { tx_ref: '...', status: 'successful' } at top-level
    if (payload.tx_ref) {
      const t = payload.tx_ref;
      const s = payload.status || 'successful';
      sessions[t] = sessions[t] || {};
      sessions[t].status = s;
      if (s === 'successful' && !sessions[t].winner) {
        sessions[t].winner = generate10Digit();
      }
      return res.json({ received: true });
    }
    return res.status(400).json({ received: false, message: 'no tx_ref' });
  }

  sessions[tx_ref] = sessions[tx_ref] || {};
  sessions[tx_ref].status = status === 'successful' ? 'successful' : 'failed';
  if (status === 'successful' && !sessions[tx_ref].winner) {
    sessions[tx_ref].winner = generate10Digit();
  }
  res.json({ received: true });
});

// For demonstration only: admin endpoint to force success (simulate payment)
app.post('/api/admin/simulate-success', (req, res) => {
  const tx = req.body.tx_ref;
  if (!tx || !sessions[tx]) return res.status(404).json({ message:'session not found' });
  sessions[tx].status = 'successful';
  sessions[tx].winner = generate10Digit();
  res.json({ ok: true, tx_ref: tx, winner: sessions[tx].winner });
});

// Get winner after payment confirmed
app.get('/api/get-winner', (req, res) => {
  const tx = req.query.tx_ref;
  if (!tx || !sessions[tx]) return res.status(404).json({ ok:false, message:'not found' });
  if (sessions[tx].status !== 'successful') return res.status(403).json({ ok:false, message:'payment not confirmed' });
  return res.json({ ok:true, winner: sessions[tx].winner });
});

app.listen(PORT, ()=> console.log('ANKWATA server running on', PORT));
