"use strict";
(() => {
  const overlay = document.getElementById("bookingOverlay");
  if (!overlay) return;
  const dateInput = document.getElementById("bookingDate");
  const timeSelect = document.getElementById("bookingTime");
  const feedback = document.getElementById("bookingFeedback");
  const localDate = new Date(Date.now() + 8 * 3600000);
  const asDate = d => d.toISOString().slice(0, 10);
  dateInput.min = asDate(localDate);
  const lastDate = new Date(localDate); lastDate.setUTCDate(lastDate.getUTCDate() + 60);
  dateInput.max = asDate(lastDate);
  document.getElementById("openBooking").addEventListener("click", () => { overlay.hidden = false; dateInput.focus(); });
  document.getElementById("closeBooking").addEventListener("click", () => { overlay.hidden = true; });
  overlay.addEventListener("click", event => { if (event.target === overlay) overlay.hidden = true; });
  dateInput.addEventListener("change", async () => {
    timeSelect.innerHTML = '<option value="">Loading available times…</option>';
    try {
      const res = await fetch(`/api/tutors/${window.L2TutorId}/availability?date=${encodeURIComponent(dateInput.value)}`);
      const data = await res.json();
      timeSelect.innerHTML = '<option value="">Select a time</option>';
      (data.slots || []).forEach(slot => {
        const option = document.createElement("option"); option.value = slot;
        const [h, m] = slot.split(":").map(Number);
        option.textContent = new Date(2000, 0, 1, h, m).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
        timeSelect.appendChild(option);
      });
      if (!data.slots?.length) timeSelect.innerHTML = '<option value="">No times available on this date</option>';
    } catch (_) { timeSelect.innerHTML = '<option value="">Could not load times</option>'; }
  });
  document.getElementById("submitBooking").addEventListener("click", async event => {
    const button = event.currentTarget;
    const payload = {mentor_id: window.L2TutorId, date: dateInput.value, time: timeSelect.value,
      topic: document.getElementById("bookingTopic").value.trim(), message: document.getElementById("bookingMessage").value.trim()};
    if (!payload.date || !payload.time || !payload.topic) { feedback.textContent = "Choose a date, time, and topic."; return; }
    button.disabled = true; feedback.textContent = "Sending request…";
    try {
      const token = await fetch("/api/csrf-token").then(r => r.json());
      const res = await fetch("/api/bookings", {method:"POST", credentials:"same-origin",
        headers:{"Content-Type":"application/json", "X-CSRFToken":token.csrf_token}, body:JSON.stringify(payload)});
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.message || "Could not send booking request.");
      feedback.textContent = "Request sent. You can track its status in My Sessions.";
      setTimeout(() => { window.location.href = "/sessions"; }, 1000);
    } catch (error) { feedback.textContent = error.message; button.disabled = false; }
  });
})();
