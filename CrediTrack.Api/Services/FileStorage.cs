using System.Text.RegularExpressions;
using CrediTrack.Api.Data;
using CrediTrack.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace CrediTrack.Api.Services;

// Saves uploaded pictures (profile photos, proof of payment) in the DATABASE (table StoredFiles), so they are not lost when the
// host restarts or redeploys the app (many cloud hosts wipe the app's folders). Users.PhotoPath / PaymentRequests.ProofPath keep
// the short path, like "profiles/3f2a...c1.jpg" or "proofs/9b1e...7d.png", which is the key of the row in StoredFiles.
// StorePaymentAccounts.QrPath does the same for a store's payment QR ("qrs/<32 hex>.png").
//
// Pictures are served only through GET /api/files/... (FilesController), which checks who is asking.
// The old folder (appsettings "Uploads": { "Path": ... }, default App_Data/uploads) is only READ once at startup to move
// pictures saved by the previous version into the database (ImportDiskFilesAsync).
public record StoredPicture(byte[] Data, string ContentType);

public class FileStorage
{
    public const string ProfilesFolder = "profiles";
    public const string ProofsFolder = "proofs";
    public const string QrsFolder = "qrs";        // QR pictures of a store's GCash / Maya / Bank accounts
    public const string UrlPrefix = "/api/files/";

    private static readonly Regex DataUrlRx = new(@"^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$", RegexOptions.Compiled);
    private static readonly Regex PathRx = new(@"^(profiles|proofs|qrs)/[0-9a-f]{32}\.(jpg|png|webp)$", RegexOptions.Compiled);

    private readonly string _root;
    private readonly IServiceScopeFactory _scopes;

    public FileStorage(IConfiguration config, IWebHostEnvironment env, IServiceScopeFactory scopes)
    {
        _scopes = scopes;
        var configured = config["Uploads:Path"];
        if (string.IsNullOrWhiteSpace(configured)) configured = Path.Combine("App_Data", "uploads");
        _root = Path.GetFullPath(Path.IsPathRooted(configured) ? configured : Path.Combine(env.ContentRootPath, configured));
    }

    // A stored path is only valid when it has exactly the shape this class creates (no "..", no slashes beyond the folder).
    public static bool IsStoredPath(string? path) => !string.IsNullOrEmpty(path) && PathRx.IsMatch(path);

    // What the pages receive instead of the old base64 text: "/api/files/profiles/<name>". "" when there is no picture.
    public static string Url(string? path) => IsStoredPath(path) ? UrlPrefix + path : "";

    // The full file location in the OLD uploads folder (only used to import old files), or null when the path is not one of ours.
    private string? Resolve(string? path)
    {
        if (!IsStoredPath(path)) return null;
        var full = Path.GetFullPath(Path.Combine(_root, path!.Replace('/', Path.DirectorySeparatorChar)));
        return full.StartsWith(_root, StringComparison.Ordinal) ? full : null;
    }

