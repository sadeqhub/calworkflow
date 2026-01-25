require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const dayjs = require("dayjs");
const fs = require("fs");

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const CAL_API_KEY = process.env.CAL_API_KEY;
const ORG_ID = process.env.ORG_ID;
const OTPIQ_API_KEY = process.env.OTPIQ_API_KEY;
const OTPIQ_SENDER_ID = process.env.OTPIQ_SENDER_ID;

// Store sent reminders to avoid duplicates
const SENT_FILE = "sentReminders.json";
let sentReminders = {};
if (fs.existsSync(SENT_FILE)) {
  sentReminders = JSON.parse(fs.readFileSync(SENT_FILE));
}

// ---------------- WhatsApp helper ----------------
async function sendWhatsApp({ phone, templateName, params }) {
  try {
    await axios.post(
      "https://api.otpiq.com/v1/messages",
      {
        sender: OTPIQ_SENDER_ID,
        recipient: phone,
        template: templateName,
        params,
      },
      {
        headers: { Authorization: `Bearer ${OTPIQ_API_KEY}` },
      }
    );
    console.log(`WhatsApp sent to ${phone} using template ${templateName}`);
  } catch (err) {
    console.error("WhatsApp error:", err.response?.data || err.message);
  }
}

// ---------------- Scheduler ----------------
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
    const now = dayjs();

    for (const booking of bookings) {
      const start = dayjs(booking.start);
      const diffMinutes = start.diff(now, "minute");

      const attendee = booking.attendees?.[0];
      if (!attendee?.phoneNumber) continue;

      const phone = attendee.phoneNumber;
      const name = attendee.name || "Guest";
      const date = start.format("YYYY-MM-DD");
      const time = start.format("HH:mm");

      // Reminder: 1 hour
      if (diffMinutes === 60 && !sentReminders[booking.uid + "_1h"]) {
        await sendWhatsApp({
          phone,
          templateName: "democall_reminder_ar",
          params: [name, "one hour", `http://meet.google.com/${booking.meetingUrl || booking.uid}`],
        });
        sentReminders[booking.uid + "_1h"] = true;
      }

      // Reminder: 5 minutes
      if (diffMinutes === 5 && !sentReminders[booking.uid + "_5m"]) {
        await sendWhatsApp({
          phone,
          templateName: "democall_reminder_ar",
          params: [name, "five minutes", `http://meet.google.com/${booking.meetingUrl || booking.uid}`],
        });
        sentReminders[booking.uid + "_5m"] = true;
      }
    }

    fs.writeFileSync(SENT_FILE, JSON.stringify(sentReminders));
  } catch (err) {
    console.error("Error in checkBookings:", err.response?.data || err.message);
  }
}

// Run scheduler every minute
setInterval(checkBookings, 60 * 1000);

// ---------------- Webhook ----------------
app.post("/cal-webhook", async (req, res) => {
  console.log("Webhook received:", JSON.stringify(req.body, null, 2));

  try {
    const booking = req.body.payload || req.body; // Support test payload and real payload

    const attendee = booking.attendees?.[0];
    if (!attendee) {
      console.log("No attendees in payload, skipping WhatsApp");
      return res.status(200).send("OK");
    }

    const phone = attendee.phoneNumber || null; // may be missing in test
    const name = attendee.name || "Guest";

    const startTime = booking.start || booking.startTime || new Date().toISOString();
    const start = dayjs(startTime);
    const date = start.format("YYYY-MM-DD");
    const time = start.format("HH:mm");

    if (!phone) {
      console.log(`No phone number for ${name}, cannot send WhatsApp. Booking at ${date} ${time}`);
    } else {
      await sendWhatsApp({
        phone,
        templateName: "democall_booking_ar",
        params: [name, date, time],
      });
      console.log(`WhatsApp sent to ${name} at ${date} ${time}`);
    }

    res.status(200).send("OK"); // Always respond 200 to Cal.com
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).send("Error");
  }
});

// ---------------- Start server ----------------
app.listen(PORT, () => {
  console.log(`Webhook server listening on port ${PORT}`);
});
