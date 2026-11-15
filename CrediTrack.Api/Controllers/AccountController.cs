using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using CrediTrack.Api.Data;
using CrediTrack.Api.Models;
using CrediTrack.Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Controllers;

// The signed-in person's own account (owner or customer): profile, password, notification choices.
[ApiController]
[Route("api/account")]
[Authorize]
public class AccountController : ControllerBase
{
    private readonly AppDb _db;
    private readonly FileStorage _files;
    private readonly IEmailService _email;
    private readonly ILogger<AccountController> _logger;
    private readonly AttemptLimiter _limiter;
    public AccountController(AppDb db, FileStorage files, IEmailService email, ILogger<AccountController> logger, AttemptLimiter limiter)
    { _db = db; _files = files; _email = email; _logger = logger; _limiter = limiter; }

    // Wrong "current password" answers per account: 5 per 15 minutes, shared by Edit Profile (email change) and
    // Change Password, so a stolen login cookie cannot be used to guess the password. The right password clears the count.
    private const int PasswordTries = 5;
    private static readonly TimeSpan PasswordWindow = TimeSpan.FromMinutes(15);
    private static string PasswordKey(User u) => "pwcheck:" + u.Id;
    private bool PasswordLocked(User u) => _limiter.Count(PasswordKey(u), PasswordWindow) >= PasswordTries;
    private IActionResult TooManyPasswordTries() => StatusCode(StatusCodes.Status429TooManyRequests,
        new { field = "currentPassword", message = "Too many wrong passwords. Please wait 15 minutes and try again." });

    // CurrentPassword is only needed (and only checked) when the email address is being changed.
    public record ProfileRequest(string? FullName, string? Email, string? ContactNumber, string? Photo, string? CurrentPassword = null);
    public record PasswordRequest(string? CurrentPassword, string? NewPassword, string? ConfirmPassword);

    private async Task<User?> Me()
    {
        var id = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        return await _db.Users.FindAsync(id);
    }

