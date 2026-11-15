namespace CrediTrack.Api.Services;

// Contact details and names shown on the landing page footer, Help & Support, Terms and Conditions and Privacy Policy.
// Everything comes from the "Site" section of appsettings.json (or environment variables such as Site__SupportEmail),
// so the real details can be filled in without changing any page.
public class SiteInfo
{
    public string SystemName { get; set; } = "CrediTrack";
    public string Tagline { get; set; } = "Every Credit, On Track.";
    // Who runs the system: shown in the Terms and the Privacy Policy ("operated by ...")
    public string OperatorName { get; set; } = "CrediTrack";
    public string SupportEmail { get; set; } = "support@creditrack.test";
    public string SupportPhone { get; set; } = "0917 000 0000";
    public string SupportHours { get; set; } = "Mon-Sat, 8:00 AM - 6:00 PM";
    public string? Address { get; set; }
    // Shown at the top of the Terms and Privacy Policy
    public string LastUpdated { get; set; } = "November 14, 2026";

    // tel: link ("0917 000 0000" -> "+639170000000")
    public string PhoneHref
    {
        get
        {
            var digits = new string((SupportPhone ?? "").Where(c => char.IsDigit(c) || c == '+').ToArray());
            if (digits.StartsWith("09")) digits = "+63" + digits[1..];
            return digits;
        }
    }

    // True while the contact details are still the sample ones (an address ending in ".test"), so the pages can say so.
    public bool IsSample => (SupportEmail ?? "").Trim().EndsWith(".test", StringComparison.OrdinalIgnoreCase);
}
