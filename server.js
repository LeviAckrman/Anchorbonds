// server.js
// Minimal Express backend for Razorpay Standard Checkout:
//   POST /api/create-order    -> creates a Razorpay order
//   GET  /api/key             -> hands the (public) Key ID to the frontend
//   POST /api/verify-payment  -> verifies the payment signature after checkout
//
// Run with: npm install && npm start
// Requires a .env file next to this one (see .env.example / .env).

require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const app = express();
app.use(express.json());

// Serves the static site from ./public (index.html, assets, etc.)
app.use(express.static("public"));

const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, PORT = 3000 } = process.env;

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.error(
    "Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET. Check your .env file."
  );
  process.exit(1);
}

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

// The workshop has one fixed price. Deciding the amount on the server
// (rather than trusting whatever the client sends) means someone can't
// tamper with the request in the browser and pay less than ₹99.
const WORKSHOP_AMOUNT_PAISE = 9900; // ₹99
const MIN_AMOUNT_PAISE = 100; // Razorpay's own minimum (₹1)

/**
 * STEP 1 — Create an order.
 * Frontend calls this before opening the Razorpay checkout modal.
 */
app.post("/api/create-order", async (req, res) => {
  try {
    const amount = WORKSHOP_AMOUNT_PAISE; // fixed server-side, see note above
    const currency = "INR";
    const receipt = `workshop_${Date.now()}`;

    if (!amount || amount < MIN_AMOUNT_PAISE) {
      return res
        .status(400)
        .json({ error: "Amount must be at least 100 paise (₹1)." });
    }

    const order = await razorpay.orders.create({
      amount,
      currency,
      receipt,
      notes: {
        product: "How to Stop Getting Friend-Zoned — workshop",
        name: (req.body && req.body.name) || "",
        phone: (req.body && req.body.phone) || "",
      },
    });

    return res.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
    });
  } catch (err) {
    console.error("Razorpay create-order error:", err);

    // Razorpay auth errors surface as 401 from their API.
    if (err.statusCode === 401) {
      return res
        .status(401)
        .json({ error: "Razorpay authentication failed. Check your API keys." });
    }

    return res.status(500).json({ error: "Could not create order. Please try again." });
  }
});

/**
 * Hands the (public) Key ID to the frontend so it never has to be
 * hardcoded into the HTML/JS that ships to the browser. This is safe —
 * the Key ID is designed to be public. The Key Secret is never sent here.
 */
app.get("/api/key", (req, res) => {
  res.json({ key_id: RAZORPAY_KEY_ID });
});

/**
 * STEP 3 — Verify the payment signature.
 * Frontend calls this after Razorpay's checkout modal succeeds, with the
 * three values Razorpay returned. Only mark the booking as paid if the
 * signature checks out.
 */
app.post("/api/verify-payment", (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, error: "Missing required fields." });
  }

  const expectedSignature = crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  const isValid = expectedSignature === razorpay_signature;

  if (!isValid) {
    console.warn("Signature mismatch for order:", razorpay_order_id);
    return res.status(400).json({ success: false, error: "Signature verification failed." });
  }

  // Signature is valid — the payment is genuine.
  // TODO: this is the place to mark the registration as paid in a
  // database, send a confirmation email/SMS, etc. This project has no
  // database yet, so we just confirm success back to the frontend.
  return res.json({ success: true, payment_id: razorpay_payment_id });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
