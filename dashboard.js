const API_URL = "https://mercy-outreach-dashboard.onrender.com";

let prospects = [];


/*
|--------------------------------------------------------------------------
| Load Gmail accounts
|--------------------------------------------------------------------------
*/

async function loadAccounts() {
  const senderSelect = document.getElementById("senderSelect");

  try {
    const response = await fetch(`${API_URL}/api/accounts`);
    const result = await response.json();

    senderSelect.innerHTML = "";

    if (!result.success || !result.accounts.length) {
      senderSelect.innerHTML =
        '<option value="">No Gmail accounts connected</option>';
      return;
    }

    result.accounts.forEach(account => {
      const option = document.createElement("option");

      option.value = account.email;
      option.textContent = account.email;

      senderSelect.appendChild(option);
    });

  } catch (error) {
    console.error("Accounts loading error:", error);

    senderSelect.innerHTML =
      '<option value="">Unable to load accounts</option>';
  }
}


/*
|--------------------------------------------------------------------------
| Load prospects
|--------------------------------------------------------------------------
*/

async function loadProspects() {
  try {
    const response = await fetch(`${API_URL}/api/prospects`);
    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message);
    }

    prospects = result.prospects || [];

    renderProspects();

  } catch (error) {
    console.error("Prospects loading error:", error);
  }
}


/*
|--------------------------------------------------------------------------
| Render prospects
|--------------------------------------------------------------------------
*/

function renderProspects() {
  const prospectList = document.getElementById("prospectList");

  prospectList.innerHTML = "";

  if (!prospects.length) {
    prospectList.innerHTML = `
      <div class="empty-state">
        No prospects added yet.
      </div>
    `;

    return;
  }

  prospects.forEach((prospect, index) => {

    const row = document.createElement("div");

    row.className = "prospect-row";

    const statusClass =
      prospect.status === "sent" ? "sent" : "ready";

    const statusText =
      prospect.status === "sent" ? "Sent" : "Ready";

    row.innerHTML = `
      <div class="prospect-email">
  ${index + 1}. ${escapeHtml(prospect.email)}
</div>

      <div class="prospect-actions">

        <span class="status ${statusClass}">
          ${statusText}
        </span>

        ${
          prospect.status !== "sent"
            ? `
              <button
                class="send-btn"
                onclick="sendProspect('${escapeHtml(prospect.email)}')"
              >
                Send
              </button>
            `
            : ""
        }

      </div>
    `;

    prospectList.appendChild(row);
  });
}


/*
|--------------------------------------------------------------------------
| Add prospects
|--------------------------------------------------------------------------
*/

async function addProspects() {

  const input = document.getElementById("prospectInput");
  const message = document.getElementById("prospectMessage");

  const rawText = input.value.trim();

  if (!rawText) {
    message.textContent = "Please paste at least one email address.";
    message.className = "message error";
    return;
  }

  const emails = rawText
    .split(/[\s,;]+/)
    .map(email => email.trim().toLowerCase())
    .filter(email =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    );

  if (!emails.length) {
    message.textContent = "No valid email addresses found.";
    message.className = "message error";
    return;
  }

  const button = document.getElementById("addProspectsBtn");

  button.disabled = true;
  button.textContent = "Adding...";

  try {

    const response = await fetch(`${API_URL}/api/prospects`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json"
      },

      body: JSON.stringify({
        emails: emails
      })
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message);
    }

    input.value = "";

    message.textContent =
      "Prospects added successfully.";

    message.className = "message success";

    await loadProspects();
    await loadStats();

  } catch (error) {

    console.error("Add prospects error:", error);

    message.textContent = error.message;
    message.className = "message error";

  } finally {

    button.disabled = false;
    button.textContent = "Add Prospects";

  }
}


/*
|--------------------------------------------------------------------------
| Clear prospect list
|--------------------------------------------------------------------------
*/