    // Signs the current browser in again with a fresh cookie. Keeps "Remember me" as it was.
    private async Task RenewCookie(User user)
    {
        var current = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme,
            AuthCookie.Principal(user), new AuthenticationProperties { IsPersistent = current.Properties?.IsPersistent ?? false });
    }

    // pendingEmail: a new address waiting for its confirmation link (the saved email has NOT changed yet)
    private async Task<object> Dto(User u, string? pendingEmail = null, bool pendingEmailSent = false)
    {
        var store = u.Role == "owner" ? await _db.Stores.FirstOrDefaultAsync(s => s.OwnerId == u.Id) : null;
        return new
        {
            id = u.Id, role = u.Role, fullName = u.FullName, email = u.Email, contactNumber = u.ContactNumber,
            customerCode = u.CustomerCode, storeName = store?.Name, storeCode = store?.StoreCode,
            memberSince = u.CreatedAt, passwordChangedAt = u.PasswordChangedAt, photo = FileStorage.Url(u.PhotoPath),
            emailChangePending = pendingEmail != null, pendingEmail, pendingEmailSent
        };
    }

    // PUT /api/account/profile { fullName, email, contactNumber, photo, currentPassword }
    // Changing the EMAIL needs the current password (a stolen login cookie alone cannot take the account over through
    // "forgot password") and does not switch the address at once: the new address gets a confirmation link, and
    // Users.Email only changes when that link is opened (AuthController.VerifyEmail). Until then the old address keeps working.
    [EnableRateLimiting("auth")]   // the password check must not be a free guessing tool
    [HttpPut("profile")]
    public async Task<IActionResult> UpdateProfile(ProfileRequest req)
    {
        var user = await Me();
        if (user == null) return Unauthorized();

        var name = string.Join(" ", (req.FullName ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries));
        if (name.Length < 2 || name.Length > 80 || !Validation.PlainText(name))
            return BadRequest(new { field = "fullName", message = "Enter your full name (2 to 80 characters, no < or > symbols)." });
        var email = (req.Email ?? "").Trim().ToLowerInvariant();
        if (!Validation.Email(email))
            return BadRequest(new { field = "email", message = "Enter a valid email address." });
        if (!Validation.Mobile(req.ContactNumber, out var phone))
            return BadRequest(new { field = "contactNumber", message = "Enter a valid mobile number, like 0917 123 4567." });
        var emailChanged = !string.Equals(email, user.Email, StringComparison.OrdinalIgnoreCase);
        if (emailChanged)
        {
            if (PasswordLocked(user)) return TooManyPasswordTries();
            if (string.IsNullOrEmpty(req.CurrentPassword) || !BCrypt.Net.BCrypt.Verify(req.CurrentPassword, user.PasswordHash))
            {
                if (!string.IsNullOrEmpty(req.CurrentPassword)) _limiter.Record(PasswordKey(user));
                return BadRequest(new { field = "currentPassword", message = "Enter your current password to change your email address." });
            }
            _limiter.Clear(PasswordKey(user));
            if (await _db.Users.AnyAsync(u => u.Email == email && u.Id != user.Id))
                return Conflict(new { field = "email", message = "This email is already registered." });
        }

        // Photo: not sent (null) or sent back as its own /api/files URL keeps the saved one, "" removes it,
        // otherwise it must be a small jpg/png/webp data URL. The picture is saved as a FILE; the database keeps only its path.
        string? oldPhoto = null, newPhoto = null;
        if (req.Photo != null && !req.Photo.StartsWith(FileStorage.UrlPrefix))
        {
            if (req.Photo.Length == 0) { oldPhoto = user.PhotoPath; user.PhotoPath = null; }
            else if (!Validation.Photo(req.Photo))
                return BadRequest(new { field = "photo", message = "Choose a JPG, PNG or WebP image (it is shrunk automatically)." });
            else
            {
                try { newPhoto = await _files.SaveDataUrlAsync(FileStorage.ProfilesFolder, req.Photo); }
                catch (ArgumentException) { return BadRequest(new { field = "photo", message = "Choose a JPG, PNG or WebP image (it is shrunk automatically)." }); }
                oldPhoto = user.PhotoPath;
                user.PhotoPath = newPhoto;
            }
        }

        user.FullName = name;
        user.ContactNumber = phone;   // the email is NOT changed here: see the note above the action

        string? pendingEmail = null, rawToken = null;
        if (emailChanged)
        {
            var now = DateTime.UtcNow;
            // Any earlier unused link (an older address change) stops working
            var older = await _db.EmailVerificationTokens
                .Where(t => t.UserId == user.Id && t.UsedAt == null && t.ExpiresAt > now).ToListAsync();
            foreach (var oldToken in older) oldToken.UsedAt = now;

            rawToken = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));   // sent to the new address, never stored
            _db.EmailVerificationTokens.Add(new EmailVerificationToken
            {
                UserId = user.Id,
                TokenHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawToken))),
                PendingEmail = email,
                ExpiresAt = now.AddMinutes(30),
                CreatedAt = now
            });
            pendingEmail = email;
        }

        try { await _db.SaveChangesAsync(); }
        catch { _files.Delete(newPhoto); throw; }
        _files.Delete(oldPhoto);   // the replaced / removed picture is no longer needed

        var sent = false;
        if (rawToken != null)
        {
            try { await _email.SendVerificationAsync(email, rawToken, isEmailChange: true); sent = true; }
            catch (Exception ex) { _logger.LogError(ex, "Failed to send the email-change confirmation for user {UserId}.", user.Id); }
        }

        // The cookie carries the name, so it is renewed with the new one
        await RenewCookie(user);

        return Ok(await Dto(user, pendingEmail, sent));
    }

    // POST /api/account/change-password { currentPassword, newPassword, confirmPassword }
    [EnableRateLimiting("auth")]   // the password check must not be a free guessing tool
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword(PasswordRequest req)
    {
        var user = await Me();
        if (user == null) return Unauthorized();

        if (PasswordLocked(user)) return TooManyPasswordTries();
        if (string.IsNullOrEmpty(req.CurrentPassword) || !BCrypt.Net.BCrypt.Verify(req.CurrentPassword, user.PasswordHash))
        {
            if (!string.IsNullOrEmpty(req.CurrentPassword)) _limiter.Record(PasswordKey(user));
            return BadRequest(new { field = "currentPassword", message = "Your current password is incorrect." });
        }
        _limiter.Clear(PasswordKey(user));
        if (!Validation.Password(req.NewPassword))
            return BadRequest(new { field = "newPassword", message = Validation.PasswordMessage });
        if (req.NewPassword == req.CurrentPassword)
            return BadRequest(new { field = "newPassword", message = "Choose a password that is different from your current one." });
        if (req.NewPassword != req.ConfirmPassword)
            return BadRequest(new { field = "confirmPassword", message = "The passwords do not match." });

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.NewPassword);
        user.PasswordChangedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Every other signed-in browser (an old cookie, a stolen one) is now rejected because its password stamp no
        // longer matches. This browser gets a new cookie so the person stays signed in here.
        await RenewCookie(user);
        return Ok(new { changed = true, passwordChangedAt = user.PasswordChangedAt });
    }

    // The person's choices: one row per key in NotificationPreferences (a key with no row means ON)
    private Task<Dictionary<string, bool>> ReadPrefs(int userId) =>
        _db.NotificationPreferences.Where(p => p.UserId == userId).ToDictionaryAsync(p => p.PrefKey, p => p.IsEnabled);

    // GET /api/account/notification-preferences -> { preferences: { key: true/false } }
    [HttpGet("notification-preferences")]
    public async Task<IActionResult> GetPrefs()
    {
        var user = await Me();
        return user == null ? Unauthorized() : Ok(new { preferences = await ReadPrefs(user.Id) });
    }

    // PUT /api/account/notification-preferences { "paymentUpdates": true, ... } : only the keys sent change
    [HttpPut("notification-preferences")]
    public async Task<IActionResult> SavePrefs(Dictionary<string, bool>? prefs)
    {
        var user = await Me();
        if (user == null) return Unauthorized();
        if (prefs == null) return BadRequest(new { message = "Send the notification choices as on/off values." });

        var current = await ReadPrefs(user.Id);
        foreach (var (key, value) in prefs)
        {
            if (!Regex.IsMatch(key, "^[a-zA-Z][a-zA-Z0-9_]{0,40}$"))
                return BadRequest(new { message = "\"" + key + "\" is not a valid setting name." });
            current[key] = value;
        }
        if (current.Count > 20) return BadRequest(new { message = "Too many settings." });

        var rows = await _db.NotificationPreferences.Where(p => p.UserId == user.Id).ToListAsync();
        foreach (var (key, value) in current)
        {
            var row = rows.FirstOrDefault(r => r.PrefKey == key);
            if (row == null) _db.NotificationPreferences.Add(new NotificationPreference { UserId = user.Id, PrefKey = key, IsEnabled = value });
            else row.IsEnabled = value;
        }
        await _db.SaveChangesAsync();
        return Ok(new { preferences = current });
    }
}
