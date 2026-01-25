const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const dayjs = require("dayjs");
const fs = require("fs");
require("dotenv").config();

const CAL_API_KEY = process.env.CAL_API_KEY;
const ORG_ID = process.env.ORG_ID;
const OTPIQ_API_KEY = process.env.OTPIQ_API_KEY;
const OTPIQ_SENDER_ID = process.env.OTPIQ_SENDER_ID;

// ===== Persistent store to prevent duplicate reminders =====
const STORE_FILE = "sentReminders.json";
let sentReminders = {};
try {
  sentReminders = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
} catch {
  sentReminders = {};
}

function saveStore() {
  fs.writeFileSync(STORE_FILE, JSON.stringify(sentReminders, null, 2));
}

// ===== Helpers =====
function getMeetingId(url) {
  if (!url) return null;
  const parts = url.split("/");
  return parts[parts.length - 1];
}

function minutesDiff(dateStr) {
  const meeting = dayjs(dateStr);
  const now = dayjs();
  return meeting.diff(now, "minute");
}

// ===== Send WhatsApp =====
async function sendWhatsApp({ phone, templateName, params }) {
  try {
    await axios.post(
      "https://api.otpiq.com/whatsapp/template/send",
      {
        sender_id: OTPIQ_SENDER_ID,
        recipient: phone,
        template_name: templateName,
        language: "ar",
        parameters: params,
      },
      {
        headers: {
          Authorization: `Bearer ${OTPIQ_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`Sent WhatsApp ${templateName} to ${phone}`);
  } catch (err) {
    console.error("WhatsApp send error:", err.response?.data || err.message);
  }
}

// ===== Scheduler for 1h / 5min reminders =====
async function checkBookings() {
  try {
    const res = await axios.get(
      `https://api.cal.com/v2/organizations/${ORG_ID}/bookings`,
      {
        headers: { Authorization: `Bearer ${CAL_API_KEY}` },
        params: { status: "upcoming", take: 100 },
      }
    );

    const bookings = res.data.data || [];

    for (const booking of bookings) {
      if (!booking.start || !booking.attendees?.length) continue;

      const diff = minutesDiff(booking.start);
      let reminderType = null;
      let timeText = null;

      if (diff >= 59 && diff <= 61) {
        reminderType = "1h";
        timeText = "بعد ساعة";
      } else if (diff >= 4 && diff <= 6) {
        reminderType = "5m";
        timeText = "بعد خمس دقائق";
      }

      if (!reminderType) continue;

      const meetingUrl = booking.location || booking.meetingUrl;
      const meetingId = getMeetingId(meetingUrl);
      if (!meetingId) continue;

      for (const attendee of booking.attendees) {
        if (!attendee.phoneNumber) continue;

        const key = `${booking.uid}_${attendee.phoneNumber}_${reminderType}`;
        if (sentReminders[key]) continue;

        await sendWhatsApp({
          phone: attendee.phoneNumber,
          templateName: "democall_reminder_ar",
          params: [attendee.name || "Guest", timeText, `http://meet.google.com/${meetingId}`],
        });

        sentReminders[key] = Date.now();
        saveStore();
      }
    }
  } catch (err) {
    console.error("Error in checkBookings:", err.message);
  }
}

// ===== Express webhook server =====
const app = express();
app.use(bodyParser.json());

app.post("/cal-webhook", async (req, res) => {
  try {
    const booking = req.body;

    // Cal sends booking info in JSON
    const attendee = booking.attendees?.[0]; // assume first attendee
    if (!attendee?.phoneNumber) {
      return res.status(400).send("No attendee phone");
    }

    const name = attendee.name || "Guest";
    const start = dayjs(booking.start);
    const date = start.format("YYYY-MM-DD");
    const time = start.format("HH:mm");

    await sendWhatsApp({
      phone: attendee.phoneNumber,
      templateName: "democall_booking_ar",
      params: [name, date, time],
    });

    console.log(`Booking confirmed for ${name} at ${date} ${time}`);
    res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook error:", err.message);
    res.status(500).send("Error");
  }
});

// ===== Start server + scheduler =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});

// Run scheduler every minute
checkBookings();
setInterval(checkBookings, 60 * 1000);
