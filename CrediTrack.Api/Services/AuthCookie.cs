using System.Security.Claims;
using CrediTrack.Api.Models;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace CrediTrack.Api.Services;

// Builds the login cookie's identity. The cookie carries a "password stamp" (when the password last changed).
// If the password changes, the stamp in every older cookie no longer matches, so those sessions stop working.
public static class AuthCookie
{
    public const string StampClaim = "creditrack:pwd";

    // Whole seconds, so the value is the same before and after a round trip through PostgreSQL (which drops sub-microsecond ticks).
    public static long Stamp(DateTime? passwordChangedAt) =>
        passwordChangedAt is DateTime d
            ? new DateTimeOffset(DateTime.SpecifyKind(d, DateTimeKind.Utc)).ToUnixTimeSeconds()
            : 0;

    public static ClaimsPrincipal Principal(User u)
    {
        var identity = new ClaimsIdentity(new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, u.Id.ToString()),
            new(ClaimTypes.Name, u.FullName),
            new(ClaimTypes.Role, u.Role),
            new(StampClaim, Stamp(u.PasswordChangedAt).ToString())
        }, CookieAuthenticationDefaults.AuthenticationScheme);
        return new ClaimsPrincipal(identity);
    }
}
