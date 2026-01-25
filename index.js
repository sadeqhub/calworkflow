const axios = require('axios');
require('dotenv').config();

const CAL_API_KEY = process.env.CAL_API_KEY;
const OTPIQ_API_KEY = process.env.OTPIQ_API_KEY;
const OTPIQ_PHONE_ID = process.env.OTPIQ_PHONE_ID;
const OTPIQ_SENDER_ID = process.env.OTPIQ_SENDER_ID;
const PORT = process.env.PORT || 3000;

if (!CAL_API_KEY || !OTPIQ_API_KEY || !OTPIQ_PHONE_ID || !OTPIQ_SENDER_ID) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const processedBookings = new Set();

console.log('Booking service running...');

setInterval(checkBookings, 60 * 1000);

async function checkBookings() {
  console.log('\n🔍 Checking bookings...');

  try {
    const res = await axios.get('https://api.cal.com/v2/bookings', {
      headers: {
        Authorization: `Bearer ${CAL_API_KEY}`,
        'cal-api-version': '2024-08-13',
      },
      params: {
        status: 'upcoming',
        take: 100,
      },
    });

    const bookings = res.data?.data || [];
    console.log(`📦 Fetched ${bookings.length} bookings`);

    for (const booking of bookings) {
      if (processedBookings.has(booking.id)) continue;

      console.log(`➡️ Processing booking ${booking.id}`);

      const attendee = booking.attendees?.[0];

      if (!attendee?.phoneNumber) {
        console.log(`❌ No phone number for booking ${booking.id}`);
        continue;
      }

      const startTime = new Date(booking.startTime);
      if (isNaN(startTime)) {
        console.log(`❌ Invalid date for booking ${booking.id}`);
        continue;
      }

      const phone = attendee.phoneNumber.replace(/\D/g, '');
      const dateStr = startTime.toLocaleDateString('en-GB');
      const timeStr = startTime.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
      });

      console.log(`📤 Sending WhatsApp → ${phone}`, {
        name: attendee.name,
        date: dateStr,
        time: timeStr,
      });

      try {
        const waRes = await axios.post(
          'https://api.otpiq.com/api/sms',
          {
            phoneNumber: phone,
            smsType: 'whatsapp-template',
            provider: 'whatsapp',
            templateName: 'democall_booking_ar',
            whatsappAccountId: OTPIQ_SENDER_ID,
            whatsappPhoneId: OTPIQ_PHONE_ID,
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

        console.log(`✅ WhatsApp sent for booking ${booking.id}`);
        processedBookings.add(booking.id);

      } catch (waErr) {
        console.error(`❌ WhatsApp FAILED for ${booking.id}`, waErr.response?.data || waErr.message);
      }
    }

  } catch (err) {
    console.error('❌ Cal API error:', err.response?.data || err.message);
  }
}
