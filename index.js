import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const {
  CAL_API_KEY,
  CAL_ORG_ID,
  OTPIQ_API_KEY,
  OTPIQ_PHONE_ID,
  OTPIQ_SENDER_ID,
  PORT
} = process.env;

const app = express();
app.get("/", (req, res) => res.send("Bot running"));

let lastCheck = new Date(Date.now() - 60 * 1000).toISOString();
const processedBookings = new Set();

console.log("Booking service running...");

setInterval(checkBookings, 60000);

async function checkBookings() {
  console.log("🔍 Checking bookings since", lastCheck);

  try {
    const res = await axios.get("https://api.cal.com/v2/bookings", {
      headers: {
        Authorization: `Bearer ${CAL_API_KEY}`,
        "cal-api-version": "2024-08-13"
      },
      params: {
        organizationId: CAL_ORG_ID,
        updatedAfter: lastCheck,
        status: "accepted"
      }
    });

    const bookings = res.data.data || [];
    console.log(`📦 Fetched ${bookings.length} bookings`);

    for (const booking of bookings) {
      await processBooking(booking);
    }

    lastCheck = new Date().toISOString();

  } catch (err) {
    console.error("❌ Cal fetch error:", err.response?.data || err.message);
  }
}

async function processBooking(booking) {
  if (processedBookings.has(booking.id)) return;

  console.log(`➡️ Processing booking ${booking.id}`);

  const start = booking.start;
  if (!start) {
    console.log(`❌ No start date for booking ${booking.id}`);
    return;
  }

  const dateObj = new Date(start);
  if (isNaN(dateObj)) {
    console.log(`❌ Invalid date for booking ${booking.id}`);
    return;
  }

  const attendee = booking.attendees?.[0];
  const name = attendee?.name || "Customer";

  // TRY TO GET PHONE
  const phone =
    booking.bookingFieldsResponses?.phone ||
    booking.metadata?.phone ||
    null;

  if (!phone) {
    console.log(`❌ No phone number for booking ${booking.id}`);
    return;
  }

  const date = dateObj.toLocaleDateString("ar-EG");
  const time = dateObj.toLocaleTimeString("ar-EG", {
    hour: "2-digit",
    minute: "2-digit"
  });

  await sendWhatsApp(phone, name, date, time);
  processedBookings.add(booking.id);
}

async function sendWhatsApp(phone, name, date, time) {
  console.log("📤 Sending WhatsApp to", phone);

  try {
    await axios.post(
      "https://api.otpiq.com/v1/whatsapp/template",
      {
        phone_id: OTPIQ_PHONE_ID,
        sender_id: OTPIQ_SENDER_ID,
        to: phone,
        template: "democall_booking_ar",
        parameters: [name, date, time]
      },
      {
        headers: {
          Authorization: `Bearer ${OTPIQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ WhatsApp sent");

  } catch (err) {
    console.error("❌ WhatsApp error:", err.response?.data || err.message);
  }
}

app.listen(PORT, () => console.log("Server started"));
