"use strict";

// Learn2Play: login only. Registration lives on /register (register.js).
(() => {
  const $ = (id) => document.getElementById(id);

  const form = $("form");
  const email = $("email");
  const password = $("password");
  const submit = $("submit");
  const btnLabel = $("btnLabel");
  const note = $("note");
  const eyeBtn = $("eyeBtn");
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // ---------- helpers ----------
  async function getCsrfToken() {
    const response = await fetch("/api/csrf-token", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.csrf_token) {
      throw new Error("Unable to start a secure request. Please reload the page.");
    }
    return data.csrf_token;
  }

  async function apiPost(url, payload) {
    const csrfToken = await getCsrfToken();
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-CSRFToken": csrfToken,
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.message || `Request failed (${response.status}). Please try again.`);
    }
    return data;
  }

  function showNote(message, type = "error") {
    note.textContent = message;
    note.style.color = type === "error" ? "var(--danger)" : "var(--green)";
  }
  const clearNote = () => (note.textContent = "");

  // ---------- password visibility ----------
  eyeBtn.addEventListener("click", () => {
    const show = password.type === "password";
    password.type = show ? "text" : "password";
    $("eyeOpen").classList.toggle("hidden-svg", show);
    $("eyeClosed").classList.toggle("hidden-svg", !show);
    eyeBtn.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });

  // ---------- submit ----------
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearNote();

    if (!EMAIL_RE.test(email.value.trim())) return showNote("Please enter a valid email address.");
    if (!password.value) return showNote("Please enter your password.");

    submit.disabled = true;
    btnLabel.textContent = "Logging in…";

    try {
      const result = await apiPost("/api/auth/login", {
        email: email.value.trim(),
        password: password.value,
        remember: $("remember").checked,
      });

      if (result.user) {
        try {
          localStorage.setItem("l2_user", JSON.stringify(result.user));
        } catch (e) {
          // The Flask session still works if localStorage is unavailable.
        }
      }
      showNote("Logged in successfully!", "success");
      window.location.assign("/dashboard");
    } catch (error) {
      showNote(error.message || "Something went wrong. Please try again.");
      submit.disabled = false;
      btnLabel.textContent = "Log in";
    }
  });

  $("forgot").addEventListener("click", (event) => {
    event.preventDefault();
    showNote("Password reset isn't available yet.");
  });
})();