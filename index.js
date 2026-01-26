import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const {
  CAL_API_KEY,
  OTPIQ_API_KEY,
  OTPIQ_ACCOUNT_ID,
  OTPIQ_PHONE_ID,
  PORT = 3000
} = process.env;

if (!CAL_API_KEY || !OTPIQ_API_KEY || !OTPIQ_ACCOUNT_ID || !OTPIQ_PHONE_ID) {
  console.error("❌ Missing ENV variables");
  process.exit(1);
}

// Track which reminders have been sent: bookingId -> Set of reminder types sent
const sentReminders = new Map(); // bookingId -> Set(["1hour", "5min"])

app.get("/", (_, res) => res.send("OK"));
app.listen(PORT, () => console.log("Server started on", PORT));

console.log("Booking service running...");

function formatDateParts(isoString) {
  const d = new Date(isoString);
  if (isNaN(d)) return null;

  // Format in Iraq/Baghdad timezone (UTC+3)
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  
  const parts = formatter.formatToParts(d);
  const day = parts.find(p => p.type === "day").value;
  const month = parts.find(p => p.type === "month").value;
  const year = parts.find(p => p.type === "year").value;
  const hour = parts.find(p => p.type === "hour").value;
  const minute = parts.find(p => p.type === "minute").value;
  
  const formattedDate = `${day}/${month}/${year}`;
  const formattedTime = `${hour}:${minute}`;

  return {
    date: formattedDate,
    time: formattedTime
  };
}

async function sendWhatsApp(phone, name, date, time) {
  try {
    console.log(`📤 Sending WhatsApp to ${phone}`);

    // Remove + prefix if present, as API expects plain number
    const phoneNumber = phone.startsWith("+") ? phone.slice(1) : phone;

    const res = await axios.post(
      "https://api.otpiq.com/api/sms",
      {
        phoneNumber: phoneNumber,
        smsType: "whatsapp-template",
        provider: "whatsapp",
        templateName: "democall_booking_ar",
        whatsappAccountId: OTPIQ_ACCOUNT_ID,
        whatsappPhoneId: OTPIQ_PHONE_ID,
        templateParameters: {
          body: {
            // WhatsApp template variables are typically passed as 1, 2, 3, etc.
            "1": name,
            "2": date,
            "3": time
          }
        }
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
    const errorDetails = {
      message: err.message,
      status: err.response?.status,
      statusText: err.response?.statusText,
      data: err.response?.data,
      url: err.config?.url
    };
    console.error("❌ WhatsApp error:", JSON.stringify(errorDetails, null, 2));
  }
}

function extractPhone(booking) {
  // Try multiple possible locations for phone number
  let phone =
    booking.responses?.phone?.value ||
    booking.responses?.phoneNumber?.value ||
    booking.responses?.phone?.label ||
    booking.responses?.phoneNumber?.label ||
    booking.bookingFieldsResponses?.phone ||
    booking.bookingFieldsResponses?.phoneNumber;

  // Check all attendees for phone numbers
  if (!phone && booking.attendees) {
    for (const attendee of booking.attendees) {
      phone = attendee.phone || attendee.phoneNumber || attendee.metadata?.phone;
      if (phone) break;
    }
  }

  // Check metadata
  if (!phone) {
    phone = booking.metadata?.phone;
  }

  // Check all bookingFieldsResponses keys for phone-like values
  if (!phone && booking.bookingFieldsResponses) {
    const responses = booking.bookingFieldsResponses;
    // Check for any field that might contain a phone (case-insensitive)
    for (const [key, value] of Object.entries(responses)) {
      if (key.toLowerCase().includes('phone') || key.toLowerCase().includes('mobile')) {
        phone = value;
        break;
      }
    }
  }

  if (!phone) {
    // Debug: log booking structure to understand the data format
    console.log(`📋 Booking ${booking.id} structure:`, JSON.stringify({
      hasResponses: !!booking.responses,
      hasBookingFieldsResponses: !!booking.bookingFieldsResponses,
      hasMetadata: !!booking.metadata,
      hasAttendees: !!booking.attendees,
      responsesKeys: booking.responses ? Object.keys(booking.responses) : [],
      bookingFieldsResponsesKeys: booking.bookingFieldsResponses ? Object.keys(booking.bookingFieldsResponses) : [],
      attendeesCount: booking.attendees?.length || 0,
      firstAttendeeKeys: booking.attendees?.[0] ? Object.keys(booking.attendees[0]) : []
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
    console.log("🔍 Checking bookings for reminders...");

    const res = await axios.get("https://api.cal.com/v2/bookings", {
      headers: {
        Authorization: `Bearer ${CAL_API_KEY}`,
        "cal-api-version": "2024-08-13"
      },
      params: {
        status: "upcoming",
        limit: 50 // Get more bookings to check for reminders
      }
    });

    const bookings = res.data.data || [];
    console.log(`📦 Fetched ${bookings.length} bookings`);

    // Filter to only process accepted bookings
    const acceptedBookings = bookings.filter(
      booking => booking.status === "ACCEPTED" || booking.status === "accepted"
    );
    console.log(`✅ Found ${acceptedBookings.length} accepted bookings`);

    const now = new Date();
    const remindersToSend = [];

    for (const booking of acceptedBookings) {
      if (!booking.start) {
        continue;
      }

      const bookingStart = new Date(booking.start);
      if (isNaN(bookingStart.getTime())) {
        continue;
      }

      // Skip if booking is in the past
      if (bookingStart < now) {
        continue;
      }

      // Calculate time until booking in minutes
      const timeUntilBooking = (bookingStart - now) / 1000 / 60;
      
      // Get reminders already sent for this booking
      const sentForBooking = sentReminders.get(booking.id) || new Set();

      // Check if we should send 1 hour reminder (60 minutes, with 1 minute tolerance)
      if (timeUntilBooking <= 61 && timeUntilBooking >= 59 && !sentForBooking.has("1hour")) {
        remindersToSend.push({ booking, reminderType: "1hour", timeUntil: timeUntilBooking });
        sentForBooking.add("1hour");
        sentReminders.set(booking.id, sentForBooking);
      }
      
      // Check if we should send 5 minute reminder (5 minutes, with 1 minute tolerance)
      if (timeUntilBooking <= 6 && timeUntilBooking >= 4 && !sentForBooking.has("5min")) {
        remindersToSend.push({ booking, reminderType: "5min", timeUntil: timeUntilBooking });
        sentForBooking.add("5min");
        sentReminders.set(booking.id, sentForBooking);
      }
    }

    console.log(`🔔 Found ${remindersToSend.length} reminders to send`);

    for (const { booking, reminderType, timeUntil } of remindersToSend) {
      console.log(`⏰ Sending ${reminderType} reminder for booking ${booking.id} (${Math.round(timeUntil)} minutes until booking)`);
      await processBooking(booking);
    }

    // Clean up old reminders (bookings that have passed)
    for (const [bookingId, sentSet] of sentReminders.entries()) {
      const booking = acceptedBookings.find(b => b.id === bookingId);
      if (booking && booking.start) {
        const bookingStart = new Date(booking.start);
        if (bookingStart < now) {
          // Booking has passed, remove from tracking
          sentReminders.delete(bookingId);
        }
      }
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
