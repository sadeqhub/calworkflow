import axios from "axios";
import dotenv from "dotenv";
import http from "http";

dotenv.config();

const {
  CAL_API_KEY,
  CAL_ORG_ID,
  OTPIQ_API_KEY,
  OTPIQ_PHONE_ID,
  OTPIQ_SENDER_ID,
  PORT
} = process.env;

const processedBookings = new Set();

/* ---------------- CAL FETCH ---------------- */

async function fetchBookings() {
  try {
    console.log("🔍 Checking bookings...");

    const res = await axios.get("https://api.cal.com/v2/bookings", {
      headers: {
        Authorization: `Bearer ${CAL_API_KEY}`,
        "cal-api-version": "2024-08-13",
      },
      params: {
        organizationId: CAL_ORG_ID,
        status: "accepted",
      },
    });

    const bookings = res.data.data || [];
    console.log(`📦 Fetched ${bookings.length} bookings`);

    for (const booking of bookings) {
      if (processedBookings.has(booking.id)) continue;
      await processBooking(booking);
      processedBookings.add(booking.id);
    }
  } catch (err) {
    console.error("❌ Cal API error:", err.response?.data || err.message);
  }
}

/* ---------------- BOOKING PROCESS ---------------- */

async function processBooking(booking) {
  console.log(`➡️ Processing booking ${booking.id}`);

  const startDate = new Date(booking.start);

  if (isNaN(startDate.getTime())) {
    console.log(`❌ Invalid date for booking ${booking.id}`);
    return;
  }

  const attendee = booking.attendees?.[0];

  if (!attendee?.email) {
    console.log(`❌ No attendee email for booking ${booking.id}`);
    return;
  }

  const name = attendee.name || "Customer";
  const email = attendee.email;

  const message = `Hello ${name}, your onboarding call is confirmed for ${startDate.toUTCString()}.`;

  console.log(`📨 Sending message to ${email}`);

  await sendWhatsApp(email, message);
}

/* ---------------- WHATSAPP SEND (OTPIQ) ---------------- */

async function sendWhatsApp(to, text) {
  try {
    await axios.post(
      `https://api.otpiq.com/v1/whatsapp/send`,
      {
        phone_id: OTPIQ_PHONE_ID,
        sender_id: OTPIQ_SENDER_ID,
        to,
        type: "text",
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${OTPIQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ Message sent");
  } catch (err) {
    console.error("❌ WhatsApp send failed:", err.response?.data || err.message);
  }
}

/* ---------------- SERVER (required by host) ---------------- */

http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("Bot running");
  })
  .listen(PORT, () => console.log(`Server started on ${PORT}`));

/* ---------------- POLL LOOP ---------------- */

setInterval(fetchBookings, 60 * 1000);
console.log("Booking service running...");
