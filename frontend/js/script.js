/* Learn2Play — login page interactions
   Handles: log in / sign up tab switching, password visibility toggle,
   client-side validation, and a simulated submit flow (replace with a
   real fetch() to your auth endpoint). */

(function () {
  "use strict";

  var mode = "login";

  var form      = document.getElementById("form");
  var title     = document.getElementById("title");
  var subtitle  = document.getElementById("subtitle");
  var nameField = document.getElementById("nameField");
  var btnLabel  = document.getElementById("btnLabel");
  var submit    = document.getElementById("submit");
  var note      = document.getElementById("note");
  var pwd       = document.getElementById("password");
  var email     = document.getElementById("email");
  var eyeBtn    = document.getElementById("eyeBtn");
  var eyeOpen   = document.getElementById("eyeOpen");
  var eyeClosed = document.getElementById("eyeClosed");
  var forgot    = document.getElementById("forgot");
  var tabLogin  = document.getElementById("tabLogin");
  var tabSignup = document.getElementById("tabSignup");
  var switchLine = document.getElementById("switchLine");

  /* ---------- log in / sign up mode switching ---------- */
  function setMode(m) {
    mode = m;
    var login = m === "login";

    tabLogin.classList.toggle("active", login);
    tabSignup.classList.toggle("active", !login);
    tabLogin.setAttribute("aria-selected", login);
    tabSignup.setAttribute("aria-selected", !login);

    title.textContent    = login ? "Welcome back" : "Create your account";
    subtitle.textContent = login
      ? "Log in to pick up where you left off."
      : "Join 12k+ learners and start booking sessions.";

    nameField.classList.toggle("hidden", login);
    btnLabel.textContent = login ? "Log in" : "Create account";

    switchLine.innerHTML = login
      ? 'New to Learn2Play? <a id="switchLink">Get started</a>'
      : 'Already have an account? <a id="switchLink">Log in</a>';
    document
      .getElementById("switchLink")
      .addEventListener("click", function () {
        setMode(login ? "signup" : "login");
      });

    pwd.setAttribute("autocomplete", login ? "current-password" : "new-password");
    note.textContent = "";
  }

  tabLogin.addEventListener("click", function () { setMode("login"); });
  tabSignup.addEventListener("click", function () { setMode("signup"); });
  document.getElementById("switchLink")
    .addEventListener("click", function () { setMode("signup"); });

  /* ---------- password visibility toggle ---------- */
  eyeBtn.addEventListener("click", function () {
    var show = pwd.type === "password";
    pwd.type = show ? "text" : "password";
    eyeOpen.classList.toggle("hidden-svg", show);
    eyeClosed.classList.toggle("hidden-svg", !show);
  });

  /* ---------- validation + simulated submit ---------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    note.style.color = "#f87171";

    if (!email.value || email.value.indexOf("@") < 0) {
      note.textContent = "Please enter a valid email address.";
      return;
    }
    if (pwd.value.length < 6) {
      note.textContent = "Password must be at least 6 characters.";
      return;
    }

    submit.disabled = true;
    btnLabel.innerHTML =
      '<span class="spinner"></span>' +
      (mode === "login" ? "Signing in…" : "Creating account…");
    note.textContent = "";

    setTimeout(function () {
      btnLabel.innerHTML =
        '<svg class="check" viewBox="0 0 24 24"><path d="M4.5 12.5l5 5 10-11"/></svg>' +
        (mode === "login" ? "Welcome back!" : "Account created!");
      note.style.color = "#4ade80";
      note.textContent = "Redirecting to your dashboard…";

      setTimeout(function () {
        submit.disabled = false;
        btnLabel.textContent = mode === "login" ? "Log in" : "Create account";
        note.textContent = "";
        form.reset();
      }, 2200);
    }, 1000);
  });

  /* ---------- forgot password (demo) ---------- */
  forgot.addEventListener("click", function () {
    note.style.color = "#a99dff";
    note.textContent = "Password reset link sent — check your inbox (demo).";
  });
})();