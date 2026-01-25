require('dotenv').config();
const axios = require('axios');

const CAL_API_KEY = process.env.CAL_API_KEY;
const OTPIQ_API_KEY = process.env.OTPIQ_API_KEY;
const OTPIQ_SENDER_ID = process.env.OTPIQ_SENDER_ID;

let lastCheck = new Date().toISOString();

console.log('Booking and reminder service running...');

async function checkBookings() {
  console.log(`Checking bookings since ${lastCheck}`);

  try {
    const res = await axios.get('https://api.cal.com/v2/bookings', {
      headers: {
        Authorization: `Bearer ${CAL_API_KEY}`,
        'cal-api-version': '2024-08-13',
      },
      params: {
        status: 'upcoming',
      },
    });

    const bookings = res.data.data || [];
    console.log(`Found ${bookings.length} upcoming bookings`);

    for (const booking of bookings) {
      console.log('Raw booking object:', booking);

      const attendee = booking.attendees?.[0]; // assuming first attendee
      if (!attendee?.phoneNumber) {
        console.log(`Skipping booking ${booking.id} - no phone number`);
        continue;
      }

      const startTime = booking.startTime ? new Date(booking.startTime) : null;
      const dateStr = startTime
        ? startTime.toLocaleDateString('en-GB')
        : 'Invalid Date';
      const timeStr = startTime
        ? startTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : 'Invalid Date';

      let phone = attendee.phoneNumber;
      if (!phone.startsWith('+')) phone = '+' + phone;

      console.log(
        `Sending WhatsApp democall_booking_ar to ${phone}`,
        { name: attendee.name || 'N/A', date: dateStr, time: timeStr }
      );

      try {
        const sendRes = await axios.post(
          'https://api.otpiq.com/api/sms',
          {
            phoneNumber: phone,
            smsType: 'whatsapp-template',
            provider: 'whatsapp',
            templateName: 'democall_booking_ar',
            whatsappAccountId: OTPIQ_SENDER_ID,
            whatsappPhoneId: OTPIQ_SENDER_ID,
            templateParameters: {
              body: {
                name: attendee.name || 'N/A',
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
        console.log('WhatsApp sent:', sendRes.data);
      } catch (err) {
        console.error('WhatsApp error:', err.response?.data || err.message);
      }
    }

    lastCheck = new Date().toISOString();
  } catch (err) {
    console.error('Error in checkBookings:', err.response?.data || err.message);
  }
}

// Run every minute
setInterval(checkBookings, 60 * 1000);
checkBookings();
