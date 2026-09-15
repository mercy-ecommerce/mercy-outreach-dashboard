import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

/*
|--------------------------------------------------------------------------
| Supabase
|--------------------------------------------------------------------------
*/

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/*
|--------------------------------------------------------------------------
| Google OAuth
|--------------------------------------------------------------------------
*/

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

/*
|--------------------------------------------------------------------------
| Google connection
|--------------------------------------------------------------------------
*/

app.get("/auth/google", (req, res) => {
  const oauth2Client = createOAuthClient();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.send",
      "openid",
      "email",
      "profile"
    ]
  });

  res.redirect(authUrl);
});

/*
|--------------------------------------------------------------------------
| Google OAuth callback
|--------------------------------------------------------------------------
*/

app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res.status(400).send("Authorization code missing.");
    }

    const oauth2Client = createOAuthClient();

    const { tokens } = await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({
      auth: oauth2Client,
      version: "v2"
    });

    const userInfo = await oauth2.userinfo.get();

    const email = userInfo.data.email?.toLowerCase();

    if (!email) {
      return res.status(400).send("Could not determine Gmail address.");
    }

    const accountData = {
      email: email
    };

    if (tokens.refresh_token) {
      accountData.refresh_token = tokens.refresh_token;
    }

    const { error } = await supabase
      .from("outreach_accounts")
      .upsert(
        accountData,
        {
          onConflict: "email"
        }
      );

    if (error) {
      console.error("Supabase save error:", error);

      return res.status(500).send(`
        <h2>Gmail connected, but account could not be saved.</h2>
        <p>${error.message}</p>
      `);
    }

    console.log(`Gmail account saved: ${email}`);

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Gmail Connected</title>

        <style>
          body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f2f4f7;
            font-family: Arial, sans-serif;
          }

          .box {
            background: white;
            padding: 40px;
            border-radius: 16px;
            text-align: center;
            box-shadow: 0 10px 30px rgba(0,0,0,.08);
          }

          h1 {
            color: #0f2d52;
          }

          p {
            color: #6b7280;
          }
        </style>
      </head>

      <body>
        <div class="box">
          <h1>Gmail Connected Successfully</h1>
          <p>${escapeHtml(email)}</p>
          <p>Your account has been saved.</p>
          <p>You can close this window.</p>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error("OAuth error:", error);

    res.status(500).send(`
      <h2>Google connection failed.</h2>
      <p>${escapeHtml(error.message)}</p>
    `);
  }
});

/*
|--------------------------------------------------------------------------
| Get connected Gmail accounts
|--------------------------------------------------------------------------
*/

