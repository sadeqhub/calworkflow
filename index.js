import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const {
  CAL_API_KEY,
  OTPIQ_API_KEY,
  OTPIQ_PHONE_ID,
  OTPIQ_SENDER_ID,
  PORT = 3000
} = process.env;

if (!CAL_API_KEY || !OTPIQ_API_KEY || !OTPIQ_PHONE_ID || !OTPIQ_SENDER_ID) {
  console.error("❌ Missing ENV variables");
  process.exit(1);
}

const processedBookings = new Set();

app.get("/", (_, res) => res.send("OK"));
app.listen(PORT, () => console.log("Server started on", PORT));

console.log("Booking service running...");

function formatDateParts(isoString) {
  const d = new Date(isoString);
  if (isNaN(d)) return null;

  return {
    date: d.toLocaleDateString("en-GB"), // 26/01/2026
    time: d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  };
}

async function sendWhatsApp(phone, name, date, time) {
  try {
    console.log(`📤 Sending WhatsApp to ${phone}`);

    const res = await axios.post(
      `https://api.otpiq.com/whatsapp/${OTPIQ_PHONE_ID}/send-template`,
      {
        sender: OTPIQ_SENDER_ID,
        to: phone,
        template: "democall_booking_ar",
        variables: [name, date, time]
      },
      {
        headers: {
          Authorization: `Bearer ${OTPIQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ WhatsApp sent:", res.data);
  } catch (err) {
    console.error("❌ WhatsApp error:", err.response?.data || err.message);
  }
}

function extractPhone(booking) {
  // Try multiple possible locations for phone number
  const phone =
    booking.responses?.phone?.value ||
    booking.responses?.phoneNumber?.value ||
    booking.responses?.phone?.label ||
    booking.responses?.phoneNumber?.label ||
    booking.bookingFieldsResponses?.phone ||
    booking.bookingFieldsResponses?.phoneNumber ||
    booking.metadata?.phone ||
    booking.attendees?.[0]?.phone ||
    booking.attendees?.[0]?.phoneNumber;

  if (!phone) {
    // Debug: log booking structure to understand the data format
    console.log(`📋 Booking ${booking.id} structure:`, JSON.stringify({
      hasResponses: !!booking.responses,
      hasBookingFieldsResponses: !!booking.bookingFieldsResponses,
      hasMetadata: !!booking.metadata,
      hasAttendees: !!booking.attendees,
      responsesKeys: booking.responses ? Object.keys(booking.responses) : [],
      bookingFieldsResponsesKeys: booking.bookingFieldsResponses ? Object.keys(booking.bookingFieldsResponses) : []
    }, null, 2));
    return null;
  }

  // Clean and format phone number
  const cleaned = String(phone).trim().replace(/\s+/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

async function processBooking(booking) {
  console.log(`➡️ Processing booking ${booking.id}`);

  if (!booking.start) {
    console.log("❌ No start date");
    return;
  }

  const dateParts = formatDateParts(booking.start);
  if (!dateParts) {
    console.log("❌ Invalid date");
    return;
  }

  const phone = extractPhone(booking);
  if (!phone) {
    console.log("❌ No phone number in booking form");
    return;
  }

  const name =
    booking.attendees?.[0]?.name ||
    booking.bookingFieldsResponses?.name ||
    "Guest";

  await sendWhatsApp(phone, name, dateParts.date, dateParts.time);
}

async function fetchBookings() {
  try {
    console.log("🔍 Checking bookings...");

    const res = await axios.get("https://api.cal.com/v2/bookings", {
      headers: {
        Authorization: `Bearer ${CAL_API_KEY}`,
        "cal-api-version": "2024-08-13"
      },
      params: {
        status: "upcoming",
        limit: 20
      }
    });

    const bookings = res.data.data || [];
    console.log(`📦 Fetched ${bookings.length} bookings`);

    // Filter to only process accepted bookings
    const acceptedBookings = bookings.filter(
      booking => booking.status === "ACCEPTED" || booking.status === "accepted"
    );
    console.log(`✅ Found ${acceptedBookings.length} accepted bookings`);

    for (const booking of acceptedBookings) {
      if (processedBookings.has(booking.id)) continue;
      await processBooking(booking);
      processedBookings.add(booking.id);
    }
  } catch (err) {
    const errorData = err.response?.data || {};
    console.error("❌ Cal API error:", JSON.stringify(errorData, null, 2));
    if (errorData.details?.errors) {
      console.error("Error details:", JSON.stringify(errorData.details.errors, null, 2));
    }
  }
}

setInterval(fetchBookings, 60 * 1000);
fetchBookings();