    public static string ContentType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".webp" => "image/webp",
        _ => "image/jpeg"
    };

    // Decodes a "data:image/...;base64,..." text, checks the bytes really are that kind of picture, writes the file
    // and returns the path to keep in the database. Throws ArgumentException when the picture is not valid.
    public async Task<string> SaveDataUrlAsync(string folder, string dataUrl)
    {
        var m = DataUrlRx.Match(dataUrl ?? "");
        if (!m.Success) throw new ArgumentException("Not a JPG, PNG or WebP picture.");
        var kind = m.Groups[1].Value;
        byte[] bytes;
        try { bytes = Convert.FromBase64String(m.Groups[2].Value); }
        catch (FormatException) { throw new ArgumentException("The picture could not be read."); }
        if (!MatchesKind(bytes, kind)) throw new ArgumentException("The file is not really a " + kind.ToUpperInvariant() + " picture.");

        var ext = kind == "jpeg" ? "jpg" : kind;
        var relative = folder + "/" + Guid.NewGuid().ToString("N") + "." + ext;
        if (!IsStoredPath(relative)) throw new ArgumentException("Bad folder.");

        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        db.StoredFiles.Add(new StoredFile { Path = relative, ContentType = ContentType(relative), Data = bytes, CreatedAt = DateTime.UtcNow });
        await db.SaveChangesAsync();
        return relative;
    }

    // Removes the picture of a stored path (does nothing when it is empty, unknown or already gone).
    public void Delete(string? path)
    {
        if (!IsStoredPath(path)) return;
        try
        {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDb>();
            db.StoredFiles.Where(f => f.Path == path).ExecuteDelete();
        }
        catch (Exception) { /* a leftover picture is harmless */ }
    }

    // The picture bytes and type for a stored path, or null when there is none.
    public async Task<StoredPicture?> ReadAsync(string? path)
    {
        if (!IsStoredPath(path)) return null;
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        var row = await db.StoredFiles.AsNoTracking().Where(f => f.Path == path)
            .Select(f => new { f.Data, f.ContentType }).FirstOrDefaultAsync();
        return row == null ? null : new StoredPicture(row.Data, row.ContentType);
    }

    // Magic bytes: the file content must match what the data URL claims.
    private static bool MatchesKind(byte[] b, string kind) => kind switch
    {
        "jpeg" => b.Length > 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF,
        "png" => b.Length > 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47,
        "webp" => b.Length > 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P',
        _ => false
    };

    // One-time upgrade for databases that still hold base64 text in the picture columns (from before this change):
    // each such picture is saved (now in the database) and the column is replaced by its path. Safe to run on every start.
    public async Task<int> MigrateLegacyAsync(AppDb db)
    {
        var moved = 0;

        var users = await db.Users.Where(u => u.PhotoPath != null && u.PhotoPath.StartsWith("data:")).ToListAsync();
        foreach (var u in users)
        {
            try { u.PhotoPath = await SaveDataUrlAsync(ProfilesFolder, u.PhotoPath!); moved++; }
            catch (ArgumentException) { u.PhotoPath = null; }   // an unreadable old picture is dropped, the person can upload a new one
        }

        var requests = await db.PaymentRequests.IgnoreQueryFilters().Where(r => r.ProofPath != null && r.ProofPath.StartsWith("data:")).ToListAsync();
        foreach (var r in requests)
        {
            try { r.ProofPath = await SaveDataUrlAsync(ProofsFolder, r.ProofPath!); moved++; }
            catch (ArgumentException) { /* keep the row; the request just shows "proof not available" */ r.ProofPath = null; }
        }

        if (users.Count > 0 || requests.Count > 0) await db.SaveChangesAsync();
        return moved;
    }

    // Pictures saved by the previous version as FILES in the uploads folder are copied into the database once. A picture whose file
    // is gone (for example wiped by the host) and that is not in the database is cleared, so the page shows the initials / "no proof"
    // instead of a broken picture, and the person can upload it again. Safe to run on every start.
    public async Task<int> ImportDiskFilesAsync(AppDb db)
    {
        var imported = 0;
        var known = new HashSet<string>(await db.StoredFiles.Select(f => f.Path).ToListAsync());

        async Task<bool> EnsureAsync(string? path)
        {
            if (!IsStoredPath(path)) return false;
            if (known.Contains(path!)) return true;
            var full = Resolve(path);
            if (full == null || !File.Exists(full)) return false;
            db.StoredFiles.Add(new StoredFile { Path = path!, ContentType = ContentType(path!), Data = await File.ReadAllBytesAsync(full), CreatedAt = DateTime.UtcNow });
            known.Add(path!); imported++;
            return true;
        }

        var users = await db.Users.Where(u => u.PhotoPath != null).ToListAsync();
        foreach (var u in users) if (!await EnsureAsync(u.PhotoPath)) u.PhotoPath = null;

        var requests = await db.PaymentRequests.IgnoreQueryFilters().Where(r => r.ProofPath != null).ToListAsync();
        foreach (var r in requests) if (!await EnsureAsync(r.ProofPath)) r.ProofPath = null;

        await db.SaveChangesAsync();
        return imported;
    }
}
