const axios = require('axios');
const dayjs = require('dayjs');

const CAL_API_KEY = process.env.CAL_API_KEY;
const ORG_ID = process.env.CAL_ORG_ID;

const OTPIQ_TOKEN = process.env.OTPIQ_TOKEN;
const WHATSAPP_ACCOUNT_ID = process.env.WHATSAPP_ACCOUNT_ID;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const CAL_BOOKINGS_URL = `https://api.cal.com/v2/organizations/${ORG_ID}/bookings?status=upcoming&take=100`;

// Send WhatsApp via Otpiq
async function sendWhatsApp({ phone, templateName, templateParams }) {
  try {
    const response = await axios.post(
      'https://api.otpiq.com/api/sms',
      {
        phoneNumber: phone,
        smsType: 'whatsapp-template',
        provider: 'whatsapp',
        templateName,
        whatsappAccountId: WHATSAPP_ACCOUNT_ID,
        whatsappPhoneId: WHATSAPP_PHONE_ID,
        templateParameters: { body: templateParams }
      },
      {
        headers: {
          Authorization: `Bearer ${OTPIQ_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`WhatsApp sent to ${phone} using ${templateName}:`, response.data);
  } catch (err) {
    console.error('WhatsApp error:', err.response?.data || err.message);
  }
}

// Check bookings and send messages
async function checkBookings() {
  try {
    const res = await axios.get(CAL_BOOKINGS_URL, {
      headers: { Authorization: `Bearer ${CAL_API_KEY}` }
    });

    const bookings = res.data.bookings || [];
    const now = dayjs();

    for (const booking of bookings) {
      const startTime = dayjs(booking.startTime);
      const createdAt = dayjs(booking.createdAt);
      const phone = booking.attendees?.[0]?.responses?.phoneNumber;
      const name = booking.attendees?.[0]?.responses?.name || 'Guest';

      if (!phone) continue;

      const diffMinutes = startTime.diff(now, 'minute');
      const justCreated = now.diff(createdAt, 'minute') <= 1;

      if (justCreated) {
        // Send booking template
        await sendWhatsApp({
          phone,
          templateName: 'democall_booking_ar',
          templateParams: {
            1: name,
            2: startTime.format('YYYY-MM-DD'),
            3: startTime.format('HH:mm')
          }
        });
      } else if (diffMinutes === 60 || diffMinutes === 5) {
        // Send reminder template
        await sendWhatsApp({
          phone,
          templateName: 'democall_reminder_ar',
          templateParams: {
            1: name,
            2: startTime.format('YYYY-MM-DD'),
            3: startTime.format('HH:mm')
          }
        });
      }
    }
  } catch (err) {
    console.error('Error in checkBookings:', err.response?.data || err.message);
  }
}

// Run every minute
setInterval(checkBookings, 60 * 1000);

console.log('Booking reminder service running...');
