using System.Security.Claims;
using CrediTrack.Api.Data;
using CrediTrack.Api.Models;
using CrediTrack.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Controllers;

// Settings > Store Information > Payment Accounts: the GCash / Maya / Bank details (and QR picture) the owner shows to customers.
// One account per method. The QR picture is kept in StoredFiles (see FileStorage), the row keeps only its path.
[ApiController]
[Route("api/owner/store/payment-accounts")]
[Authorize(Roles = "owner")]
public class OwnerPaymentAccountsController : ControllerBase
{
    private readonly AppDb _db;
    private readonly FileStorage _files;
    public OwnerPaymentAccountsController(AppDb db, FileStorage files) { _db = db; _files = files; }

    // qr: a small jpg/png/webp data URL (the page shrinks it). Not sent (null) keeps the saved QR, removeQr = true deletes it.
    public record PaymentAccountRequest(string? AccountName, string? AccountNumber, string? BankName, string? Qr, bool RemoveQr);

    private const int MaxQrLength = 1_500_000;   // characters of the data URL (about 1.1 MB of picture)

    private async Task<Store?> MyStore()
    {
        var userId = int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
        return await _db.Stores.FirstOrDefaultAsync(s => s.OwnerId == userId);
    }

    private static object Dto(string method, StorePaymentAccount? a) => new
    {
        method,
        configured = a != null,
        accountName = a?.AccountName ?? "",
        accountNumber = a?.AccountNumber ?? "",
        bankName = a?.BankName ?? "",
        qrUrl = FileStorage.Url(a?.QrPath),
        updatedAt = a?.UpdatedAt
    };

    private static string Collapse(string? text) =>
        string.Join(" ", (text ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries));

    // Digits, spaces, "-" and "+" only, with 7 to 20 digits (a GCash / Maya mobile number or a bank account number)
    private static bool ValidNumber(string number)
    {
        if (number.Length == 0 || number.Length > 30) return false;
        var digits = 0;
        foreach (var c in number)
        {
            if (c >= '0' && c <= '9') digits++;
            else if (c != ' ' && c != '-' && c != '+') return false;
        }
        return digits >= 7 && digits <= 20;
    }

    // GET /api/owner/store/payment-accounts : always three entries (gcash, maya, bank); configured = false when not set yet
    [HttpGet]
    public async Task<IActionResult> List()
    {
        var store = await MyStore();
        if (store == null) return NotFound(new { message = "No store found for this account." });
        var rows = await _db.StorePaymentAccounts.AsNoTracking().Where(a => a.StoreId == store.Id).ToListAsync();
        return Ok(new { accounts = StorePaymentAccount.Methods.Select(m => Dto(m, rows.FirstOrDefault(a => a.Method == m))).ToList() });
    }

    // PUT /api/owner/store/payment-accounts/{gcash|maya|bank} : creates the account or replaces its details
    [HttpPut("{method}")]
    public async Task<IActionResult> Save(string method, PaymentAccountRequest req)
    {
        method = (method ?? "").ToLowerInvariant();
        if (!StorePaymentAccount.Methods.Contains(method)) return NotFound(new { message = "Unknown payment method." });
        var store = await MyStore();
        if (store == null) return NotFound(new { message = "No store found for this account." });

        // Check everything first, so nothing is saved when something is wrong
        var name = Collapse(req.AccountName);
        if (name.Length < 2 || name.Length > 60 || !Validation.PlainText(name))
            return BadRequest(new { field = "accountName", message = "Enter the account name (2 to 60 characters, no < or > symbols)." });

        var number = (req.AccountNumber ?? "").Trim();
        if (!ValidNumber(number))
            return BadRequest(new { field = "accountNumber", message = "Enter the account number (7 to 20 digits; spaces and - are fine)." });

        string? bank = null;
        if (method == StorePaymentAccount.Bank)
        {
            bank = Collapse(req.BankName);
            if (bank.Length < 2 || bank.Length > 40 || !Validation.PlainText(bank))
                return BadRequest(new { field = "bankName", message = "Enter the bank name (2 to 40 characters, no < or > symbols)." });
        }

        var qr = req.Qr;
        if (!string.IsNullOrEmpty(qr) && qr.Length > MaxQrLength)
            return BadRequest(new { field = "qr", message = "The QR picture is too large. Choose a smaller picture." });

        string? newQr = null;
        if (!string.IsNullOrEmpty(qr))
        {
            try { newQr = await _files.SaveDataUrlAsync(FileStorage.QrsFolder, qr); }
            catch (ArgumentException) { return BadRequest(new { field = "qr", message = "Choose a JPG, PNG or WebP picture of your QR code." }); }
        }

        var account = await _db.StorePaymentAccounts.FirstOrDefaultAsync(a => a.StoreId == store.Id && a.Method == method);
        if (account == null)
        {
            account = new StorePaymentAccount { StoreId = store.Id, Method = method };
            _db.StorePaymentAccounts.Add(account);
        }

        string? oldQr = null;
        if (newQr != null) { oldQr = account.QrPath; account.QrPath = newQr; }
        else if (req.RemoveQr) { oldQr = account.QrPath; account.QrPath = null; }

        account.AccountName = name;
        account.AccountNumber = number;
        account.BankName = bank;
        account.UpdatedAt = DateTime.UtcNow;

        try { await _db.SaveChangesAsync(); }
        catch (DbUpdateException)
        {
            _files.Delete(newQr);   // the new picture was not used, do not leave it behind
            return Conflict(new { message = "Could not save the payment account. Please try again." });
        }

        _files.Delete(oldQr);       // the replaced / removed QR picture is no longer needed
        return Ok(Dto(method, account));
    }

    // DELETE /api/owner/store/payment-accounts/{gcash|maya|bank} : removes the account and its QR picture (nothing to remove is fine)
    [HttpDelete("{method}")]
    public async Task<IActionResult> Remove(string method)
    {
        method = (method ?? "").ToLowerInvariant();
        if (!StorePaymentAccount.Methods.Contains(method)) return NotFound(new { message = "Unknown payment method." });
        var store = await MyStore();
        if (store == null) return NotFound(new { message = "No store found for this account." });

        var account = await _db.StorePaymentAccounts.FirstOrDefaultAsync(a => a.StoreId == store.Id && a.Method == method);
        if (account != null)
        {
            var oldQr = account.QrPath;
            _db.StorePaymentAccounts.Remove(account);
            await _db.SaveChangesAsync();
            _files.Delete(oldQr);
        }
        return Ok(Dto(method, null));
    }
}
