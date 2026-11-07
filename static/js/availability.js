"use strict";
(() => {
  const form = document.getElementById("availabilityForm");
  if (!form) return;
  const list = document.getElementById("availabilityList");
  const feedback = document.getElementById("availabilityFeedback");
  const unavailableForm = document.getElementById("unavailableForm");
  const unavailableList = document.getElementById("unavailableList");
  const unavailableDate = document.getElementById("unavailableDate");
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const csrf = async () => (await fetch("/api/csrf-token")).json().then(data => data.csrf_token);
  async function load() {
    try {
      const data = await fetch("/api/availability").then(r => r.json());
      list.replaceChildren();
      if (!data.availability?.length) list.textContent = "No weekly availability yet. Add a window above.";
      (data.availability || []).forEach(row => {
        const item = document.createElement("div"); item.className = "availability-row";
        const label = document.createElement("span"); label.textContent = `${days[row.weekday]} Â· ${row.start_time}â€“${row.end_time}`;
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove";
        remove.addEventListener("click", async () => {
          const token = await csrf();
          const result = await fetch("/api/availability", {method:"DELETE", headers:{"Content-Type":"application/json", "X-CSRFToken":token}, body:JSON.stringify({id:row.id})}).then(r => r.json());
          if (result.ok) load(); else feedback.textContent = result.message || "Could not remove availability.";
        });
        item.append(label, remove); list.appendChild(item);
      });
    } catch (_) { list.textContent = "Could not load availability."; }
    try {
      const data = await fetch("/api/unavailable-dates").then(r => r.json());
      unavailableList.replaceChildren();
      (data.dates || []).forEach(row => {
        const item = document.createElement("div"); item.className = "availability-row";
        const label = document.createElement("span"); label.textContent = row.date;
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Restore availability";
        remove.addEventListener("click", async () => {
          const token = await csrf();
          const result = await fetch("/api/unavailable-dates", {method:"DELETE", headers:{"Content-Type":"application/json", "X-CSRFToken":token}, body:JSON.stringify({id:row.id})}).then(r => r.json());
          if (result.ok) load(); else feedback.textContent = result.message || "Could not restore date.";
        });
        item.append(label, remove); unavailableList.appendChild(item);
      });
      if (!data.dates?.length) { unavailableList.innerHTML = "<p style=\"color:var(--txt3,#8b8fa8);font-size:13px;margin-top:8px;\">No dates marked unavailable.</p>"; }
    } catch (_) { unavailableList.textContent = "Could not load unavailable dates."; }
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const payload = {weekday:document.getElementById("availabilityDay").value,
      start_time:document.getElementById("availabilityStart").value,
      end_time:document.getElementById("availabilityEnd").value};
    const token = await csrf();
    const response = await fetch("/api/availability", {method:"POST", headers:{"Content-Type":"application/json", "X-CSRFToken":token}, body:JSON.stringify(payload)});
    const data = await response.json(); feedback.textContent = data.message || (data.ok ? "Availability added." : "Could not save availability.");
    if (data.ok) { form.reset(); load(); }
  });
  const tomorrowPht = new Date(Date.now() + 8 * 3600000);
  tomorrowPht.setUTCDate(tomorrowPht.getUTCDate() + 1);
  unavailableDate.min = tomorrowPht.toISOString().slice(0,10);
  unavailableForm.addEventListener("submit", async event => {
    event.preventDefault();
    const token = await csrf();
    const result = await fetch("/api/unavailable-dates", {method:"POST", headers:{"Content-Type":"application/json", "X-CSRFToken":token}, body:JSON.stringify({date:unavailableDate.value})}).then(r => r.json());
    feedback.textContent = result.message || (result.ok ? "Date blocked." : "Could not block date.");
    if (result.ok) { unavailableForm.reset(); load(); }
  });
  load();
})();

