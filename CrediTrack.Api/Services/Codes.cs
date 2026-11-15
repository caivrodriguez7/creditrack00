using System.Security.Cryptography;

namespace CrediTrack.Api.Services;

// Makes the public codes (Customer Code CT-CUS-123456 and Store Code CT-AB12CD).
// These codes are how one account finds another (an owner types a Customer Code to send a link request, a customer types
// a Store Code to ask to join), so they must not be guessable from the codes handed out before them.
// Random.Shared is a fast general purpose generator, its next number can be predicted from earlier ones.
// RandomNumberGenerator uses the operating system's cryptographic generator and has no modulo bias.
public static class Codes
{
    public const string StoreAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no I, O, 0 or 1 (easy to mix up)

    // CT-CUS-123456: always six digits, never starting with 0 (the format every page checks with \d{6})
    public static string NewCustomerCode() =>
        "CT-CUS-" + RandomNumberGenerator.GetInt32(100000, 1000000).ToString();

    // CT-AB12CD
    public static string NewStoreCode()
    {
        Span<char> part = stackalloc char[6];
        for (var i = 0; i < part.Length; i++)
            part[i] = StoreAlphabet[RandomNumberGenerator.GetInt32(StoreAlphabet.Length)];
        return "CT-" + new string(part);
    }
}
