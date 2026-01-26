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
  PORT = 3000,
  NEW_BOOKING_WINDOW_MINUTES = 10
} = process.env;

if (!CAL_API_KEY || !OTPIQ_API_KEY || !OTPIQ_ACCOUNT_ID || !OTPIQ_PHONE_ID) {
  console.error("❌ Missing ENV variables");
  process.exit(1);
}

const processedBookings = new Set();
const bookingStatusHistory = new Map(); // Track booking status changes: bookingId -> { lastStatus, lastChecked }
const serviceStartTime = new Date();

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

    // Only process bookings created in the last N minutes (newly created)
    const now = new Date();
    const windowMinutes = parseInt(NEW_BOOKING_WINDOW_MINUTES, 10) || 10;
    const timeWindowAgo = new Date(now.getTime() - windowMinutes * 60 * 1000);
    
    // Debug: Log first booking structure to understand available fields
    if (acceptedBookings.length > 0 && !processedBookings.has(acceptedBookings[0].id)) {
      const sampleBooking = acceptedBookings[0];
      console.log(`🔍 Sample booking fields:`, JSON.stringify({
        id: sampleBooking.id,
        status: sampleBooking.status,
        createdAt: sampleBooking.createdAt,
        created_at: sampleBooking.created_at,
        created: sampleBooking.created,
        updatedAt: sampleBooking.updatedAt,
        allKeys: Object.keys(sampleBooking).slice(0, 20) // First 20 keys
      }, null, 2));
    }
    
    const newBookings = acceptedBookings.filter(booking => {
      // Skip if already processed
      if (processedBookings.has(booking.id)) {
        return false;
      }
      
      // Check if this booking just transitioned to "accepted" status
      const previousStatus = bookingStatusHistory.get(booking.id);
      const currentStatus = booking.status?.toLowerCase();
      const isNewlyAccepted = !previousStatus || (previousStatus.lastStatus !== "accepted" && currentStatus === "accepted");
      
      // Update status history
      bookingStatusHistory.set(booking.id, {
        lastStatus: currentStatus,
        lastChecked: now
      });
      
      // Check both creation time and update time
      const createdAtStr = booking.createdAt || booking.created_at || booking.created;
      const updatedAtStr = booking.updatedAt || booking.updated_at;
      
      const createdAt = createdAtStr ? new Date(createdAtStr) : null;
      const updatedAt = updatedAtStr ? new Date(updatedAtStr) : null;
      
      // Use the most recent timestamp (creation or update)
      let relevantTime = createdAt;
      if (updatedAt && (!createdAt || updatedAt > createdAt)) {
        relevantTime = updatedAt;
      }
      
      if (!relevantTime || isNaN(relevantTime.getTime())) {
        // If no timestamp but status just changed to accepted, process it
        if (isNewlyAccepted) {
          console.log(`✅ Booking ${booking.id} just transitioned to accepted status (no timestamp available)`);
          return true;
        }
        console.log(`⏭️  Skipping booking ${booking.id} - no valid timestamp. Available fields:`, Object.keys(booking).join(', '));
        return false;
      }
      
      // Process if:
      // 1. Status just changed to accepted, OR
      // 2. Booking was created/updated in the last N minutes
      const minutesAgo = Math.round((now - relevantTime) / 1000 / 60);
      const isRecent = isNewlyAccepted || relevantTime >= timeWindowAgo;
      
      if (!isRecent) {
        console.log(`⏭️  Skipping booking ${booking.id} - ${createdAt && updatedAt && updatedAt > createdAt ? 'updated' : 'created'} ${minutesAgo} minutes ago (threshold: ${windowMinutes} minutes)`);
      } else {
        const reason = isNewlyAccepted ? "just transitioned to accepted" : `${createdAt && updatedAt && updatedAt > createdAt ? 'updated' : 'created'} ${minutesAgo} minutes ago`;
        console.log(`✅ Booking ${booking.id} is new (${reason})`);
      }
      return isRecent;
    });

    console.log(`🆕 Found ${newBookings.length} newly created bookings (last ${windowMinutes} minutes)`);

    for (const booking of newBookings) {
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