app.get("/api/accounts", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("outreach_accounts")
      .select("id, email, created_at")
      .order("created_at", {
        ascending: true
      });

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      accounts: data || []
    });

  } catch (error) {
    console.error("Accounts error:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/*
|--------------------------------------------------------------------------
| Send HTML test email
|--------------------------------------------------------------------------
*/

app.post("/api/send-test", async (req, res) => {
  try {
    const { sender, recipient } = req.body;

    if (!sender || !recipient) {
      return res.status(400).json({
        success: false,
        message: "Sender and recipient are required."
      });
    }

    const { data: account, error: accountError } = await supabase
      .from("outreach_accounts")
      .select("email, refresh_token")
      .eq("email", sender.toLowerCase())
      .single();

    if (accountError || !account) {
      return res.status(404).json({
        success: false,
        message: "That Gmail account is not connected."
      });
    }

    if (!account.refresh_token) {
      return res.status(400).json({
        success: false,
        message: "No refresh token is stored for this Gmail account."
      });
    }

    const oauth2Client = createOAuthClient();

    oauth2Client.setCredentials({
      refresh_token: account.refresh_token
    });

    const gmail = google.gmail({
      version: "v1",
      auth: oauth2Client
    });

    const subject = "Mercy Outreach Dashboard Test";

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="margin:0;padding:30px;font-family:Arial,sans-serif;background:#f2f4f7;">

        <div style="
          max-width:600px;
          margin:auto;
          background:#ffffff;
          padding:35px;
          border-radius:12px;
        ">

          <h2 style="color:#0f2d52;">
            Mercy Outreach Dashboard
          </h2>

          <p style="color:#374151;">
            This is a test email sent through your connected Gmail account.
          </p>

          <p style="color:#374151;">
            If you received this message, Gmail sending is working correctly.
          </p>

          <p style="color:#6b7280;">
            Sender: ${escapeHtml(account.email)}
          </p>

        </div>

      </body>
      </html>
    `;

    const message = [
      `From: "Mercy | eCommerce Specialist" <${account.email}>`,
      `To: ${recipient}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "",
      html
    ].join("\r\n");

    const encodedMessage = Buffer
      .from(message, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const result = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage
      }
    });

    console.log(
      `Email sent from ${account.email} to ${recipient}`
    );

    res.json({
      success: true,
      messageId: result.data.id,
      sender: account.email,
      recipient: recipient
    });

  } catch (error) {
    console.error("Send error:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/*
|--------------------------------------------------------------------------
| Prospect API
|--------------------------------------------------------------------------
*/

/*
 * Get all prospects
 */

app.get("/api/prospects", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("prospects")
      .select("*")
      .order("created_at", {
        ascending: true
      });

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      prospects: data || []
    });

  } catch (error) {
    console.error("Get prospects error:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/*
 * Add prospects
 */

app.post("/api/prospects", async (req, res) => {
  try {
    const { emails } = req.body;

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide at least one email address."
      });
    }

    const cleanedEmails = emails
      .map(email => email.trim().toLowerCase())
      .filter(email =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      );

    if (cleanedEmails.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid email addresses were provided."
      });
    }

    const rows = cleanedEmails.map(email => ({
      email: email,
      status: "ready"
    }));

    const { data, error } = await supabase
      .from("prospects")
      .upsert(
        rows,
        {
          onConflict: "email",
          ignoreDuplicates: true
        }
      )
      .select("*");

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      prospects: data || []
    });

  } catch (error) {
    console.error("Add prospects error:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/*
|--------------------------------------------------------------------------
| Prospect statistics
|--------------------------------------------------------------------------
*/

app.get("/api/prospects/stats", async (req, res) => {
  try {

    const { data, error } = await supabase
      .from("prospects")
      .select("status, sent_at");

    if (error) {
      throw error;
    }

    const allProspects = data || [];

    const sent = allProspects.filter(
      prospect => prospect.status === "sent"
    ).length;

    const remaining = allProspects.filter(
      prospect => prospect.status !== "sent"
    ).length;

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

    const sentToday = allProspects.filter(prospect => {

      if (!prospect.sent_at) {
        return false;
      }

      const sentDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Lagos",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date(prospect.sent_at));

      return sentDate === today;

    }).length;

    res.json({
      success: true,
      sent: sent,
      remaining: remaining,
      sentToday: sentToday
    });

  } catch (error) {

    console.error("Stats error:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });

  }
});

/*
|--------------------------------------------------------------------------
| Clear prospect list
|--------------------------------------------------------------------------
*/

app.post("/api/prospects/clear", async (req, res) => {

  try {

    const { error } = await supabase
      .from("prospects")
      .delete()
      .not("id", "is", null);

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      message: "Prospect list cleared successfully."
    });

  } catch (error) {

    console.error("Clear prospects error:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });

  }

});

/*
|--------------------------------------------------------------------------
| Send outreach email
|--------------------------------------------------------------------------
*/

app.post("/api/send", async (req, res) => {
  try {

    const {
      sender,
      recipient,
      subject,
      preheader,
      body
    } = req.body;

    if (!sender || !recipient || !subject || !body) {
      return res.status(400).json({
        success: false,
        message: "Sender, recipient, subject and body are required."
      });
    }

    const senderEmail = sender.trim().toLowerCase();
    const recipientEmail = recipient.trim().toLowerCase();

    /*
     * Check selected Gmail account.
     */

    const {
      data: account,
      error: accountError
    } = await supabase
      .from("outreach_accounts")
      .select("email, refresh_token")
      .eq("email", senderEmail)
      .single();

    if (accountError || !account) {
      return res.status(404).json({
        success: false,
        message: "The selected Gmail account is not connected."
      });
    }

    if (!account.refresh_token) {
      return res.status(400).json({
        success: false,
        message: "No Gmail authorization token is stored for this account."
      });
    }

    /*
     * Check whether prospect has already been sent.
     */

    const {
      data: existingProspect,
      error: prospectCheckError
    } = await supabase
      .from("prospects")
      .select("email, status")
      .eq("email", recipientEmail)
      .maybeSingle();

    if (prospectCheckError) {
      throw prospectCheckError;
    }

    if (
      existingProspect &&
      existingProspect.status === "sent"
    ) {
      return res.status(409).json({
        success: false,
        message: "This prospect has already been contacted."
      });
    }

    /*
     * Gmail OAuth client.
     */

    const oauth2Client = createOAuthClient();

    oauth2Client.setCredentials({
      refresh_token: account.refresh_token
    });

    const gmail = google.gmail({
      version: "v1",
      auth: oauth2Client
    });

    /*
     * Prepare safe campaign content.
     */

    const safePreheader = escapeHtml(
      preheader || "The path to purchase matters more than it seems."
    );

    const safeBody = formatCampaignBody(body);

    /*
|--------------------------------------------------------------------------
| Exact Mercy email template
|--------------------------------------------------------------------------
*/

const html = `
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >
  <title>Mercy | eCommerce Specialist</title>
</head>

<body style="
  margin:0;
  padding:35px 15px;
  background:#F2F4F7;
  font-family:Arial, Helvetica, sans-serif;
">

<!-- Hidden preheader -->

<div style="
  display:none;
  max-height:0;
  overflow:hidden;
  opacity:0;
  color:transparent;
  font-size:1px;
  line-height:1px;
">
  ${safePreheader}
</div>

  <table
    border="0"
    cellpadding="0"
    cellspacing="0"
    width="100%"
    style="background:#F2F4F7;"
  >
    <tr>
      <td align="center">

        <table
          border="0"
          cellpadding="0"
          cellspacing="0"
          width="600"
          style="
            max-width:600px;
            width:100%;
            background:#ffffff;
          "
        >

          <!-- Header -->

          <tr>
            <td style="
              padding:28px 35px;
              border-bottom:1px solid #E5E7EB;
            ">

              <table
                border="0"
                cellpadding="0"
                cellspacing="0"
                width="100%"
              >
                <tr>

                  <td
                    valign="middle"
                    width="55"
                  >
                    <img
                      alt="Mercy"
                      height="45"
                      src="https://mercyecommercespecialist.netlify.app/assets/icons/logo.png"
                      style="
                        display:block;
                        border:0;
                        outline:none;
                        text-decoration:none;
                      "
                      width="45"
                    >
                  </td>

                  <td
                    valign="middle"
                    style="padding-left:10px;"
                  >

                    <div style="
                      font-size:18px;
                      font-weight:700;
                      color:#0F2D52;
                    ">
                      Mercy | eCommerce Specialist
                    </div>

                    <div style="
                      font-size:12px;
                      color:#00A8AB;
                      margin-top:4px;
                      font-weight:600;
                    ">
                      SALES &amp; CONVERSION OPTIMIZATION
                    </div>

                  </td>

                </tr>
              </table>

            </td>
          </tr>

          <!-- Main content -->

          <tr>
            <td style="
              padding:38px 35px 25px 35px;
            ">

              ${safeBody}

              <!-- Website CTA -->

              <p style="
                margin:27px 0 0 0;
                font-size:14px;
                line-height:1.7;
                color:#6B7280;
              ">

                Prefer to take a look first?

                <a
                  href="https://mercyecommercespecialist.netlify.app/"
                  style="
                    color:#00A8AB;
                    font-weight:700;
                    text-decoration:none;
                  "
                >
                  Explore My Work →
                </a>

              </p>

            </td>
          </tr>

          <!-- Signature -->

          <tr>
            <td style="
              padding:5px 35px 35px 35px;
            ">

              <div style="
                border-top:1px solid #E5E7EB;
                padding-top:25px;
              ">

                <div style="
                  font-size:16px;
                  font-weight:700;
                  color:#0F2D52;
                ">
                  Mercy
                </div>

                <div style="
                  font-size:13px;
                  color:#6B7280;
                  margin-top:4px;
                ">
                  eCommerce Specialist
                </div>

                <div style="
                  font-size:12px;
                  color:#00A8AB;
                  margin-top:4px;
                  font-weight:600;
                ">
                  Sales &amp; Conversion Optimization
                </div>

              </div>

            </td>
          </tr>

          <!-- Footer -->

          <tr>
            <td style="
              background:#0F2D52;
              padding:24px 35px;
            ">

              <p style="
                margin:0 0 15px 0;
                font-size:12px;
                color:#D8E3EF;
              ">
                Connect With Me
              </p>

              <table
                border="0"
                cellpadding="0"
                cellspacing="0"
              >
                <tr>

                  <!-- Website -->

                  <td style="
                    padding-right:16px;
                  ">

                    <a
                      href="https://mercyecommercespecialist.netlify.app/"
                      style="text-decoration:none;"
                    >

                      <img
                        alt="Website"
                        height="20"
                        src="https://img.icons8.com/ios-filled/50/FFFFFF/globe.png"
                        style="
                          display:block;
                          border:0;
                          outline:none;
                          text-decoration:none;
                        "
                        width="20"
                      >

                    </a>

                  </td>

                  <!-- WhatsApp -->

                  <td style="
                    padding-right:16px;
                  ">

                    <a
                      href="https://wa.me/2349168542093?text=Hi%20Mercy%2C%20I%20just%20received%20your%20email%20and%20I%E2%80%99d%20like%20to%20learn%20more%20about%20the%20opportunity%20you%20mentioned%20for%20my%20store."
                      style="text-decoration:none;"
                    >

                      <img
                        alt="WhatsApp"
                        height="20"
                        src="https://cdn.simpleicons.org/whatsapp/FFFFFF"
                        style="
                          display:block;
                          border:0;
                          outline:none;
                          text-decoration:none;
                        "
                        width="20"
                      >

                    </a>

                  </td>

                  <!-- Instagram -->

                  <td>

                    <a
                      href="https://www.instagram.com/mercy.ecommercespecialist"
                      style="text-decoration:none;"
                    >

                      <img
                        alt="Instagram"
                        height="20"
                        src="https://cdn.simpleicons.org/instagram/FFFFFF"
                        style="
                          display:block;
                          border:0;
                          outline:none;
                          text-decoration:none;
                        "
                        width="20"
                      >

                    </a>

                  </td>

                </tr>
              </table>

              <p style="
                margin:17px 0 0 0;
                font-size:11px;
                line-height:1.6;
                color:#9FB1C5;
              ">
                Mercy | eCommerce Specialist
              </p>

            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
`;

    /*
     * Build Gmail message.
     */

    const encodedSubject = Buffer
      .from(subject, "utf8")
      .toString("base64");

    const message = [
      `From: "Mercy | eCommerce Specialist" <${account.email}>`,
      `To: ${recipientEmail}`,
      `Subject: =?UTF-8?B?${encodedSubject}?=`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "",
      html
    ].join("\r\n");

    const encodedMessage = Buffer
      .from(message, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    /*
     * Send through Gmail.
     */

    const result = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage
      }
    });

    const messageId = result.data.id;

    /*
     * Mark prospect as sent only after Gmail confirms.
     */

    const {
      error: updateError
    } = await supabase
      .from("prospects")
      .update({
        status: "sent",
        sender_email: account.email,
        sent_at: new Date().toISOString(),
        gmail_message_id: messageId
      })
      .eq("email", recipientEmail);

    if (updateError) {

      console.error(
        "Email sent but prospect tracking failed:",
        updateError
      );

      return res.status(500).json({
        success: false,
        message:
          "Email was sent successfully, but the prospect could not be marked as sent.",
        messageId: messageId
      });
    }

    console.log(
      `Outreach email sent from ${account.email} to ${recipientEmail}`
    );

    res.json({
      success: true,
      message: "Email sent successfully.",
      messageId: messageId,
      sender: account.email,
      recipient: recipientEmail
    });

  } catch (error) {

    console.error("Send email error:", error);

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/*
|--------------------------------------------------------------------------
| Format campaign body
|--------------------------------------------------------------------------
*/

function formatCampaignBody(body) {

  const escaped = escapeHtml(body)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const paragraphs = escaped
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return "";
  }

  return paragraphs
    .map(paragraph => {

      const lines = paragraph
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean);

      /*
       * Detect simple bullet-list sections.
       */

      if (
        lines.length > 1 &&
        lines.every(line => /^[•*-]\s+/.test(line))
      ) {

        const listItems = lines
          .map(line =>
            line.replace(/^[•*-]\s+/, "")
          )
          .map(item => `
            <tr>
              <td style="
                padding:7px 0;
                font-size:14px;
                color:#4B5563;
              ">
                <span style="
                  color:#00A8AB;
                  font-weight:bold;
                ">•</span>
                &nbsp;${item}
              </td>
            </tr>
          `)
          .join("");

        return `
          <table
            border="0"
            cellpadding="0"
            cellspacing="0"
            width="100%"
            style="margin:0 0 27px 0;"
          >
            ${listItems}
          </table>
        `;
      }

      return `
        <p style="
          margin:0 0 24px 0;
          font-size:15px;
          line-height:1.8;
          color:#243447;
        ">
          ${lines.join("<br>")}
        </p>
      `;
    })
    .join("");
}

/*
|--------------------------------------------------------------------------
| Helper
|--------------------------------------------------------------------------
*/

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/*
|--------------------------------------------------------------------------
| Health check
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.json({
    status: "Mercy Outreach Dashboard backend is running."
  });
});

/*
|--------------------------------------------------------------------------
| Start server
|--------------------------------------------------------------------------
*/

app.listen(PORT, () => {
  console.log(
    `Mercy Outreach Dashboard server running at http://localhost:${PORT}`
  );
});