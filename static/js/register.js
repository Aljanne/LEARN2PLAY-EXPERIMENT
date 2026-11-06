"use strict";

// Learn2Play: role-based registration page
(() => {
  const $ = (id) => document.getElementById(id);

  const MAX_FILES = 5;
  const MAX_BYTES = 5 * 1024 * 1024;
  const OK_EXT = ["pdf", "jpg", "jpeg", "png"];
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const VERIFIED_ROLES = ["mentor", "coach"];

  const form = $("regForm");
  const credsField = $("credsField");
  const proofs = $("proofs");
  let files = [];

  const getRoles = () =>
    [...form.querySelectorAll('input[name="roles"]:checked')].map((i) => i.value);
  const needsCreds = () => getRoles().some((r) => VERIFIED_ROLES.includes(r));

  // ---------- errors ----------
  function setError(field, message) {
    const slot = form.querySelector(`.field-error[data-for="${field}"]`);
    if (slot) {
      slot.textContent = message || "";
      const wrap = slot.closest(".r-field");
      if (wrap) wrap.classList.toggle("invalid", Boolean(message));
    }
  }
  function clearErrors() {
    form.querySelectorAll(".field-error").forEach((e) => (e.textContent = ""));
    form.querySelectorAll(".invalid").forEach((e) => e.classList.remove("invalid"));
    $("note").textContent = "";
  }
  function showNote(message) {
    $("note").textContent = message;
    $("note").style.color = "var(--danger)";
  }

  function setupPasswordToggle(inputId, buttonId, label) {
    const input = $(inputId);
    const button = $(buttonId);

    button.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.querySelector(".r-eye-open").classList.toggle("hidden-svg", show);
      button.querySelector(".r-eye-closed").classList.toggle("hidden-svg", !show);
      button.setAttribute("aria-label", `${show ? "Hide" : "Show"} ${label}`);
      button.setAttribute("aria-pressed", String(show));
    });
  }

  setupPasswordToggle("password", "passwordToggle", "password");
  setupPasswordToggle("confirmPassword", "confirmPasswordToggle", "password confirmation");

  // ---------- role toggling ----------
  function syncRoles() {
    const show = needsCreds();
    credsField.classList.toggle("hidden", !show);
    $("reviewNo").textContent = show ? "4" : "3";
  }
  $("rolesField").addEventListener("change", () => {
    setError("roles", "");
    syncRoles();
  });

  // ---------- password strength ----------
  function strength(pw) {
    let s = 0;
    if (pw.length >= 8) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 12) s++;
    return s;
  }
  $("password").addEventListener("input", (e) => {
    const lvl = e.target.value ? strength(e.target.value) : 0;
    form.querySelector(".strength").dataset.level = lvl;
    $("strengthText").textContent =
      ["Use upper and lower case letters and a number.", "Weak", "Fair", "Good", "Strong"][lvl];
  });

  // ---------- bio counter ----------
  $("bio").addEventListener("input", (e) => ($("bioCount").textContent = e.target.value.length));

  // ---------- files ----------
  const ext = (name) => name.split(".").pop().toLowerCase();
  const size = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.ceil(b / 1024) + " KB");

  function addFiles(list) {
    setError("proofs", "");
    for (const f of list) {
      if (files.length >= MAX_FILES) {
        setError("proofs", `You can upload up to ${MAX_FILES} files.`);
        break;
      }
      if (!OK_EXT.includes(ext(f.name))) {
        setError("proofs", `"${f.name}" isn't supported. Use PDF, JPG or PNG.`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        setError("proofs", `"${f.name}" is over 5 MB. Choose a smaller file.`);
        continue;
      }
      if (!files.some((x) => x.name === f.name && x.size === f.size)) files.push(f);
    }
    renderFiles();
  }
  function renderFiles() {
    const ul = $("fileList");
    ul.innerHTML = "";
    files.forEach((f, i) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = f.name;
      const small = document.createElement("small");
      small.textContent = size(f.size);
      const rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = "Remove";
      rm.setAttribute("aria-label", "Remove " + f.name);
      rm.addEventListener("click", () => {
        files.splice(i, 1);
        renderFiles();
      });
      const right = document.createElement("div");
      right.append(small, rm);
      li.append(name, right);
      ul.append(li);
    });
  }
  proofs.addEventListener("change", () => {
    addFiles([...proofs.files]);
    proofs.value = "";
  });
  const dz = $("dropzone");
  ["dragenter", "dragover"].forEach((t) =>
    dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add("drag"); })
  );
  ["dragleave", "drop"].forEach((t) =>
    dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove("drag"); })
  );
  dz.addEventListener("drop", (e) => addFiles([...e.dataTransfer.files]));

  // ---------- validation ----------
  function parseLinks() {
    return $("links").value.split("\n").map((l) => l.trim()).filter(Boolean);
  }
  function validate() {
    const errs = {};
    const name = $("name").value.trim();
    const pw = $("password").value;

    if (getRoles().length === 0) errs.roles = "Choose at least one role.";
    if (name.length < 2 || name.length > 80) errs.name = "Enter your full name (2 to 80 characters).";
    if (!EMAIL_RE.test($("email").value.trim())) errs.email = "Enter a valid email address.";
    if (pw.length < 8 || !/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw))
      errs.password = "Use at least 8 characters, with upper and lower case letters and a number.";
    if (pw !== $("confirmPassword").value) errs.confirmPassword = "Passwords don't match.";

    if (needsCreds()) {
      if (files.length === 0) errs.proofs = "Upload at least one certificate, license, diploma or award.";
      if ($("bio").value.trim().length < 50) errs.bio = "Describe your experience in at least 50 characters.";
      const links = parseLinks();
      if (links.length > 5) errs.links = "Add up to 5 links.";
      else if (links.some((l) => !/^https?:\/\/\S+\.\S+$/i.test(l)))
        errs.links = "Each link must start with http:// or https://";
    }
    if (!$("ack").checked) errs.ack = "Confirm that you understand the review before you continue.";
    return errs;
  }

  // ---------- submit ----------
  
  async function csrf() {
    const r = await fetch("/api/csrf-token", { credentials: "same-origin", headers: { Accept: "application/json" } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.csrf_token) throw new Error("Couldn't start a secure request. Reload the page and try again.");
    return d.csrf_token;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearErrors();

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      Object.entries(errors).forEach(([field, message]) => setError(field, message));
      return;
    }

    const body = new FormData();
    getRoles().forEach((r) => body.append("roles", r));
    body.append("name", $("name").value.trim());
    body.append("email", $("email").value.trim());
    body.append("password", $("password").value);
    body.append("confirm_password", $("confirmPassword").value);
    if ($("ack").checked) body.append("acknowledged", "true");
    if (needsCreds()) {
      body.append("bio", $("bio").value.trim());
      parseLinks().forEach((l) => body.append("links", l));
      files.forEach((f) => body.append("proofs", f, f.name));
    }

    $("submit").disabled = true;
    $("btnLabel").textContent = needsCreds() ? "Submitting for review…" : "Creating account…";

    try {
      const token = await csrf();
      const res = await fetch("/api/auth/register", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "X-CSRFToken": token }, // no Content-Type: browser sets the boundary
        body,
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        if (data.field && form.querySelector(`.field-error[data-for="${data.field}"]`)) {
          setError(data.field, data.message);
        } else {
          showNote(data.message || `Registration failed (${res.status}). Please try again.`);
        }
        return;
      }
      showDone(data);
    } catch (err) {
      showNote(err.message || "Something went wrong. Please try again.");
    } finally {
      $("submit").disabled = false;
      $("btnLabel").textContent = "Create account";
    }
  });

  function showDone(data) {
    if (data.user) {
      try { localStorage.setItem("l2_user", JSON.stringify(data.user)); } catch (e) { /* session still works */ }
    }
    form.classList.add("hidden");
    const done = $("done");
    done.classList.remove("hidden");
    $("doneTitle").textContent = data.pending ? "Registration received" : "You're all set";
    $("doneText").textContent = data.message;
    const link = $("doneLink");
    link.href = data.redirect || "/login";
    link.textContent = data.redirect === "/dashboard" ? "Go to dashboard" : "Back to log in";
    done.focus();
  }

  syncRoles();
})();