using System.Text.RegularExpressions;

namespace CrediTrack.Api.Services;

// Small input rules shared by several controllers
public static class Validation
{
    // A profile photo as it arrives from the page: a jpg/png/webp data URL (the server then saves it as a file, see FileStorage). The page shrinks pictures to 256 px (about 10-30 KB), so 300,000 characters is generous.
    public static bool Photo(string? v) =>
        !string.IsNullOrEmpty(v) && v.Length <= 300_000
        && Regex.IsMatch(v, @"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$");

    // Names and other short free text: no "<", ">" or control characters (no HTML can be stored). The pages also escape
    // everything they show; this is the second layer. null / empty is fine here (each caller checks the length it needs).
    public static bool PlainText(string? v) =>
        string.IsNullOrEmpty(v) || !v.Any(c => c == '<' || c == '>' || char.IsControl(c));

    // Empty is allowed (-> null). Otherwise a Philippine mobile number: 09171234567, 0917 123 4567 or +63 917 123 4567.
    public static bool Mobile(string? raw, out string? phone)
    {
        phone = null;
        var digits = new string((raw ?? "").Where(char.IsDigit).ToArray());
        if (digits.Length == 0) return true;
        if (digits.Length == 12 && digits.StartsWith("63")) digits = "0" + digits.Substring(2);
        if (!Regex.IsMatch(digits, @"^09\d{9}$")) return false;
        phone = digits;
        return true;
    }

    public static bool Email(string? email) =>
        !string.IsNullOrWhiteSpace(email) && email.Length <= 120 && Regex.IsMatch(email, @"^[^@\s]+@[^@\s]+\.[^@\s]+$");

    // Same rules as the register pages: 8+ characters, upper, lower, number, special
    public static bool Password(string? p) =>
        !string.IsNullOrEmpty(p) && p.Length >= 8 && p.Length <= 100
        && Regex.IsMatch(p, "[A-Z]") && Regex.IsMatch(p, "[a-z]")
        && Regex.IsMatch(p, "[0-9]") && Regex.IsMatch(p, "[^A-Za-z0-9\\s]");

    public const string PasswordMessage =
        "Password must be 8+ characters with an uppercase letter, a lowercase letter, a number and a special character.";

    // "ct-ab12cd" / "AB12CD" -> "CT-AB12CD"
    public static string StoreCode(string? input)
    {
        var s = new string((input ?? "").Where(c => !char.IsWhiteSpace(c)).ToArray()).ToUpperInvariant();
        return Regex.IsMatch(s, "^[A-Z0-9]{6}$") ? "CT-" + s : s;
    }
}
