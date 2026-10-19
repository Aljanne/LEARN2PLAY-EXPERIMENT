"use strict";

async function loadProfile() {
    const nameElement = document.getElementById("profileName");
    const rolesElement = document.getElementById("profileRoles");
    const avatarElement = document.getElementById("profileAvatar");
    const topAvatar = document.getElementById("topAvatar");
    const emailElement = document.getElementById("profileEmail");
    const bioElement = document.getElementById("profileBio");

    try {
        const response = await fetch("/api/me", {
            method: "GET",
            credentials: "same-origin",
            headers: {
                Accept: "application/json"
            }
        });

        if (response.status === 401) {
            window.location.href = "/auth";
            return;
        }

        const data = await response.json();

        if (!response.ok || !data.ok || !data.user) {
            throw new Error(data.message || "Could not load profile.");
        }

        const user = data.user;
        const name = user.name || "User";

        // Display the actual account name.
        nameElement.textContent = name;
        emailElement.textContent = user.email || "";

        // Convert role names into readable labels.
        const roleLabels = {
            student: "Student",
            mentor: "Mentor",
            coach: "Gaming Coach"
        };

        rolesElement.textContent = (user.roles || [])
            .map(role => roleLabels[role] || role)
            .join(" & ");

        // Generate initials from the account name.
        const initials = name
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map(part => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase();

        renderAvatar(avatarElement, user.profile_picture, initials);

        if (topAvatar) {
            topAvatar.textContent = initials || "U";
        }

        const nameInput = document.getElementById("editName");
        const bioInput = document.getElementById("editBio");
        const pictureInput = document.getElementById("editPicture");
        if (nameInput) nameInput.value = user.name || "";
        if (bioInput) {
            bioInput.value = user.bio || "";
            updateBioCount();
        }
        if (pictureInput) pictureInput.value = user.profile_picture || "";
        const menuName = document.getElementById("menuName");
        const menuEmail = document.getElementById("menuEmail");
        if (menuName) menuName.textContent = user.name || "User";
        if (menuEmail) menuEmail.textContent = user.email || "";

        // Display the user's saved bio, if available.
        bioElement.textContent = user.bio ||
            "This user hasn't added an introduction yet.";

    } catch (error) {
        console.error("Profile loading error:", error);
        nameElement.textContent = "Unable to load profile";
        rolesElement.textContent = "Please refresh the page.";
    }
}

loadProfile();

function renderAvatar(element, picture, initials) {
    if (!element) return;
    element.replaceChildren();
    if (picture) {
        const image = document.createElement("img");
        image.src = picture;
        image.alt = "Profile picture";
        image.onerror = () => { element.textContent = initials || "U"; };
        element.appendChild(image);
    } else {
        element.textContent = initials || "U";
    }
}

function updateBioCount() {
    const input = document.getElementById("editBio");
    const count = document.getElementById("bioCount");
    if (input && count) count.textContent = String(input.value.length);
}

(function setupProfileEditor() {
    const form = document.getElementById("profileEditForm");
    const editButton = document.getElementById("editProfileBtn");
    const cancelButton = document.getElementById("cancelEditBtn");
    const message = document.getElementById("profileFormMessage");
    const bio = document.getElementById("editBio");
    if (!form || !editButton) return;

    editButton.addEventListener("click", () => {
        form.classList.remove("hidden");
        form.scrollIntoView({ behavior: "smooth", block: "center" });
        document.getElementById("editName").focus();
        message.textContent = "";
    });
    cancelButton.addEventListener("click", () => {
        form.classList.add("hidden");
        loadProfile();
    });
    bio.addEventListener("input", updateBioCount);

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = document.getElementById("saveProfileBtn");
        button.disabled = true;
        message.textContent = "Saving…";
        try {
            const tokenResponse = await fetch("/api/csrf-token", { credentials: "same-origin" });
            const tokenData = await tokenResponse.json();
            if (!tokenResponse.ok || !tokenData.csrf_token) throw new Error("Could not prepare profile update.");

            const response = await fetch("/api/profile", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRFToken": tokenData.csrf_token },
                body: JSON.stringify({
                    name: document.getElementById("editName").value,
                    bio: bio.value,
                    profile_picture: document.getElementById("editPicture").value
                })
            });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.message || "Could not save profile.");
            message.textContent = "Profile saved successfully.";
            await loadProfile();
            form.classList.add("hidden");
        } catch (error) {
            message.textContent = error.message || "Could not save your profile. Please try again.";
        } finally {
            button.disabled = false;
        }
    });
})();

// Profile page account dropdown
(function () {
    const menu = document.getElementById("profileMenu");
    const avatar = document.getElementById("userAvatar");
    const dropdown = document.getElementById("profileDropdown");

    if (!menu || !avatar || !dropdown) return;

    function closeMenu() {
        dropdown.classList.add("hidden");
        avatar.setAttribute("aria-expanded", "false");
    }

    avatar.addEventListener("click", function (event) {
        event.stopPropagation();

        const isOpen = !dropdown.classList.contains("hidden");

        dropdown.classList.toggle("hidden", isOpen);
        avatar.setAttribute("aria-expanded", String(!isOpen));
    });

    document.addEventListener("click", function (event) {
        if (!menu.contains(event.target)) {
            closeMenu();
        }
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            closeMenu();
        }
    });

    // Load the current user's details into the dropdown.
    async function loadDropdownUser() {
        try {
            const response = await fetch("/api/me", {
                credentials: "same-origin",
                headers: { Accept: "application/json" }
            });

            if (response.status === 401) {
                window.location.href = "/auth";
                return;
            }

            const data = await response.json();

            if (!response.ok || !data.ok || !data.user) {
                throw new Error("Could not load account details.");
            }

            const user = data.user;
            const name = user.name || "User";

            const initials = name
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .map(part => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();

            avatar.textContent = initials || "U";
            document.getElementById("menuName").textContent = name;
            document.getElementById("menuEmail").textContent =
                user.email || "";

            const rolesContainer = document.getElementById("menuRoles");
            rolesContainer.replaceChildren();

            const roleLabels = {
                student: "Student",
                mentor: "Mentor",
                coach: "Gaming Coach"
            };

            (user.roles || []).forEach(role => {
                const pill = document.createElement("span");
                pill.className = "pill " + (role === "coach" ? "g" : "a");
                pill.textContent = roleLabels[role] || role;
                rolesContainer.appendChild(pill);
            });
        } catch (error) {
            console.error("Dropdown loading error:", error);
        }
    }

    // Log out from Flask, not just from the page.
    const logout = document.getElementById("logoutBtn");

    if (logout) {
        logout.addEventListener("click", async function (event) {
            event.preventDefault();

            try {
                const tokenResponse = await fetch("/api/csrf-token", {
                    credentials: "same-origin"
                });

                const tokenData = await tokenResponse.json();

                if (!tokenResponse.ok || !tokenData.csrf_token) {
                    throw new Error("Could not prepare logout.");
                }

                const response = await fetch("/api/auth/logout", {
                    method: "POST",
                    credentials: "same-origin",
                    headers: {
                        "X-CSRFToken": tokenData.csrf_token,
                        Accept: "application/json"
                    }
                });

                if (!response.ok) {
                    throw new Error("Logout failed.");
                }

                window.location.href = "/auth";
            } catch (error) {
                console.error("Logout error:", error);
                alert("Could not log out. Please try again.");
            }
        });
    }

    loadDropdownUser();
})();

