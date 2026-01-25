require('dotenv').config();
const axios = require('axios');

const CAL_API_KEY = process.env.CAL_API_KEY;
const CAL_ORG_ID = process.env.CAL_ORG_ID;
const OTPIQ_API_KEY = process.env.OTPIQ_API_KEY;
const OTPIQ_SENDER_ID = process.env.OTPIQ_SENDER_ID;
const OTPIQ_PHONE_ID = process.env.OTPIQ_PHONE_ID;

const checkInterval = 60 * 1000; // 1 minute
let lastCheck = new Date().toISOString();

// Track sent messages to avoid duplicates
const sentMessages = {
  booking: new Set(),
  reminder1h: new Set(),
  reminder5m: new Set()
};

console.log('Booking and reminder service running...');

async function sendWhatsApp(phoneNumber, templateName, templateParameters = {}) {
  try {
    console.log(`Sending WhatsApp template "${templateName}" to ${phoneNumber} with params`, templateParameters);
    const res = await axios.post('https://api.otpiq.com/api/sms', {
      phoneNumber,
      smsType: 'whatsapp-template',
      provider: 'whatsapp',
      templateName,
      whatsappAccountId: OTPIQ_SENDER_ID,
      whatsappPhoneId: OTPIQ_PHONE_ID,
      templateParameters
    }, {
      headers: {
        'Authorization': `Bearer ${OTPIQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('WhatsApp sent:', res.data);
  } catch (err) {
    console.error('WhatsApp error:', err.response?.data || err.message);
  }
}

async function checkBookings() {
  try {
    console.log('Checking bookings since', lastCheck);
    const response = await axios.get(`https://api.cal.com/v2/organizations/${CAL_ORG_ID}/bookings?status=upcoming&take=100`, {
      headers: { Authorization: `Bearer ${CAL_API_KEY}` }
    });

    const bookings = response.data?.data || [];
    const now = new Date();

    for (let booking of bookings) {
      const bookingId = booking.id;
      const startTime = new Date(booking.startTime);
      const attendee = booking.attendees?.[0];

      if (!attendee || !attendee.responses?.phoneNumber) {
        console.warn('No phone number for attendee', bookingId);
        continue;
      }

      const phoneNumber = attendee.responses.phoneNumber;
      const name = attendee.responses.name || attendee.name || '';
      const date = startTime.toLocaleDateString('en-GB');
      const time = startTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

      // 1️⃣ New booking: send immediately
      if (!sentMessages.booking.has(bookingId) && new Date(booking.createdAt) > new Date(lastCheck)) {
        await sendWhatsApp(phoneNumber, 'democall_booking_ar', { body: { name, date, time } });
        sentMessages.booking.add(bookingId);
      }

      // 2️⃣ 1 hour before meeting
      const diffMs = startTime - now;
      const diffMinutes = diffMs / (1000 * 60);

      if (!sentMessages.reminder1h.has(bookingId) && diffMinutes <= 60 && diffMinutes > 59) {
        await sendWhatsApp(phoneNumber, 'democall_reminder_ar', { body: { name, date, time } });
        sentMessages.reminder1h.add(bookingId);
      }

      // 3️⃣ 5 minutes before meeting
      if (!sentMessages.reminder5m.has(bookingId) && diffMinutes <= 5 && diffMinutes > 4) {
        await sendWhatsApp(phoneNumber, 'democall_reminder_ar', { body: { name, date, time } });
        sentMessages.reminder5m.add(bookingId);
      }
    }

    lastCheck = now.toISOString();
  } catch (err) {
    console.error('Error in checkBookings:', err.response?.data || err.message);
  }
}

// Run every minute
setInterval(checkBookings, checkInterval);
