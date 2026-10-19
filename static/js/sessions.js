"use strict";

(function setupSessionFilters() {
    const tabs = document.querySelectorAll(".session-tab");
    const sessions = document.querySelectorAll(".scheduled-session");
    const empty = document.getElementById("sessionsEmpty");
    const sessionList = document.getElementById("sessionList");
    let switchTimer = null;

    function showSessions(status, animate = true) {
        const updateList = () => {
            let visibleCount = 0;

            sessions.forEach(session => {
                const isVisible = session.dataset.status === status;
                session.hidden = !isVisible;
                session.setAttribute("aria-hidden", String(!isVisible));
                session.classList.remove("session-switch-enter");
                if (isVisible) visibleCount += 1;
            });

            if (empty) empty.classList.toggle("hidden", visibleCount > 0);

            if (animate && sessionList) {
                requestAnimationFrame(() => {
                    sessionList.classList.remove("session-list-leaving");
                    sessions.forEach(session => {
                        if (!session.hidden) session.classList.add("session-switch-enter");
                    });
                });
            }
        };

        clearTimeout(switchTimer);
        if (animate && sessionList) {
            sessionList.classList.add("session-list-leaving");
            switchTimer = setTimeout(updateList, 160);
        } else {
            updateList();
        }
    }

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const status = tab.dataset.status;

            tabs.forEach(item => {
                const isActive = item === tab;
                item.classList.toggle("active", isActive);
                item.setAttribute("aria-selected", String(isActive));
            });

            showSessions(status);
        });
    });

    document.querySelectorAll(".session-action").forEach(button => {
        button.addEventListener("click", () => {
            const session = button.closest(".scheduled-session");
            const title = session.querySelector("h3").textContent;

            if (button.classList.contains("cancel-session-action")) {
                const confirmed = confirm(`Cancel your session for ${title}?`);
                if (!confirmed) return;

                session.remove();
                const upcomingCount = document.getElementById("upcomingCount");
                const remaining = document.querySelectorAll('.scheduled-session[data-status="upcoming"]').length;
                if (upcomingCount) upcomingCount.textContent = String(remaining);

                const activeTab = document.querySelector(".session-tab.active");
                if (activeTab?.dataset.status === "upcoming") {
                    empty.classList.toggle("hidden", remaining > 0);
                }
                return;
            }

            alert(`Session details for ${title} will be available soon.`);
        });
    });

    // Apply the default Upcoming filter on first load so completed sessions
    // remain visible only inside the Past sessions tab.
    const initialTab = document.querySelector(".session-tab.active");
    if (initialTab) showSessions(initialTab.dataset.status, false);
})();
