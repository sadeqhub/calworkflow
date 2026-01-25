require('dotenv').config();
const axios = require('axios');

const CAL_API_KEY = process.env.CAL_API_KEY;
const OTPIQ_API_KEY = process.env.OTPIQ_API_KEY;
const OTPIQ_SENDER_ID = process.env.OTPIQ_SENDER_ID; // WhatsApp account ID
const PORT = process.env.PORT || 3000;

let lastCheck = new Date().toISOString();

async function sendWhatsApp(phoneNumber, templateName, templateParams) {
  try {
    console.log(`Sending WhatsApp ${templateName} to ${phoneNumber}`, templateParams);
    const res = await axios.post('https://api.otpiq.com/api/sms', {
      phoneNumber,
      smsType: "whatsapp-template",
      provider: "whatsapp",
      templateName,
      whatsappAccountId: OTPIQ_SENDER_ID,
      whatsappPhoneId: OTPIQ_SENDER_ID,
      templateParameters: {
        body: templateParams
      }
    }, {
      headers: {
        'Authorization': `Bearer ${OTPIQ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    console.log('WhatsApp sent:', res.data);
  } catch (err) {
    console.error('WhatsApp error:', err.response ? err.response.data : err.message);
  }
}

async function checkBookings() {
  console.log(`Checking bookings since ${lastCheck}`);
  try {
    const res = await axios.get(`https://api.cal.com/v2/bookings?status=upcoming&take=100&from=${lastCheck}`, {
      headers: {
        'Authorization': `Bearer ${CAL_API_KEY}`,
        'cal-api-version': '2024-08-13',
        'Content-Type': 'application/json'
      }
    });

    const bookings = res.data.data || [];
    const now = new Date();

    console.log(`Found ${bookings.length} upcoming bookings`);

    for (const booking of bookings) {
      const attendee = booking.attendees?.[0];
      if (!attendee?.phoneNumber) {
        console.log(`Skipping booking ${booking.id} - no phone number`);
        continue;
      }

      const phone = attendee.phoneNumber;
      const name = attendee.name || attendee.email || "Customer";
      const startTime = new Date(booking.startTime);
      const dateStr = startTime.toLocaleDateString('en-GB');
      const timeStr = startTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

      // New booking (just created)
      if (new Date(booking.createdAt) >= new Date(lastCheck)) {
        await sendWhatsApp(phone, 'democall_booking_ar', { name, date: dateStr, time: timeStr });
      }

      // Reminder in 1 hour
      const diffMs = startTime - now;
      if (diffMs > 0 && diffMs <= 60 * 60 * 1000) {
        await sendWhatsApp(phone, 'democall_reminder_ar', { name, date: dateStr, time: timeStr });
      }

      // Reminder in 5 minutes
      if (diffMs > 0 && diffMs <= 5 * 60 * 1000) {
        await sendWhatsApp(phone, 'democall_reminder_ar', { name, date: dateStr, time: timeStr });
      }
    }

    lastCheck = now.toISOString();
  } catch (err) {
    console.error('Error in checkBookings:', err.response ? err.response.data : err.message);
  }
}

// Run every minute
setInterval(checkBookings, 60 * 1000);
console.log('Booking and reminder service running...');
