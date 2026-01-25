require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const CAL_API_KEY = process.env.CAL_API_KEY;
const CAL_ORG_ID = process.env.CAL_ORG_ID;
const OTPIQ_API_KEY = process.env.OTPIQ_API_KEY;
const OTPIQ_SENDER_ID = process.env.OTPIQ_SENDER_ID;
const PORT = process.env.PORT || 3000;

// Helper to send WhatsApp via OTPIQ
async function sendWhatsApp(phoneNumber, templateName, templateParams = {}) {
  try {
    console.log(`[INFO] Sending WhatsApp to ${phoneNumber} using template ${templateName}`);
    const res = await axios.post('https://api.otpiq.com/api/sms', {
      phoneNumber,
      smsType: 'whatsapp-template',
      provider: 'whatsapp',
      templateName,
      whatsappAccountId: OTPIQ_SENDER_ID,
      whatsappPhoneId: OTPIQ_SENDER_ID,
      templateParameters: { body: templateParams }
    }, {
      headers: {
        'Authorization': `Bearer ${OTPIQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    console.log(`[SUCCESS] WhatsApp sent to ${phoneNumber}:`, res.data);
  } catch (err) {
    console.error(`[ERROR] WhatsApp send failed for ${phoneNumber}:`, err.response?.data || err.message);
  }
}

// Webhook route for Cal
app.post('/cal-webhook', async (req, res) => {
  console.log('[INFO] Webhook received:', JSON.stringify(req.body, null, 2));

  const event = req.body.triggerEvent;
  if (event === 'BOOKING_CREATED') {
    try {
      const booking = req.body.payload;
      const attendee = booking.attendees?.[0];
      if (!attendee?.phoneNumber) {
        console.warn(`[WARN] Booking ${booking.id} has no phone number. Skipping WhatsApp.`);
        return res.status(200).send('No phone number to send.');
      }

      // Send booking confirmation immediately
      await sendWhatsApp(attendee.phoneNumber, 'democall_booking_ar', {
        name: attendee.name || 'Guest'
      });

      res.status(200).send('Booking processed.');
    } catch (err) {
      console.error('[ERROR] Failed to process booking webhook:', err.message);
      res.status(500).send('Internal error.');
    }
  } else {
    console.log(`[INFO] Ignoring event type: ${event}`);
    res.status(200).send('Event ignored.');
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`[INFO] Webhook server listening on port ${PORT}`);
});
