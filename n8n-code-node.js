const OTPIQ_SMS_URL = "https://api.otpiq.com/api/sms";
const OTPIQ_API_KEY = "YOUR_OTPIQ_API_KEY";
const OTPIQ_ACCOUNT_ID = "YOUR_OTPIQ_ACCOUNT_ID";
const OTPIQ_PHONE_ID = "YOUR_OTPIQ_PHONE_ID";

const SEND_BOOKING_CONFIRMATIONS = true;
const SEND_REMINDERS = true;

const staticData = $getWorkflowStaticData("global");
if (!staticData.sentReminders) staticData.sentReminders = {};
if (!staticData.sentConfirmations) staticData.sentConfirmations = {};

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
  return {
    date: dateFormatter.format(d),
    time: timeFormatter.format(d)
  };
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
  if (!phone) phone = booking.metadata?.phone;
  if (!phone && booking.bookingFieldsResponses) {
    for (const [key, value] of Object.entries(booking.bookingFieldsResponses)) {
      if (key.toLowerCase().includes("phone") || key.toLowerCase().includes("mobile")) {
        phone = value;
        break;
      }
    }
  }
  if (!phone) return null;
  const cleaned = String(phone).trim().replace(/\s+/g, "");
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

function toOtpiqPhone(phone) {
  const digits = String(phone).replace(/\D/g, "");
  return digits.length >= 9 ? digits : "";
}

const inputItem = $input.first();
const calResponse = inputItem && inputItem.json ? inputItem.json : {};
const rawBookings = calResponse.data ?? calResponse.bookings ?? (Array.isArray(calResponse) ? calResponse : []);
const bookings = Array.isArray(rawBookings) ? rawBookings : [];
const acceptedBookings = bookings.filter(
  (b) => b && (b.status === "ACCEPTED" || b.status === "accepted")
);

const now = new Date();
const confirmationsToSend = [];
const remindersToSend = [];

for (const booking of acceptedBookings) {
  if (!booking.start) continue;
  const bookingStart = new Date(booking.start);
  if (isNaN(bookingStart.getTime()) || bookingStart < now) continue;

  const bookingCreated = booking.createdAt ? new Date(booking.createdAt) : null;
  const minutesSinceCreation = bookingCreated
    ? (now - bookingCreated) / 1000 / 60
    : null;
  const isNewBooking =
    !staticData.sentConfirmations[booking.id] &&
    bookingCreated !== null &&
    minutesSinceCreation !== null &&
    minutesSinceCreation <= 2 &&
    minutesSinceCreation >= 0;

  if (isNewBooking) {
    confirmationsToSend.push(booking);
    staticData.sentConfirmations[booking.id] = true;
  }

  const timeUntilBooking = (bookingStart - now) / 1000 / 60;
  const sentForBooking = staticData.sentReminders[booking.id] || [];

  if (
    timeUntilBooking <= 61 &&
    timeUntilBooking >= 59 &&
    !sentForBooking.includes("1hour")
  ) {
    remindersToSend.push({ booking, reminderType: "1hour", timeUntil: timeUntilBooking });
    staticData.sentReminders[booking.id] = [...sentForBooking, "1hour"];
  }
  if (
    timeUntilBooking <= 6 &&
    timeUntilBooking >= 4 &&
    !sentForBooking.includes("5min")
  ) {
    remindersToSend.push({ booking, reminderType: "5min", timeUntil: timeUntilBooking });
    staticData.sentReminders[booking.id] = [...(staticData.sentReminders[booking.id] || []), "5min"];
  }
}

const itemsToSend = [];
const sentForBookingPhone = new Set();

function alreadySentFor(bookingId, phoneNumber) {
  const key = `${bookingId}|${phoneNumber}`;
  if (sentForBookingPhone.has(key)) return true;
  sentForBookingPhone.add(key);
  return false;
}

if (SEND_BOOKING_CONFIRMATIONS) {
  for (const booking of confirmationsToSend) {
    if (!booking.start) continue;
    const dateParts = formatDatePartsArabic(booking.start);
    if (!dateParts) continue;
    const phone = extractPhone(booking);
    if (!phone) continue;
    const name =
      booking.attendees?.[0]?.name ||
    booking.bookingFieldsResponses?.name ||
    "Guest";
    const phoneNumber = toOtpiqPhone(phone);
    if (!phoneNumber) continue;
    if (alreadySentFor(booking.id, phoneNumber)) continue;
    itemsToSend.push({
      json: {
        messageType: "booking_confirmation",
        templateName: "democall_booking_arabic",
        phoneNumber,
        smsType: "whatsapp-template",
        provider: "whatsapp",
        whatsappAccountId: OTPIQ_ACCOUNT_ID,
        whatsappPhoneId: OTPIQ_PHONE_ID,
        templateParameters: {
          body: { "1": name, "2": dateParts.date, "3": dateParts.time }
        }
      }
    });
  }
}

if (SEND_REMINDERS) {
  for (const { booking, reminderType } of remindersToSend) {
  if (!booking.start) continue;
  const phone = extractPhone(booking);
  if (!phone) continue;
  const name =
    booking.attendees?.[0]?.name ||
    booking.bookingFieldsResponses?.name ||
    "Guest";
  const timeRemaining = reminderType === "1hour" ? "ساعة واحدة" : "خمس دقائق";
  const phoneNumber = toOtpiqPhone(phone);
  if (!phoneNumber) continue;
  if (alreadySentFor(booking.id, phoneNumber)) continue;
  itemsToSend.push({
    json: {
      messageType: reminderType === "1hour" ? "reminder_1hour" : "reminder_5min",
      phoneNumber,
      smsType: "whatsapp-template",
      provider: "whatsapp",
      templateName: "democall_reminder_arabic",
      whatsappAccountId: OTPIQ_ACCOUNT_ID,
      whatsappPhoneId: OTPIQ_PHONE_ID,
      templateParameters: {
        body: { "1": name, "2": timeRemaining }
      }
    }
  });
  }
}

for (const bookingId of Object.keys(staticData.sentReminders)) {
  const booking = acceptedBookings.find((b) => b.id === bookingId);
  if (booking && booking.start && new Date(booking.start) < now) {
    delete staticData.sentReminders[bookingId];
    delete staticData.sentConfirmations[bookingId];
  }
}

if (itemsToSend.length === 0) {
  return [];
}

const results = [];
const canFetch = typeof fetch === "function";

for (const item of itemsToSend) {
  const body = { ...item.json };
  delete body.messageType;
  if (canFetch) {
    try {
      const res = await fetch(OTPIQ_SMS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OTPIQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      results.push({ messageType: item.json.messageType, ok: res.ok, status: res.status, data });
    } catch (e) {
      results.push({ messageType: item.json.messageType, error: String(e.message || e) });
    }
  } else {
    results.push({ messageType: item.json.messageType, skipped: true, reason: "fetch not available" });
  }
}

if (canFetch) {
  return [{ json: { sent: itemsToSend.length, results } }];
}

return itemsToSend;

