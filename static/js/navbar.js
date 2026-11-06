"use strict";

(function setupNavbarDropdownAndLogout() {
    const menu = document.getElementById("profileMenu");
    const avatar = document.getElementById("userAvatar");
    const dropdown = document.getElementById("profileDropdown");

    if (!menu || !avatar || !dropdown) return;

    function closeMenu(returnFocus = false) {
        dropdown.classList.add("hidden");
        avatar.setAttribute("aria-expanded", "false");
        if (returnFocus) avatar.focus();
    }

    avatar.addEventListener("click", (event) => {
        event.stopPropagation();
        const isOpen = !dropdown.classList.contains("hidden");
        dropdown.classList.toggle("hidden", isOpen);
        avatar.setAttribute("aria-expanded", String(!isOpen));
    });

    document.addEventListener("click", (event) => {
        if (!menu.contains(event.target)) closeMenu();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeMenu(true);
    });

    const logoutButton = document.getElementById("logoutBtn");
    if (!logoutButton) return;

    logoutButton.addEventListener("click", async (event) => {
        event.preventDefault();
        try {
            const tokenResponse = await fetch("/api/csrf-token", { credentials: "same-origin" });
            const tokenData = await tokenResponse.json();
            if (!tokenResponse.ok || !tokenData.csrf_token) {
                throw new Error("Could not obtain the logout security token.");
            }

            const logoutResponse = await fetch("/api/auth/logout", {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    Accept: "application/json",
                    "X-CSRFToken": tokenData.csrf_token
                }
            });
            if (!logoutResponse.ok) throw new Error("Logout request was rejected.");
            window.location.href = "/auth";
        } catch (error) {
            window.alert("Logout could not be completed. Please try again.");
        }
    });
})();
