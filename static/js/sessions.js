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

    // Availability button
    document.querySelectorAll(".mentor-availability-btn").forEach(btn => {
        btn.addEventListener("click", () => alert("Availability calendar management will open here soon."));
    });
})();