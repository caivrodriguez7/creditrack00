using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;
using Microsoft.AspNetCore.WebUtilities;

namespace CrediTrack.Api.Services;

public interface IEmailService
{
    Task SendPasswordResetAsync(string toEmail, string resetLink);
    // isEmailChange: the link confirms a NEW address chosen in Edit Profile (different wording), not a sign-up
    Task SendVerificationAsync(string toEmail, string rawToken, bool isEmailChange = false);
}

public class EmailService : IEmailService
{
    // The logo is loaded from a public HTTPS URL, not embedded in the message as an attachment.
    private const string LogoToken = "@@LOGO@@";

    private readonly IConfiguration _configuration;

    public EmailService(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public async Task SendPasswordResetAsync(string toEmail, string resetLink)
    {
        var smtp = GetSmtpSettings();

        var message = new MimeMessage();
        message.From.Add(BuildFromAddress(smtp.From));
        message.To.Add(MailboxAddress.Parse(toEmail));
        message.Subject = "Reset Your CrediTrack Password";

        var safeLink = System.Net.WebUtility.HtmlEncode(resetLink);

        var htmlBody = BuildEmailHtml(
            preheader: "Use this link to reset your CrediTrack password.",
            heading: "Reset your password",
            introHtml: "We received a request to reset the password for your CrediTrack account. Click the button below to choose a new one.",
            buttonText: "Reset Password",
            safeLink: safeLink,
            noteHtml: "This link is valid for <strong>30 minutes</strong>. If you did not request a password reset, you can safely ignore this email. Your password will stay the same.");

        var textBody = $"""
            Reset your CrediTrack password

            We received a request to reset the password for your CrediTrack account.

            Open this link to choose a new password:
            {resetLink}

            This link is valid for 30 minutes.

            If you did not request this, you may ignore this email.
            """;

        await SendAsync(smtp, message, htmlBody, textBody);
    }

    public async Task SendVerificationAsync(string toEmail, string rawToken, bool isEmailChange = false)
    {
        var verificationUrl = _configuration["Frontend:EmailVerificationUrl"];

        if (string.IsNullOrWhiteSpace(verificationUrl))
            throw new InvalidOperationException("Email verification frontend URL is not configured.");

        var smtp = GetSmtpSettings();

        // The href must be an absolute http(s) URL, otherwise mail clients will not
        // render it as a clickable link.
        if (!Uri.TryCreate(verificationUrl.Trim(), UriKind.Absolute, out var baseUri)
            || (baseUri.Scheme != Uri.UriSchemeHttp && baseUri.Scheme != Uri.UriSchemeHttps))
            throw new InvalidOperationException(
                "Frontend:EmailVerificationUrl must be an absolute http(s) URL.");

        // Build the verification link from the configured page URL and the raw token.
        // AddQueryString URL-encodes the token value. The token is never logged.
        var verificationLink = QueryHelpers.AddQueryString(
            baseUri.AbsoluteUri,
            "token",
            rawToken);

        var message = new MimeMessage();
        message.From.Add(BuildFromAddress(smtp.From));
        message.To.Add(MailboxAddress.Parse(toEmail));
        message.Subject = isEmailChange ? "Confirm Your New CrediTrack Email" : "Verify Your CrediTrack Email";

        var safeLink = System.Net.WebUtility.HtmlEncode(verificationLink);

        var htmlBody = BuildEmailHtml(
            preheader: isEmailChange ? "Confirm your new email address for your CrediTrack account." : "Confirm your email address to activate your CrediTrack account.",
            heading: isEmailChange ? "Confirm your new email address" : "Verify your email address",
            introHtml: isEmailChange
                ? "We received a request to use this email address for your CrediTrack account. Please confirm it to finish the change."
                : "Thanks for signing up for CrediTrack! Please confirm your email address to activate your account.",
            buttonText: isEmailChange ? "Confirm Email" : "Verify Email",
            safeLink: safeLink,
            noteHtml: isEmailChange
                ? "This link will expire in <strong>30 minutes</strong> and can only be used once. If you did not ask to change your email, you can safely ignore this message. Your account email will stay the same."
                : "This link will expire in <strong>30 minutes</strong> and can only be used once. If you did not create a CrediTrack account, you can safely ignore this email.");

        var textBody = isEmailChange
            ? $"""
            Confirm Your New CrediTrack Email

            We received a request to use this email address for your CrediTrack account. Please confirm it to finish the change.

            Confirm your new email by opening this link:
            {verificationLink}

            This link will expire in 30 minutes, and it can only be used once.

            If you did not ask to change your email, you may ignore this message. Your account email will stay the same.
            """
            : $"""
            Verify Your CrediTrack Email

            Thanks for signing up for CrediTrack. Please confirm your email address to activate your account.

            Verify your email by opening this link:
            {verificationLink}

            This link will expire in 30 minutes, and it can only be used once.

            If you did not create a CrediTrack account, you may ignore this email.
            """;

        await SendAsync(smtp, message, htmlBody, textBody);
    }

    // ------------------------------------------------------------------
    // Shared helpers
    // ------------------------------------------------------------------

    // The sender shows as "CrediTrack" in the inbox. Email:From may be a bare address or "Name <address>";
    // an optional Email:FromName setting overrides the name.
    private MailboxAddress BuildFromAddress(string from)
    {
        var parsed = MailboxAddress.Parse(from.Trim());
        var name = _configuration["Email:FromName"]?.Trim();
        if (string.IsNullOrWhiteSpace(name))
            name = string.IsNullOrWhiteSpace(parsed.Name) ? "CrediTrack" : parsed.Name;
        return new MailboxAddress(name, parsed.Address);
    }

    private sealed record SmtpSettings(string Host, int Port, string Username, string Password, string From);

    private SmtpSettings GetSmtpSettings()
    {
        // A blank value counts as missing, so the log names the real problem instead of failing later on the connection
        string Need(string key, string what)
        {
            var value = _configuration[key];
            if (string.IsNullOrWhiteSpace(value))
                throw new InvalidOperationException($"{what} is not configured (setting \"{key}\"). See \"First-time setup\" in the README.");
            return value.Trim();
        }

        var host = Need("Email:Smtp:Host", "SMTP host");

        if (!int.TryParse(Need("Email:Smtp:Port", "SMTP port"), out var port))
            throw new InvalidOperationException("SMTP port must be a number such as 587 (setting \"Email:Smtp:Port\").");

        var username = Need("Email:Smtp:Username", "SMTP username");
        var password = _configuration["Email:Smtp:Password"];
        if (string.IsNullOrWhiteSpace(password))
            throw new InvalidOperationException("SMTP password is not configured (setting \"Email:Smtp:Password\"). See \"First-time setup\" in the README.");
        var from = Need("Email:From", "Email sender");

        return new SmtpSettings(host, port, username, password, from);
    }

    private async Task SendAsync(SmtpSettings smtp, MimeMessage message, string htmlBody, string textBody)
    {
        // Plain multipart/alternative (text + html). No attachments, no linked resources.
        htmlBody = htmlBody.Replace(LogoToken, BuildLogoHtml());

        message.Body = new MultipartAlternative
        {
            new TextPart("plain") { Text = textBody },
            new TextPart("html") { Text = htmlBody }
        };

        using var client = new SmtpClient();

        // Port 465 is encrypted from the first byte; 587 (and others) start plain and switch to TLS
        await client.ConnectAsync(smtp.Host, smtp.Port, smtp.Port == 465 ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTls);
        await client.AuthenticateAsync(smtp.Username, smtp.Password);
        await client.SendAsync(message);
        await client.DisconnectAsync(true);
    }

    private string BuildLogoHtml()
    {
        const string navy = "#071A52";
        const string teal = "#086B70";
        const string font = "'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

        // Text wordmark instead of an image: an image has a fixed white background, which shows as a white box in
        // dark mode, while text colors are adjusted by the mail app.
        return $"<div style=\"font-family:{font};font-size:36px;line-height:40px;font-weight:800;font-style:italic;letter-spacing:-1px;text-align:center;\"><span style=\"color:{navy};\">Credi</span><span style=\"color:{teal};\">Track</span></div>";
    }

    // Table-based layout with inline styles so it renders consistently in Gmail,
    // Outlook, Apple Mail and mobile clients. Brand colors match wwwroot/css/tokens.css.
    // safeLink must already be HTML-encoded. Every other argument is a fixed string
    // supplied by this class, never user input.
    private static string BuildEmailHtml(
        string preheader,
        string heading,
        string introHtml,
        string buttonText,
        string safeLink,
        string noteHtml)
    {
        const string navy = "#071A52";
        const string teal = "#086B70";
        const string turquoise = "#35A5A0";
        const string lime = "#F0F59A";
        const string ink = "#16244d";
        const string muted = "#475775";
        const string border = "#d6e4e6";
        const string surface = "#f3f8f8";
        const string font = "'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

        return $"""
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <meta name="color-scheme" content="light">
              <meta name="supported-color-schemes" content="light">
              <title>{heading}</title>
            </head>
            <body style="margin:0;padding:0;background-color:{surface};">
              <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:{surface};font-size:1px;line-height:1px;">{preheader}</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:{surface};">
                <tr>
                  <td align="center" style="padding:32px 16px;">
                    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid {border};border-radius:16px;overflow:hidden;">
                      <tr>
                        <td height="6" style="height:6px;line-height:6px;font-size:6px;background-color:{teal};background-image:linear-gradient(90deg,{navy},{teal} 40%,{turquoise} 75%,{lime});">&nbsp;</td>
                      </tr>
                      <tr>
                        <td align="center" style="padding:32px 32px 8px 32px;">
                          @@LOGO@@
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:16px 40px 0 40px;font-family:{font};">
                          <h1 style="margin:0 0 12px 0;font-size:24px;line-height:32px;font-weight:700;color:{navy};text-align:center;">{heading}</h1>
                          <p style="margin:0 0 24px 0;font-size:16px;line-height:26px;color:{ink};text-align:center;">{introHtml}</p>
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="padding:0 40px 8px 40px;">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td align="center" bgcolor="{teal}" style="border-radius:10px;background-color:{teal};">
                                <a href="{safeLink}" target="_blank" style="display:inline-block;padding:14px 36px;font-family:{font};font-size:16px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;border-radius:10px;">{buttonText}</a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:24px 40px 0 40px;font-family:{font};">
                          <p style="margin:0;font-size:14px;line-height:22px;color:{muted};text-align:center;">{noteHtml}</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:24px 40px 32px 40px;">
                          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:{surface};border:1px solid {border};border-radius:10px;">
                            <tr>
                              <td style="padding:14px 16px;font-family:{font};font-size:12px;line-height:18px;color:{muted};">
                                If the button does not work, copy and paste this link into your browser:<br>
                                <a href="{safeLink}" target="_blank" style="color:{teal};word-break:break-all;">{safeLink}</a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td align="center" style="padding:20px 32px;background-color:{navy};font-family:{font};font-size:12px;line-height:18px;color:#c9d3ec;">
                          This is an automated message from CrediTrack. Please do not reply to this email.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </body>
            </html>
            """;
    }
}
