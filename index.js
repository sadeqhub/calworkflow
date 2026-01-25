const axios = require('axios');

// ===== ENV VARIABLES =====
const {
  CAL_API_KEY,
  CAL_ORG_ID,        // not required for /v2/bookings but kept for future use
  OTPIQ_API_KEY,
  OTPIQ_PHONE_ID,    // WhatsApp phone number ID
  OTPIQ_SENDER_ID,   // WhatsApp account ID
  PORT = 3000
} = process.env;

if (!CAL_API_KEY || !OTPIQ_API_KEY || !OTPIQ_PHONE_ID || !OTPIQ_SENDER_ID) {
  console.error('Missing required environment variables');
  process.exit(1);
}

console.log('Booking service running...');

// Prevent duplicate sends
const processedBookings = new Set();
let lastCheckTime = new Date(Date.now() - 60 * 1000).toISOString();

async function checkBookings() {
  console.log(`Checking bookings since ${lastCheckTime}`);

  try {
    const res = await axios.get('https://api.cal.com/v2/bookings', {
      headers: {
        Authorization: `Bearer ${CAL_API_KEY}`,
        'cal-api-version': '2024-08-13',
      },
    });

    const bookings = res.data?.data || [];
    console.log(`Found ${bookings.length} bookings`);

    const newLastCheck = new Date().toISOString();

    for (const booking of bookings) {
      if (processedBookings.has(booking.id)) continue;

      const createdAt = new Date(booking.createdAt);
      if (createdAt < new Date(lastCheckTime)) continue;

      const attendee = booking.attendees?.[0];

      if (!attendee?.phoneNumber) {
        console.log(`Skipping booking ${booking.id} - no phone`);
        continue;
      }

      const startTime = new Date(booking.startTime);
      if (isNaN(startTime)) {
        console.log(`Skipping booking ${booking.id} - invalid date`);
        continue;
      }

      const phone = attendee.phoneNumber.replace(/\D/g, '');

      const dateStr = startTime.toLocaleDateString('en-GB');
      const timeStr = startTime.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      });

      console.log(`Sending booking template → ${phone}`, {
        name: attendee.name,
        date: dateStr,
        time: timeStr,
      });

      try {
        await axios.post(
          'https://api.otpiq.com/api/sms',
          {
            phoneNumber: phone,
            smsType: 'whatsapp-template',
            provider: 'whatsapp',
            templateName: 'democall_booking_ar',
            whatsappAccountId: OTPIQ_SENDER_ID,   // sender/account
            whatsappPhoneId: OTPIQ_PHONE_ID,      // phone ID
            templateParameters: {
              body: {
                name: attendee.name || 'Customer',
                date: dateStr,
                time: timeStr,
              },
            },
          },
          {
            headers: {
              Authorization: `Bearer ${OTPIQ_API_KEY}`,
              'Content-Type': 'application/json',
            },
          }
        );

        console.log(`WhatsApp sent for booking ${booking.id}`);
        processedBookings.add(booking.id);

      } catch (waErr) {
        console.error('WhatsApp error:', waErr.response?.data || waErr.message);
      }
    }

    lastCheckTime = newLastCheck;

  } catch (err) {
    console.error('Cal API error:', err.response?.data || err.message);
  }
}

// Run every minute
setInterval(checkBookings, 60 * 1000);
checkBookings();

// Keep Railway container alive
require('http')
  .createServer((req, res) => res.end('OK'))
  .listen(PORT);
