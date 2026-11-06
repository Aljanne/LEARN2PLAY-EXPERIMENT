"use strict";

(function setupSessionManager() {
    const studentView = document.getElementById("studentSessionsView");
    const mentorView = document.getElementById("mentorSessionsView");
    const sessionList = document.getElementById("sessionList");
    const emptyBox = document.getElementById("sessionsEmpty");
    const tabs = document.querySelectorAll(".session-tab");

    // 1. Role-based view switching (Student vs Mentor/Coach workspace)
    function setRoleView(mode) {
        const isMentor = mode === "mentor" || mode === "coach";
        if (studentView) studentView.classList.toggle("hidden", isMentor);
        if (mentorView) mentorView.classList.toggle("hidden", !isMentor);
    }

    const initialMode = window.L2?.getMode?.() || "student";
    setRoleView(initialMode);

    fetch("/api/me", { credentials: "same-origin", headers: { Accept: "application/json" } })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
            if (!data?.user) return;
            const roles = data.user.roles || [];
            const mode = roles.includes(initialMode)
                ? initialMode
                : (roles.includes("mentor") ? "mentor" : (roles.includes("coach") ? "coach" : "student"));
            setRoleView(mode);
        })
        .catch(() => setRoleView(initialMode));

    // 2. Tab switching between Upcoming & Past sessions
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const status = tab.dataset.status;

            tabs.forEach(item => {
                const isActive = item === tab;
                item.classList.toggle("active", isActive);
                item.setAttribute("aria-selected", String(isActive));
            });

            filterSessions(status);
        });
    });

    function filterSessions(status) {
        const sessions = sessionList ? sessionList.querySelectorAll(".scheduled-session") : [];
        let visibleCount = 0;

        sessions.forEach(card => {
            const match = card.dataset.status === status;
            card.style.display = match ? "grid" : "none";
            if (match) visibleCount++;
        });

        // Show empty message if no sessions match
        if (emptyBox) {
            emptyBox.style.display = visibleCount === 0 ? "flex" : "none";
        }
    }

    // Initial filter check
    filterSessions("upcoming");

    // 3. Dropdown Menu & Logout
    const menu = document.getElementById("profileMenu");
    const avatar = document.getElementById("userAvatar");
    const dropdown = document.getElementById("profileDropdown");
    const logoutBtn = document.getElementById("logoutBtn");

    if (avatar && dropdown) {
        avatar.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = !dropdown.classList.contains("hidden");
            dropdown.classList.toggle("hidden", isOpen);
            avatar.setAttribute("aria-expanded", String(!isOpen));
        });

        document.addEventListener("click", (e) => {
            if (menu && !menu.contains(e.target)) {
                dropdown.classList.add("hidden");
                avatar.setAttribute("aria-expanded", "false");
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            try {
                const tokenResp = await fetch("/api/csrf-token", { credentials: "same-origin" });
                const tokenData = await tokenResp.json();

                await fetch("/api/auth/logout", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        "X-CSRFToken": tokenData.csrf_token || "",
                        Accept: "application/json"
                    }
                });
                window.location.href = "/auth";
            } catch (err) {
                window.location.href = "/auth";
            }
        });
    }

    const escapeHtml = value => String(value || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    async function loadBookings() {
        try {
            const data = await fetch("/api/bookings", {credentials:"same-origin"}).then(r => r.json());
            if (!data.ok) throw new Error(data.message || "Could not load bookings.");
            const bookings = data.bookings || [];
            if (sessionList) {
                const mine = bookings.filter(b => b.student_id === window.L2UserId);
                const meaningful = mine.filter(b => ["pending", "accepted", "scheduled", "completed", "cancelled", "rejected"].includes(b.status));
                sessionList.innerHTML = meaningful.map(b => `<article class="scheduled-session" data-status="${["completed","cancelled","rejected"].includes(b.status) ? "completed" : "upcoming"}"><div class="session-details"><div class="session-title-row"><h3>${escapeHtml(b.topic)}</h3><span class="session-status">${escapeHtml(b.status)}</span></div><p>${escapeHtml(b.mentor)} · ${escapeHtml(b.formatted)}</p>${b.notes ? `<p>${escapeHtml(b.notes)}</p>` : ""}</div><div class="session-actions-buttons">${b.status === "accepted" || b.status === "scheduled" ? `<button class="session-action join-session" data-id="${b.id}">Join Session</button>` : ""}${["pending","accepted","scheduled"].includes(b.status) ? `<button class="session-action cancel-booking" data-id="${b.id}">Cancel</button>` : ""}</div></article>`).join("");
                filterSessions(document.querySelector(".session-tab.active")?.dataset.status || "upcoming");
                const upcoming = meaningful.filter(b => ["pending","accepted","scheduled"].includes(b.status)).length;
                const completed = meaningful.filter(b => b.status === "completed").length;
                document.getElementById("upcomingCount")?.replaceChildren(String(upcoming));
                document.getElementById("completedCount")?.replaceChildren(String(completed));
            }
            const requests = bookings.filter(b => b.provider_id === window.L2UserId && b.status === "pending");
            const upcoming = bookings.filter(b => b.provider_id === window.L2UserId && ["accepted","scheduled"].includes(b.status));
            const requestList = document.getElementById("mentorRequestList");
            const upcomingList = document.getElementById("mentorUpcomingList");
            if (requestList) requestList.innerHTML = requests.length ? requests.map(b => `<article class="mentor-request-card"><div class="mentor-request-details"><h3>${escapeHtml(b.student)} · ${escapeHtml(b.topic)}</h3><p>${escapeHtml(b.formatted)}</p><span>${escapeHtml(b.notes || "No note provided")}</span></div><div class="mentor-request-actions"><button class="session-action booking-action" data-id="${b.id}" data-action="accept">Accept</button><button class="session-action cancel-session-action booking-action" data-id="${b.id}" data-action="reject">Decline</button></div></article>`).join("") : '<p class="sessions-empty">No pending booking requests.</p>';
            if (upcomingList) upcomingList.innerHTML = upcoming.length ? upcoming.map(b => `<article class="mentor-upcoming-item"><div><strong>${escapeHtml(b.student)} · ${escapeHtml(b.topic)}</strong><span>${escapeHtml(b.formatted)}</span></div><button class="session-action join-session" data-id="${b.id}">Join Session</button></article>`).join("") : '<p class="sessions-empty">No confirmed sessions scheduled.</p>';
            document.getElementById("mentorPendingCount")?.replaceChildren(String(requests.length));
            document.getElementById("mentorUpcomingCount")?.replaceChildren(String(upcoming.length));
            document.getElementById("mentorRequestCount")?.replaceChildren(`${requests.length} new`);
        } catch (error) { console.error("Could not load bookings", error); }
    }
    document.addEventListener("click", async event => {
        const action = event.target.closest(".booking-action, .cancel-booking, .join-session");
        if (!action) return;
        try {
            if (action.classList.contains("join-session")) {
                const data = await fetch(`/api/sessions/${action.dataset.id}/join`).then(r => r.json());
                if (!data.ok) throw new Error(data.message);
                window.location.assign(data.url); return;
            }
            const token = await fetch("/api/csrf-token").then(r => r.json()).then(d => d.csrf_token);
            const kind = action.classList.contains("cancel-booking") ? "cancel" : action.dataset.action;
            const result = await fetch(`/api/bookings/${action.dataset.id}/${kind}`, {method:"POST", headers:{"X-CSRFToken":token}}).then(r => r.json());
            if (!result.ok) throw new Error(result.message || "Could not update booking.");
            loadBookings();
        } catch (error) { window.alert(error.message || "The requested action could not be completed."); }
    });
    loadBookings();
    window.setInterval(loadBookings, 10000);

    // Availability button
    document.querySelectorAll(".mentor-availability-btn").forEach(btn => {
        btn.addEventListener("click", () => { window.location.href = "/schedule#availabilityForm"; });
    });
})();
