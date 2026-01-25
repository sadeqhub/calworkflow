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

// Helper: fetch upcoming bookings from Cal
async function fetchBookings() {
  try {
    console.log('[INFO] Fetching upcoming bookings from Cal...');
    const res = await axios.get(`https://api.cal.com/v2/organizations/${CAL_ORG_ID}/bookings?status=upcoming&take=100`, {
      headers: { Authorization: `Bearer ${CAL_API_KEY}` }
    });
    console.log(`[INFO] Fetched ${res.data?.bookings?.length || 0} bookings`);
    return res.data?.bookings || [];
  } catch (err) {
    console.error('[ERROR] Failed to fetch bookings:', err.response?.data || err.message);
    return [];
  }
}

// Main cron function
async function checkBookingsAndSendMessages() {
  const now = new Date();
  console.log(`[INFO] Checking bookings at ${now.toISOString()}`);

  const bookings = await fetchBookings();
  if (!bookings.length) {
    console.log('[INFO] No upcoming bookings found.');
    return;
  }

  for (const booking of bookings) {
    const startTime = new Date(booking.startTime);
    const phone = booking.attendees?.[0]?.phoneNumber;
    const attendeeName = booking.attendees?.[0]?.name || 'Guest';

    if (!phone) {
      console.warn(`[WARN] Booking ${booking.id} has no phone number. Skipping.`);
      continue;
    }

    const diff = startTime - now;

    console.log(`[INFO] Booking ${booking.id} for ${attendeeName} at ${startTime.toISOString()} (diff: ${diff}ms)`);

    if (diff <= 0 && diff > -60 * 1000) {
      console.log('[INFO] Booking created now. Sending booking template...');
      await sendWhatsApp(phone, 'democall_booking_ar', { name: attendeeName });
    } else if (Math.abs(diff - ONE_HOUR) < 60 * 1000) {
      console.log('[INFO] Meeting in 1 hour. Sending reminder template...');
      await sendWhatsApp(phone, 'democall_reminder_ar', { name: attendeeName });
    } else if (Math.abs(diff - FIVE_MIN) < 60 * 1000) {
      console.log('[INFO] Meeting in 5 minutes. Sending reminder template...');
      await sendWhatsApp(phone, 'democall_reminder_ar', { name: attendeeName });
    } else {
      console.log('[INFO] No action needed for this booking at this time.');
    }
  }
}

// Start cron
console.log('[INFO] Booking reminder service running...');
setInterval(checkBookingsAndSendMessages, 60 * 1000);
