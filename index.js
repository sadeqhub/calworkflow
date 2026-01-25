require('dotenv').config();
const axios = require('axios');

const CAL_API_KEY = process.env.CAL_API_KEY;
const CAL_ORG_ID = process.env.CAL_ORG_ID;
const OTPIQ_API_KEY = process.env.OTPIQ_API_KEY;
const OTPIQ_SENDER_ID = process.env.OTPIQ_SENDER_ID;
const PORT = process.env.PORT || 3000;

const ONE_HOUR = 60 * 60 * 1000;
const FIVE_MIN = 5 * 60 * 1000;

// Helper: send WhatsApp message via OTPIQ
async function sendWhatsApp(phoneNumber, templateName, templateParams = {}) {
  try {
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
    console.log(`WhatsApp sent to ${phoneNumber}:`, res.data);
  } catch (err) {
    console.error('WhatsApp error:', err.response?.data || err.message);
  }
}

// Helper: fetch upcoming bookings from Cal
async function fetchBookings() {
  try {
    const res = await axios.get(`https://api.cal.com/v2/organizations/${CAL_ORG_ID}/bookings?status=upcoming&take=100`, {
      headers: { Authorization: `Bearer ${CAL_API_KEY}` }
    });
    return res.data?.bookings || [];
  } catch (err) {
    console.error('Error in checkBookings:', err.response?.data || err.message);
    return [];
  }
}

// Main cron function
async function checkBookingsAndSendMessages() {
  const now = new Date();
  const bookings = await fetchBookings();

  for (const booking of bookings) {
    const startTime = new Date(booking.startTime);
    const phone = booking.attendees?.[0]?.phoneNumber;
    if (!phone) continue;

    const diff = startTime - now;

    if (diff <= 0 && diff > -60 * 1000) {
      // Booking created now (within 1 min)
      await sendWhatsApp(phone, 'democall_booking_ar', { name: booking.attendees[0].name });
    } else if (Math.abs(diff - ONE_HOUR) < 60 * 1000) {
      // Meeting in 1 hour
      await sendWhatsApp(phone, 'democall_reminder_ar', { name: booking.attendees[0].name });
    } else if (Math.abs(diff - FIVE_MIN) < 60 * 1000) {
      // Meeting in 5 minutes
      await sendWhatsApp(phone, 'democall_reminder_ar', { name: booking.attendees[0].name });
    }
  }
}

// Start cron
console.log('Booking reminder service running...');
setInterval(checkBookingsAndSendMessages, 60 * 1000);