async function clearProspectList() {

  if (!prospects.length) {
    alert("There are no prospects to clear.");
    return;
  }

  const confirmed = confirm(
    "Clear all prospects from the current scouting list?"
  );

  if (!confirmed) {
    return;
  }

  const button =
    document.getElementById("clearProspectsBtn");

  button.disabled = true;
  button.textContent = "Clearing...";

  try {

    const response = await fetch(
  `${API_URL}/api/prospects/clear`,
  {
    method: "POST",

    headers: {
      "Content-Type": "application/json"
    }
  }
);

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message);
    }

    prospects = [];

    renderProspects();

    await loadStats();

    alert("Prospect list cleared successfully.");

  } catch (error) {

    console.error("Clear prospects error:", error);

    alert(
      `Prospect list could not be cleared.\n\n${error.message}`
    );

  } finally {

    button.disabled = false;
    button.textContent = "Clear Prospect List";

  }
}


/*
|--------------------------------------------------------------------------
| Load statistics
|--------------------------------------------------------------------------
*/

async function loadStats() {

  try {

    const response =
      await fetch(`${API_URL}/api/prospects/stats`);

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message);
    }

    document.getElementById("sentCount").textContent =
      result.sent;

    document.getElementById("remainingCount").textContent =
      result.remaining;

    document.getElementById("sentTodayCount").textContent =
      result.sentToday;

  } catch (error) {

    console.error("Stats error:", error);

  }
}


/*
|--------------------------------------------------------------------------
| Send prospect
|--------------------------------------------------------------------------
*/

async function sendProspect(email) {

  const senderSelect =
    document.getElementById("senderSelect");

  const sender = senderSelect.value;

  if (!sender) {
    alert("Please select a Gmail account first.");
    return;
  }

  const subject =
    document.getElementById("subjectInput").value.trim();

  const preheader =
    document.getElementById("preheaderInput").value.trim();

  const body =
    document.getElementById("bodyInput").value.trim();

  if (!subject) {
    alert("Please enter an email subject.");
    return;
  }

  if (!body) {
    alert("Please enter your email body.");
    return;
  }

  const confirmed =
    confirm(
      `Send this email to ${email} from ${sender}?`
    );

  if (!confirmed) {
    return;
  }

  try {

    const response = await fetch(
      `${API_URL}/api/send`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          sender: sender,
          recipient: email,
          subject: subject,
          preheader: preheader,
          body: body
        })
      }
    );

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.message);
    }

    alert("Email sent successfully.");

    await loadProspects();
    await loadStats();

  } catch (error) {

    console.error("Send error:", error);

    alert(
      `Email could not be sent.\n\n${error.message}`
    );
  }
}


/*
|--------------------------------------------------------------------------
| Escape HTML
|--------------------------------------------------------------------------
*/

function escapeHtml(value) {

  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


/*
|--------------------------------------------------------------------------
| Start dashboard
|--------------------------------------------------------------------------
*/

document.addEventListener("DOMContentLoaded", async () => {

  document
    .getElementById("addProspectsBtn")
    .addEventListener("click", addProspects);

  document
    .getElementById("clearProspectsBtn")
    .addEventListener("click", clearProspectList);

  await loadAccounts();
  await loadProspects();
  await loadStats();


  const saveCampaignBtn =
    document.getElementById("saveCampaignBtn");

  const campaignMessage =
    document.getElementById("campaignMessage");

  if (saveCampaignBtn) {

    saveCampaignBtn.addEventListener("click", () => {

      const campaign = {
        subject:
          document.getElementById("subjectInput").value,

        preheader:
          document.getElementById("preheaderInput").value,

        body:
          document.getElementById("bodyInput").value
      };

      localStorage.setItem(
        "mercyCampaign",
        JSON.stringify(campaign)
      );

      campaignMessage.textContent =
        "Campaign saved.";

      campaignMessage.style.color =
        "#00a8ab";
    });
  }


  const savedCampaign =
    localStorage.getItem("mercyCampaign");

  if (savedCampaign) {

    const campaign =
      JSON.parse(savedCampaign);

    document.getElementById("subjectInput").value =
      campaign.subject;

    document.getElementById("preheaderInput").value =
      campaign.preheader;

    document.getElementById("bodyInput").value =
      campaign.body;
  }

});