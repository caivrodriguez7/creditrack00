using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;
using CrediTrack.Api.Services;
using System.Security.Claims;
using System.Text.RegularExpressions;
using CrediTrack.Api.Data;
using CrediTrack.Api.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    // Keep these aligned with the policy revisions shown on /terms and /privacy.
    private const string CurrentTermsVersion = "2026-11-14";
    private const string CurrentPrivacyPolicyVersion = "2026-11-14";

    // Where a password reset request started is part of the token itself. A token that begins with this prefix was
    // requested from Settings > Security by the signed-in account. The prefix is inside the hashed value, so removing
    // or adding it makes the token unknown (invalid): the browser can never change a token's origin.
    private const string SettingsTokenPrefix = "st.";

        private readonly AppDb _db;
    private readonly IEmailService _emailService;
    private readonly IConfiguration _configuration;
    private readonly ILogger<AuthController> _logger;
    private readonly AttemptLimiter _limiter;

    // Per-EMAIL limits (on top of the per-IP "auth" rate limit): at most 3 mails per address per 15 minutes,
    // so nobody can flood a victim's inbox even from many IP addresses.
    private const int MailLimit = 3;
    private static readonly TimeSpan MailWindow = TimeSpan.FromMinutes(15);

    public AuthController(
        AppDb db,
        IEmailService emailService,
        IConfiguration configuration,
        ILogger<AuthController> logger,
        AttemptLimiter limiter)
    {
        _db = db;
        _emailService = emailService;
        _configuration = configuration;
        _logger = logger;
        _limiter = limiter;
    }

    public record RegisterRequest(
        string Role, string FullName, string Email, string? ContactNumber, string Password,
        string? StoreName, string? StorePhone, string? StoreAddress, bool AcceptedTerms = false);
    public record LoginRequest(string Email, string Password, bool RememberMe = false);
    // ReturnTo is optional: only the Security (Settings) pages send "settings", the Log In page sends nothing.
    public record ForgotPasswordRequest(string Email, string? ReturnTo = null);
    public record VerifyEmailRequest(string Token);
    public record ResendVerificationRequest(string Email);

    // What the frontend gets back (never the password hash)
    private async Task<object> BuildDto(User u)
    {
        var store = u.Role == "owner"
            ? await _db.Stores.FirstOrDefaultAsync(s => s.OwnerId == u.Id)
            : null;
        return new
        {
            id = u.Id,
            role = u.Role,
            fullName = u.FullName,
            email = u.Email,
            contactNumber = u.ContactNumber,
            customerCode = u.CustomerCode,
            storeName = store?.Name,
            storeCode = store?.StoreCode,
            passwordChangedAt = u.PasswordChangedAt,
            photo = FileStorage.Url(u.PhotoPath),
            memberSince = u.CreatedAt,          // shown on the customer's Personal Information page
            emailVerified = u.EmailVerified
        };
    }

    private static string SecurityPath(string role) => role == "owner" ? "/owner/security" : "/customer/security";

    // Same rules as the register pages: 8+ characters, upper, lower, number, special
    private static bool PasswordOk(string? p) =>
        !string.IsNullOrEmpty(p) && p.Length >= 8
        && Regex.IsMatch(p, "[A-Z]") && Regex.IsMatch(p, "[a-z]")
        && Regex.IsMatch(p, "[0-9]") && Regex.IsMatch(p, "[^A-Za-z0-9\\s]");

    private async Task<string> NewStoreCode()
    {
        while (true)
        {
            var code = Codes.NewStoreCode();   // cryptographic random (Services/Codes.cs)
            if (!await _db.Stores.AnyAsync(s => s.StoreCode == code)) return code;
        }
    }

    private async Task<string> NewCustomerCode()
    {
        while (true)
        {
            var code = Codes.NewCustomerCode();   // cryptographic random (Services/Codes.cs)
            if (!await _db.Users.AnyAsync(u => u.CustomerCode == code)) return code;
        }
    }

    // Creates the login cookie. Persistent (survives closing the browser) only when asked to;
    // otherwise it is a session cookie.
    private async Task SignInUser(User u, bool rememberMe)
    {
        await HttpContext.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            AuthCookie.Principal(u),
            new AuthenticationProperties { IsPersistent = rememberMe });
    }

    [EnableRateLimiting("auth")]
    [HttpPost("register")]
    public async Task<IActionResult> Register(RegisterRequest req)
    {
        var role = (req.Role ?? "").Trim().ToLowerInvariant();
        var email = (req.Email ?? "").Trim().ToLowerInvariant();

        if (role != "owner" && role != "customer")
            return BadRequest(new { message = "Invalid account type." });
        if (!req.AcceptedTerms)
            return BadRequest(new { field = "acceptedTerms", message = "You must agree to the Terms and Conditions and Privacy Policy to create an account." });
        var fullName = string.Join(" ", (req.FullName ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries));
        if (fullName.Length < 2 || fullName.Length > 80 || !Validation.PlainText(fullName))
            return BadRequest(new { message = "Enter your full name (2 to 80 characters, no < or > symbols)." });
        if (!Validation.Email(email))
            return BadRequest(new { message = "Enter a valid email address." });
        var contact = (req.ContactNumber ?? "").Trim();
        if (contact.Length > 20 || !Validation.PlainText(contact))
            return BadRequest(new { message = "Enter a valid contact number." });
        if (!PasswordOk(req.Password) || req.Password.Length > 100)
            return BadRequest(new { message = "Password must be 8+ characters with an uppercase letter, a lowercase letter, a number and a special character." });
        var storeName = string.Join(" ", (req.StoreName ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries));
        var storePhone = (req.StorePhone ?? "").Trim();
        var storeAddress = (req.StoreAddress ?? "").Trim();
        if (role == "owner")
        {
            if (storeName.Length < 2 || storeName.Length > 80 || !Validation.PlainText(storeName))
                return BadRequest(new { message = "Enter your store name (2 to 80 characters, no < or > symbols)." });
            if (storePhone.Length > 20 || !Validation.PlainText(storePhone))
                return BadRequest(new { message = "Enter a valid store contact number." });
            if (storeAddress.Length > 200 || !Validation.PlainText(storeAddress))
                return BadRequest(new { message = "Use a store address of 200 characters or fewer, without < or > symbols." });
        }

        if (await _db.Users.AnyAsync(u => u.Email == email))
            return Conflict(new { message = "This email is already registered." });

        var user = new User
        {
            Role = role,
            FullName = fullName,
            Email = email,
            ContactNumber = contact.Length > 0 ? contact : null,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password),
            TermsAcceptedAt = DateTime.UtcNow,
            TermsVersion = CurrentTermsVersion,
            PrivacyPolicyVersion = CurrentPrivacyPolicyVersion
        };
        if (role == "customer") user.CustomerCode = await NewCustomerCode();
        _db.Users.Add(user);

        if (role == "owner")
        {
            _db.Stores.Add(new Store
            {
                Owner = user,
                Name = storeName,
                Phone = storePhone.Length > 0 ? storePhone : null,
                Address = storeAddress.Length > 0 ? storeAddress : null,
                StoreCode = await NewStoreCode()
            });
        }
        await _db.SaveChangesAsync();   // saves the user and the store together

        // The account now exists. Do NOT sign the user in: they must verify their email first.
        var emailSent = false;
        try
        {
            var now = DateTime.UtcNow;

            // Cryptographically secure random token (sent to the user, never stored).
            var rawToken = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));

            // Store only the SHA-256 hash.
            var tokenHash = Convert.ToHexString(
                SHA256.HashData(Encoding.UTF8.GetBytes(rawToken)));

            _db.EmailVerificationTokens.Add(new EmailVerificationToken
            {
                UserId = user.Id,
                TokenHash = tokenHash,
                ExpiresAt = now.AddMinutes(30),
                CreatedAt = now
            });
            await _db.SaveChangesAsync();

            await _emailService.SendVerificationAsync(user.Email, rawToken);
            emailSent = true;
        }
        catch (Exception ex)
        {
            // Keep the account. Never log the token; the user can request another email later.
            _logger.LogError(ex, "Failed to create or send the verification email for user {UserId}.", user.Id);
        }

        if (!emailSent)
        {
            return Ok(new
            {
                message = "Your account was created, but we could not send the verification email. You can request another verification email later.",
                requiresEmailVerification = true,
                emailSent = false,
                email = user.Email
            });
        }

        return Ok(new
        {
            message = "Account created. Please check your email to verify your account.",
            requiresEmailVerification = true,
            emailSent = true,
            email = user.Email
        });
    }

    [EnableRateLimiting("auth")]
    [HttpPost("login")]
    public async Task<IActionResult> Login(LoginRequest req)
    {
        var email = (req.Email ?? "").Trim().ToLowerInvariant();
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == email);

        // Same message for "no such email" and "wrong password"
        if (user == null || !BCrypt.Net.BCrypt.Verify(req.Password ?? "", user.PasswordHash))
            return Unauthorized(new { message = "Incorrect email or password." });

        // Credentials are correct, but the email must be verified before a cookie is issued.
        // No verification email is sent from here; the user can use resend-verification.
        if (!user.EmailVerified)
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                message = "Please verify your email address before signing in.",
                requiresEmailVerification = true,
                email = user.Email
            });

        await SignInUser(user, req.RememberMe);
        return Ok(await BuildDto(user));
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return NoContent();
    }

    // Who is signed in right now? (401 if nobody)
    [Authorize]
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var id = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        var user = await _db.Users.FindAsync(id);
        if (user == null) return Unauthorized();
        return Ok(await BuildDto(user));
    }


    [EnableRateLimiting("auth")]
    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword(ForgotPasswordRequest req)
    {
        const string responseMessage =
            "If your email is registered, you will receive a password reset link.";

        var email = (req.Email ?? "").Trim().ToLowerInvariant();

        var resetPageUrl = _configuration["Frontend:ResetPasswordUrl"];

        if (string.IsNullOrWhiteSpace(resetPageUrl))
        {
            _logger.LogError("Password reset frontend URL is not configured.");
            return StatusCode(500, new { message = "Password reset is currently unavailable." });
        }

        // Over the per-email limit: answer exactly like a normal request (200, same text) but send nothing, so the
        // limit cannot be used to find out which emails are registered.
        if (!_limiter.TryHit("forgot:" + email, MailLimit, MailWindow))
            return Ok(new { message = responseMessage });

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == email);

        // Always return the same response for unknown email addresses.
        if (user == null)
            return Ok(new { message = responseMessage });

        var now = DateTime.UtcNow;

        // Invalidate previous unused reset tokens.
        var oldTokens = await _db.PasswordResetTokens
            .Where(t => t.UserId == user.Id &&
                        t.UsedAt == null &&
                        t.ExpiresAt > now)
            .ToListAsync();

        foreach (var oldToken in oldTokens)
            oldToken.UsedAt = now;

        // Where did this request start? Only the signed-in owner of THIS account, asking from Settings > Security
        // (ReturnTo = "settings"), makes a Settings reset. Every other request (the Log In page sends no ReturnTo, a signed-out
        // caller, a different account) is a normal Log In reset and gets exactly the link and token it always did.
        var fromSettings = string.Equals(req.ReturnTo, "settings", StringComparison.OrdinalIgnoreCase)
            && User.Identity?.IsAuthenticated == true
            && User.FindFirstValue(ClaimTypes.NameIdentifier) == user.Id.ToString()
            && Uri.TryCreate(resetPageUrl, UriKind.Absolute, out _);

        // Generate a secure random token (a Settings reset carries its origin as a prefix).
        var rawToken = (fromSettings ? SettingsTokenPrefix : "") + WebEncoders.Base64UrlEncode(
            RandomNumberGenerator.GetBytes(32));

        // Store only the SHA-256 hash, never the raw token.
        var tokenHash = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(rawToken)));

        var resetToken = new PasswordResetToken
        {
            UserId = user.Id,
            TokenHash = tokenHash,
            ExpiresAt = now.AddMinutes(30),
            CreatedAt = now
        };

        _db.PasswordResetTokens.Add(resetToken);
        await _db.SaveChangesAsync();

        // Build the reset link: the Reset Password page for a Log In reset; this account's Security page for a Settings reset.
        var linkTarget = resetPageUrl;
        if (fromSettings)
            linkTarget = new Uri(new Uri(resetPageUrl), SecurityPath(user.Role)).ToString();
        var resetLink = QueryHelpers.AddQueryString(
            linkTarget,
            "token",
            rawToken);

        try
        {
            await _emailService.SendPasswordResetAsync(user.Email, resetLink);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send password reset email.");
        }

        return Ok(new { message = responseMessage });
    }

    [EnableRateLimiting("auth")]
    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPassword(ResetPasswordRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Token))
            return BadRequest(new { message = "Invalid or expired reset link." });

        if (req.NewPassword != req.ConfirmPassword)
            return BadRequest(new { message = "Passwords do not match." });

        if (!PasswordOk(req.NewPassword))
            return BadRequest(new
            {
                message = "Password must be 8+ characters with an uppercase letter, a lowercase letter, a number and a special character."
            });

        // Hash the received token to find its database record.
        var tokenHash = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(req.Token)));

        var now = DateTime.UtcNow;

        var resetToken = await _db.PasswordResetTokens
            .Include(t => t.User)
            .FirstOrDefaultAsync(t =>
                t.TokenHash == tokenHash &&
                t.UsedAt == null &&
                t.ExpiresAt > now);

        if (resetToken == null || resetToken.User == null)
            return BadRequest(new
            {
                message = "Invalid or expired reset link."
            });

        // Where the request started comes from the token (see SettingsTokenPrefix), never from anything else the browser sends.
        var fromSettings = req.Token.StartsWith(SettingsTokenPrefix, StringComparison.Ordinal);
        var signedIn = User.Identity?.IsAuthenticated == true;
        // A Settings token only works for the account it was made for (nothing changed if someone else is signed in).
        if (fromSettings && signedIn && User.FindFirstValue(ClaimTypes.NameIdentifier) != resetToken.UserId.ToString())
            return BadRequest(new { message = "Invalid or expired reset link." });
        // A Settings reset keeps this browser signed in. A Log In reset signs everyone out, as before.
        var keepSignedIn = fromSettings && signedIn;

        // Update the user's password using BCrypt.
        resetToken.User.PasswordHash =
            BCrypt.Net.BCrypt.HashPassword(req.NewPassword);

        // A reset also signs out every browser that was logged in with the old password.
        resetToken.User.PasswordChangedAt = now;

        // Mark this token as used.
        resetToken.UsedAt = now;

        // Invalidate all other unused reset tokens for this user.
        var otherTokens = await _db.PasswordResetTokens
            .Where(t => t.UserId == resetToken.UserId &&
                        t.Id != resetToken.Id &&
                        t.UsedAt == null)
            .ToListAsync();

        foreach (var token in otherTokens)
            token.UsedAt = now;

        await _db.SaveChangesAsync();

        // The new password stamp signed out every browser, including this one. Give this browser a fresh cookie
        // (keeping "Remember me" as it was) so the person stays signed in on the Settings page.
        if (keepSignedIn)
        {
            var current = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            await HttpContext.SignInAsync(
                CookieAuthenticationDefaults.AuthenticationScheme,
                AuthCookie.Principal(resetToken.User),
                new AuthenticationProperties { IsPersistent = current.Properties?.IsPersistent ?? false });
        }

        return Ok(new
        {
            message = "Your password has been reset successfully.",
            signedIn = keepSignedIn,
            // Only a Settings reset says where to go back to: after Log In (session ended), the person returns to Security.
            returnTo = fromSettings ? SecurityPath(resetToken.User.Role) : null
        });
    }

    [EnableRateLimiting("auth")]
    [HttpPost("verify")]
    public async Task<IActionResult> VerifyEmail(VerifyEmailRequest req)
    {
        if (string.IsNullOrWhiteSpace(req?.Token))
            return BadRequest(new { message = "Invalid verification link." });

        // Hash the received token to find its database record.
        var tokenHash = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(req.Token.Trim())));

        var record = await _db.EmailVerificationTokens
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.TokenHash == tokenHash);

        if (record == null)
            return BadRequest(new { message = "Invalid verification link." });

        if (record.UsedAt != null)
            return Conflict(new { message = "This verification link has already been used." });

        var now = DateTime.UtcNow;

        if (record.ExpiresAt <= now)
            return StatusCode(StatusCodes.Status410Gone,
                new { message = "This verification link has expired." });

        await using var dbTx = await _db.Database.BeginTransactionAsync();

        // Claim the token atomically: only one request can flip UsedAt from null,
        // so concurrent requests with the same token cannot both succeed.
        var claimed = await _db.EmailVerificationTokens
            .Where(t => t.Id == record.Id && t.UsedAt == null && t.ExpiresAt > now)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.UsedAt, (DateTime?)now));

        if (claimed == 0)
        {
            await dbTx.RollbackAsync();
            return Conflict(new { message = "This verification link has already been used." });
        }

        int updatedUsers;
        var pendingEmail = record.PendingEmail;
        if (pendingEmail != null)
        {
            // This link confirms a NEW address chosen in Edit Profile: only now does it replace the account's email.
            if (await _db.Users.AnyAsync(u => u.Email == pendingEmail && u.Id != record.UserId))
            {
                await dbTx.RollbackAsync();
                return StatusCode(StatusCodes.Status422UnprocessableEntity,
                    new { message = "This email address is already used by another account." });
            }
            updatedUsers = await _db.Users
                .Where(u => u.Id == record.UserId)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(u => u.Email, pendingEmail)
                    .SetProperty(u => u.EmailVerified, true)
                    .SetProperty(u => u.EmailVerifiedAt, (DateTime?)now));
        }
        else
        {
            updatedUsers = await _db.Users
                .Where(u => u.Id == record.UserId)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(u => u.EmailVerified, true)
                    .SetProperty(u => u.EmailVerifiedAt, (DateTime?)now));
        }

        if (updatedUsers == 0)
        {
            await dbTx.RollbackAsync();
            return BadRequest(new { message = "Invalid verification link." });
        }

        await dbTx.CommitAsync();

        // No authentication cookie is issued: the user signs in normally afterwards.
        return Ok(new
        {
            message = pendingEmail != null
                ? "Your new email address is confirmed. Use it the next time you sign in."
                : "Your email has been verified. You can now sign in."
        });
    }

    [EnableRateLimiting("auth")]
    [HttpPost("resend-verification")]
    public async Task<IActionResult> ResendVerification(ResendVerificationRequest req)
    {
        // Same response for unknown, already verified, eligible, or failed sends.
        const string responseMessage =
            "If your email is registered and not yet verified, we have sent a new verification email.";

        var email = (req?.Email ?? "").Trim().ToLowerInvariant();

        if (string.IsNullOrWhiteSpace(email))
            return Ok(new { message = responseMessage });

        // Per-email limit (same answer as always, nothing sent), see ForgotPassword.
        if (!_limiter.TryHit("resend:" + email, MailLimit, MailWindow))
            return Ok(new { message = responseMessage });

        try
        {
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == email);

            if (user == null || user.EmailVerified)
                return Ok(new { message = responseMessage });

            var now = DateTime.UtcNow;

            // Invalidate previous unused verification tokens.
            var oldTokens = await _db.EmailVerificationTokens
                .Where(t => t.UserId == user.Id &&
                            t.UsedAt == null &&
                            t.ExpiresAt > now)
                .ToListAsync();

            foreach (var oldToken in oldTokens)
                oldToken.UsedAt = now;

            // Generate a secure random token (sent to the user, never stored).
            var rawToken = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));

            // Store only the SHA-256 hash.
            var tokenHash = Convert.ToHexString(
                SHA256.HashData(Encoding.UTF8.GetBytes(rawToken)));

            _db.EmailVerificationTokens.Add(new EmailVerificationToken
            {
                UserId = user.Id,
                TokenHash = tokenHash,
                ExpiresAt = now.AddMinutes(30),
                CreatedAt = now
            });

            // Old tokens are invalidated and the new one is saved together.
            await _db.SaveChangesAsync();

            await _emailService.SendVerificationAsync(user.Email, rawToken);
        }
        catch (Exception ex)
        {
            // Never expose internal errors, and never log the raw token.
            _logger.LogError(ex, "Failed to resend the verification email.");
        }

        return Ok(new { message = responseMessage });
    }

}