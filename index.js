require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// OTPIQ WhatsApp send function
async function sendWhatsApp(phoneNumber, templateName, templateParameters = {}) {
  try {
    console.log(`Sending WhatsApp template "${templateName}" to ${phoneNumber}...`);
    const response = await axios.post('https://api.otpiq.com/api/sms', {
      phoneNumber,
      smsType: 'whatsapp-template',
      provider: 'whatsapp',
      templateName,
      whatsappAccountId: process.env.OTPIQ_SENDER_ID,
      whatsappPhoneId: process.env.OTPIQ_PHONE_ID,
      templateParameters
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OTPIQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('WhatsApp sent:', response.data);
    return response.data;
  } catch (error) {
    console.error('WhatsApp error:', error.response?.data || error.message);
  }
}

// Webhook endpoint for Cal.com
app.post('/cal-webhook', async (req, res) => {
  try {
    console.log('Webhook received:', JSON.stringify(req.body, null, 2));

    const { triggerEvent, payload } = req.body;

    if (!payload || !payload.attendees || payload.attendees.length === 0) {
      console.warn('No attendees found in payload');
      return res.status(400).send('No attendees found');
    }

    const attendee = payload.attendees[0];
    const phoneNumber = attendee.responses?.phoneNumber || attendee.attendeePhoneNumber?.value;

    if (!phoneNumber) {
      console.warn('No phone number for attendee');
      return res.status(400).send('No phone number');
    }

    if (triggerEvent === 'BOOKING_CREATED') {
      await sendWhatsApp(phoneNumber, 'democall_booking_ar', { body: {} });
    } else if (triggerEvent === 'BOOKING_REMINDER') {
      // You can trigger reminders using a separate webhook or cron
      await sendWhatsApp(phoneNumber, 'democall_reminder_ar', { body: {} });
    }

    res.status(200).send('Webhook processed');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Server error');
  }
});

app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});
