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

const sentReminders = new Map();
const sentConfirmations = new Set();

app.get("/", (_, res) => res.send("OK"));
app.listen(PORT, () => console.log("Server started on", PORT));

console.log("Booking service running...");

function formatDatePartsArabic(isoString) {
  const d = new Date(isoString);
  if (isNaN(d)) return null;

  const dateFormatter = new Intl.DateTimeFormat("ar-SA", {
    timeZone: "Asia/Baghdad",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  
  const timeFormatter = new Intl.DateTimeFormat("ar-SA", {
    timeZone: "Asia/Baghdad",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  
  const formattedDate = dateFormatter.format(d);
  const formattedTime = timeFormatter.format(d);

  return {
    date: formattedDate,
    time: formattedTime
  };
}

async function sendBookingConfirmation(phone, name, date, time) {
  try {
    console.log(`📤 Sending booking confirmation WhatsApp to ${phone}`);

    const phoneNumber = phone.startsWith("+") ? phone.slice(1) : phone;

    const requestPayload = {
      phoneNumber: phoneNumber,
      smsType: "whatsapp-template",
      provider: "whatsapp",
      templateName: "democall_booking_ar",
      whatsappAccountId: OTPIQ_ACCOUNT_ID,
      whatsappPhoneId: OTPIQ_PHONE_ID,
      templateParameters: {
        body: {
          "1": name,
          "2": date,
          "3": time
        }
      }
    };

    console.log("📋 Booking confirmation request payload:", JSON.stringify(requestPayload, null, 2));

    const res = await axios.post(
      "https://api.otpiq.com/api/sms",
      requestPayload,
      {
        headers: {
          Authorization: `Bearer ${OTPIQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ Booking confirmation WhatsApp response status:", res.status);
    console.log("✅ Booking confirmation WhatsApp response data:", JSON.stringify(res.data, null, 2));
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

async function sendReminder(phone, name, timeRemaining) {
  try {
    console.log(`📤 Sending reminder WhatsApp to ${phone}`);

    const phoneNumber = phone.startsWith("+") ? phone.slice(1) : phone;

    const requestPayload = {
      phoneNumber: phoneNumber,
      smsType: "whatsapp-template",
      provider: "whatsapp",
      templateName: "democall_reminder_ar",
      whatsappAccountId: OTPIQ_ACCOUNT_ID,
      whatsappPhoneId: OTPIQ_PHONE_ID,
      templateParameters: {
        body: {
          "1": name,
          "2": timeRemaining
        }
      }
    };

    console.log("📋 Reminder request payload:", JSON.stringify(requestPayload, null, 2));

    const res = await axios.post(
      "https://api.otpiq.com/api/sms",
      requestPayload,
      {
        headers: {
          Authorization: `Bearer ${OTPIQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ Reminder WhatsApp response status:", res.status);
    console.log("✅ Reminder WhatsApp response data:", JSON.stringify(res.data, null, 2));
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
  let phone =
    booking.responses?.phone?.value ||
    booking.responses?.phoneNumber?.value ||
    booking.responses?.phone?.label ||
    booking.responses?.phoneNumber?.label ||
    booking.bookingFieldsResponses?.phone ||
    booking.bookingFieldsResponses?.phoneNumber;

  if (!phone && booking.attendees) {
    for (const attendee of booking.attendees) {
      phone = attendee.phone || attendee.phoneNumber || attendee.metadata?.phone;
      if (phone) break;
    }
  }

  if (!phone) {
    phone = booking.metadata?.phone;
  }

  if (!phone && booking.bookingFieldsResponses) {
    const responses = booking.bookingFieldsResponses;
    for (const [key, value] of Object.entries(responses)) {
      if (key.toLowerCase().includes('phone') || key.toLowerCase().includes('mobile')) {
        phone = value;
        break;
      }
    }
  }

  if (!phone) {
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

  const cleaned = String(phone).trim().replace(/\s+/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

async function processBookingConfirmation(booking) {
  console.log(`➡️ Processing booking confirmation for ${booking.id}`);

  if (!booking.start) {
    console.log("❌ No start date");
    return;
  }

  const dateParts = formatDatePartsArabic(booking.start);
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

  await sendBookingConfirmation(phone, name, dateParts.date, dateParts.time);
}

async function processReminder(booking, reminderType) {
  console.log(`➡️ Processing reminder for booking ${booking.id}`);

  if (!booking.start) {
    console.log("❌ No start date");
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

  const timeRemaining = reminderType === "1hour" ? "ساعة واحدة" : "خمس دقائق";

  await sendReminder(phone, name, timeRemaining);
}

async function fetchBookings() {
  try {
    console.log("🔍 Checking bookings for confirmations and reminders...");

    const res = await axios.get("https://api.cal.com/v2/bookings", {
      headers: {
        Authorization: `Bearer ${CAL_API_KEY}`,
        "cal-api-version": "2024-08-13"
      },
      params: {
        status: "upcoming",
        limit: 50
      }
    });

    const bookings = res.data.data || [];
    console.log(`📦 Fetched ${bookings.length} bookings`);

    const acceptedBookings = bookings.filter(
      booking => booking.status === "ACCEPTED" || booking.status === "accepted"
    );
    console.log(`✅ Found ${acceptedBookings.length} accepted bookings`);

    const now = new Date();
    const confirmationsToSend = [];
    const remindersToSend = [];

    for (const booking of acceptedBookings) {
      if (!booking.start) {
        continue;
      }

      const bookingStart = new Date(booking.start);
      if (isNaN(bookingStart.getTime())) {
        continue;
      }

      if (bookingStart < now) {
        continue;
      }

      const bookingCreated = booking.createdAt ? new Date(booking.createdAt) : null;
      const minutesSinceCreation = bookingCreated ? (now - bookingCreated) / 1000 / 60 : null;
      const isNewBooking = !sentConfirmations.has(booking.id) && 
        bookingCreated !== null && 
        minutesSinceCreation !== null &&
        minutesSinceCreation <= 1 && 
        minutesSinceCreation >= 0;

      if (isNewBooking) {
        confirmationsToSend.push(booking);
        sentConfirmations.add(booking.id);
      }

      const timeUntilBooking = (bookingStart - now) / 1000 / 60;
      
      const sentForBooking = sentReminders.get(booking.id) || new Set();

      if (timeUntilBooking <= 61 && timeUntilBooking >= 59 && !sentForBooking.has("1hour")) {
        remindersToSend.push({ booking, reminderType: "1hour", timeUntil: timeUntilBooking });
        sentForBooking.add("1hour");
        sentReminders.set(booking.id, sentForBooking);
      }
      
      if (timeUntilBooking <= 6 && timeUntilBooking >= 4 && !sentForBooking.has("5min")) {
        remindersToSend.push({ booking, reminderType: "5min", timeUntil: timeUntilBooking });
        sentForBooking.add("5min");
        sentReminders.set(booking.id, sentForBooking);
      }
    }

    console.log(`📧 Found ${confirmationsToSend.length} confirmations to send`);
    console.log(`🔔 Found ${remindersToSend.length} reminders to send`);

    for (const booking of confirmationsToSend) {
      console.log(`📨 Sending confirmation for booking ${booking.id}`);
      await processBookingConfirmation(booking);
    }

    for (const { booking, reminderType, timeUntil } of remindersToSend) {
      console.log(`⏰ Sending ${reminderType} reminder for booking ${booking.id} (${Math.round(timeUntil)} minutes until booking)`);
      await processReminder(booking, reminderType);
    }

    for (const [bookingId, sentSet] of sentReminders.entries()) {
      const booking = acceptedBookings.find(b => b.id === bookingId);
      if (booking && booking.start) {
        const bookingStart = new Date(booking.start);
        if (bookingStart < now) {
          sentReminders.delete(bookingId);
          sentConfirmations.delete(bookingId);
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
