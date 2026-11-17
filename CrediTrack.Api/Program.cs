using CrediTrack.Api.Services;
using System.Security.Claims;
using System.Threading.RateLimiting;
using CrediTrack.Api.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore; 

var builder = WebApplication.CreateBuilder(args);

// Database. The connection string is a secret, so it is NOT kept in appsettings.json. Set it with
//   dotnet user-secrets set "ConnectionStrings:Default" "Host=...;Database=...;Username=...;Password=..."   (local), or
//   the environment variable ConnectionStrings__Default (host). A host that only gives DATABASE_URL (postgres://...) also works.
var connectionString = builder.Configuration.GetConnectionString("Default");
if (string.IsNullOrWhiteSpace(connectionString))
    connectionString = DatabaseUrl.ToConnectionString(Environment.GetEnvironmentVariable("DATABASE_URL"));
if (string.IsNullOrWhiteSpace(connectionString))
    throw new InvalidOperationException(
        "The database is not configured. Set ConnectionStrings:Default (local: dotnet user-secrets set \"ConnectionStrings:Default\" \"Host=localhost;Database=creditrack;Username=postgres;Password=...\"; " +
        "host: environment variable ConnectionStrings__Default or DATABASE_URL). See \"First-time setup\" in the README.");
builder.Services.AddDbContext<AppDb>(options => options.UseNpgsql(connectionString));

// The screens are a mix: the Store Owner and Customer screens are ASP.NET Core MVC (Controllers/OwnerController.cs + Views/Owner,
// Controllers/CustomerController.cs + Views/Customer); the public pages (welcome, login, register, email links, privacy, terms)
// stay Razor Pages (Pages/*.cshtml); the JSON API stays in Controllers/ (api/...)
// Page guard: the MVC controllers carry [Authorize(Policy = "OwnerOnly")] / [Authorize(Policy = "CustomerOnly")], so the page itself
// (not only the API behind it) cannot be opened without logging in. Every Razor Page (welcome, login, register,
// privacy, terms ...) stays public.
builder.Services.AddRazorPages();
builder.Services.AddControllersWithViews()
    .AddJsonOptions(options =>
        options.JsonSerializerOptions.NumberHandling =
            System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString)
    // Bad input answers { message } like every other error, so the frontend can show it
    .ConfigureApiBehaviorOptions(options =>
        options.InvalidModelStateResponseFactory = ctx =>
        {
            var first = ctx.ModelState.Where(e => e.Value != null && e.Value.Errors.Count > 0)
                .Select(e => e.Value!.Errors[0].ErrorMessage).FirstOrDefault();
            return new BadRequestObjectResult(new
            {
                message = string.IsNullOrWhiteSpace(first) || first.Length > 160
                    ? "Check the information you entered and try again." : first
            });
        });
builder.Services.AddOpenApi();

// Login: an HTTP-only cookie keeps the user signed in
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "creditrack.auth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        // Always "Secure" in production: the login cookie is never sent or issued over plain http. Development keeps
        // SameAsRequest so http://localhost:5224 still works.
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
            ? CookieSecurePolicy.SameAsRequest
            : CookieSecurePolicy.Always;
        options.ExpireTimeSpan = TimeSpan.FromDays(7);
        options.SlidingExpiration = true;
        // "Remember me": a persistent login gets an Expires date, a non-persistent one must be a pure session cookie
        // (no Expires, no Max-Age). IsPersistent is set per login in AuthController.SignInUser.
        options.Events.OnSigningIn = ctx =>
        {
            if (!ctx.Properties.IsPersistent)
            {
                ctx.CookieOptions.Expires = null;
                ctx.CookieOptions.MaxAge = null;
            }
            return Task.CompletedTask;
        };
        // The API answers 401/403 (the frontend handles them). A PAGE request is sent to the right screen instead:
        // not signed in -> /login; signed in with the other role -> that user's own home page.
        options.Events.OnRedirectToLogin = ctx =>
        {
            if (ctx.Request.Path.StartsWithSegments("/api")) ctx.Response.StatusCode = 401;
            // A reset link made in Settings opened where nobody is signed in: use the normal Reset Password page instead
            else if ((ctx.Request.Path.StartsWithSegments("/owner/security") || ctx.Request.Path.StartsWithSegments("/customer/security"))
                     && !string.IsNullOrEmpty(ctx.Request.Query["token"].ToString()))
                ctx.Response.Redirect("/reset-password?token=" + Uri.EscapeDataString(ctx.Request.Query["token"].ToString()));
            else ctx.Response.Redirect("/login");
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = ctx =>
        {
            if (ctx.Request.Path.StartsWithSegments("/api")) ctx.Response.StatusCode = 403;
            else ctx.Response.Redirect(ctx.HttpContext.User.IsInRole("owner") ? "/owner/dashboard"
                : ctx.HttpContext.User.IsInRole("customer") ? "/customer/home" : "/login");
            return Task.CompletedTask;
        };
        // A cookie stops working when its user no longer exists, the role changed, or the password was changed after the
        // cookie was issued (the "creditrack:pwd" stamp no longer matches).
        options.Events.OnValidatePrincipal = async ctx =>
        {
            var idText = ctx.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
            var role = ctx.Principal?.FindFirstValue(ClaimTypes.Role);
            var stampText = ctx.Principal?.FindFirstValue(AuthCookie.StampClaim) ?? "0";   // cookies from before this feature count as 0
            var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDb>();
            var ok = false;
            if (int.TryParse(idText, out var id) && long.TryParse(stampText, out var stamp))
            {
                var row = await db.Users.Where(u => u.Id == id && u.Role == role)
                    .Select(u => new { u.PasswordChangedAt }).FirstOrDefaultAsync();
                ok = row != null && AuthCookie.Stamp(row.PasswordChangedAt) == stamp;
            }
            if (!ok)
            {
                ctx.RejectPrincipal();
                await ctx.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            }
        };
    });
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("OwnerOnly", policy => policy.RequireAuthenticatedUser().RequireRole("owner"));
    options.AddPolicy("CustomerOnly", policy => policy.RequireAuthenticatedUser().RequireRole("customer"));
});

// Slows down password guessing: register / login allow 15 tries per minute per address
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = 429;
    options.OnRejected = async (ctx, ct) =>
    {
        ctx.HttpContext.Response.ContentType = "application/json";
        await ctx.HttpContext.Response.WriteAsync("{\"message\":\"Too many attempts. Please wait a minute and try again.\"}", ct);
    };
    options.AddPolicy("auth", http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 15, Window = TimeSpan.FromMinutes(1) }));
});

// The site and the API are now ONE app on one address, so the browser needs no CORS for them.
// This is only for opening the pages from another address (for example VS Code Live Server while developing).
// In Development the Live Server addresses are allowed by default; in production NO other origin is allowed unless
// you list it: "Cors": { "Origins": [ "https://my-site.example" ] }   (env var: Cors__Origins__0=https://my-site.example)
var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>()
    ?? (builder.Environment.IsDevelopment()
        ? new[] { "http://localhost:5500", "http://127.0.0.1:5500" }
        : Array.Empty<string>());
builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy =>
    {
        if (origins.Length == 0) return;   // no origin allowed: browsers refuse every cross-site call
        policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().AllowCredentials();
    }));

// Contact details and names shown on the landing footer, Help & Support, Terms and Privacy (appsettings "Site" section)
builder.Services.Configure<CrediTrack.Api.Services.SiteInfo>(builder.Configuration.GetSection("Site"));

builder.Services.AddScoped<CrediTrack.Api.Services.IEmailService, CrediTrack.Api.Services.EmailService>();

// Per-email / per-account limits (forgot password, resend verification, password checks). In memory, one instance.
builder.Services.AddSingleton<CrediTrack.Api.Services.AttemptLimiter>();

// Uploaded pictures (profile photos, proof of payment) are saved as files in a folder outside wwwroot; the database keeps only the path
builder.Services.AddSingleton<CrediTrack.Api.Services.FileStorage>();

// Overdue notifications (Part 6B): looks for credits that became overdue and notifies their customers, once per overdue event
builder.Services.AddHostedService<CrediTrack.Api.Services.OverdueNotificationService>();


// Behind a cloud host (Azure, Render, Railway ...) TLS ends at the proxy: trust X-Forwarded-Proto so the app knows the
// request was https (secure login cookie, correct links) and X-Forwarded-For so the per-IP rate limit sees the real visitor.
// WHO may send those headers is set in appsettings / environment variables:
//   "Proxy": { "KnownNetworks": [ "10.0.0.0/8" ],        // CIDR ranges of the host's proxy / load balancer
//              "KnownProxies":  [ "203.0.113.5" ],       // or single proxy addresses
//              "ForwardLimit":  1 }                      // proxies in front of the app (1 = just the host's; 2 = Cloudflare + host)
// Env vars: Proxy__KnownNetworks__0=10.0.0.0/8  Proxy__KnownProxies__0=203.0.113.5  Proxy__ForwardLimit=1
// Nothing listed = the old behaviour (accept the headers from any sender), which still works on every host but means
// the app must not be reachable except through the host's proxy. A startup warning says so.
var proxyNetworks = builder.Configuration.GetSection("Proxy:KnownNetworks").Get<string[]>() ?? Array.Empty<string>();
var proxyAddresses = builder.Configuration.GetSection("Proxy:KnownProxies").Get<string[]>() ?? Array.Empty<string>();
var proxyConfigured = proxyNetworks.Length > 0 || proxyAddresses.Length > 0;
builder.Services.Configure<Microsoft.AspNetCore.Builder.ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor
        | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto;
    // Only the LAST proxy hop is believed by default: the visitor's own (forgeable) X-Forwarded-For entries sit to the
    // left of the address the host's proxy appended, so they are ignored.
    options.ForwardLimit = builder.Configuration.GetValue("Proxy:ForwardLimit", 1);
    options.KnownProxies.Clear();
    options.KnownIPNetworks.Clear();
    if (proxyConfigured)
    {
        foreach (var n in proxyNetworks) options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(n.Trim()));
        foreach (var p in proxyAddresses) options.KnownProxies.Add(System.Net.IPAddress.Parse(p.Trim()));
    }
});

var app = builder.Build();

// Creates / updates the database tables on startup (same as `dotnet ef database update`).
// Turn off with "Database:MigrateOnStartup": false.
if (app.Configuration.GetValue("Database:MigrateOnStartup", true))
{
    using var scope = app.Services.CreateScope();
    var startupDb = scope.ServiceProvider.GetRequiredService<AppDb>();
    startupDb.Database.Migrate();
    // Pictures saved by an older version as base64 text in the database are moved into files (does nothing when there are none)
    var startupFiles = scope.ServiceProvider.GetRequiredService<CrediTrack.Api.Services.FileStorage>();
    await startupFiles.MigrateLegacyAsync(startupDb);
    // Pictures that an earlier version kept as files on disk are moved into the database (pictures are stored there now)
    await startupFiles.ImportDiskFilesAsync(startupDb);
}

// Email: verification and password-reset emails go through SMTP. If a setting is missing the app still runs, but those emails
// fail quietly (the person sees "we could not send the verification email"), so say so loudly here, in every environment.
var missingEmail = new[] { "Email:Smtp:Host", "Email:Smtp:Port", "Email:Smtp:Username", "Email:Smtp:Password", "Email:From" }
    .Where(k => string.IsNullOrWhiteSpace(app.Configuration[k])).ToList();
if (missingEmail.Count > 0)
    app.Logger.LogWarning("Email is NOT set up (missing: {Missing}). New accounts cannot receive the verification email and nobody can reset a password. " +
        "See \"First-time setup\" in the README.", string.Join(", ", missingEmail));

// Production checks that cannot stop the app (a wrong guess would lock everyone out) but should not go unnoticed.
if (!app.Environment.IsDevelopment())
{
    var startupLog = app.Logger;
    if (!proxyConfigured)
        startupLog.LogWarning("Proxy:KnownNetworks / Proxy:KnownProxies are not set: X-Forwarded-For and X-Forwarded-Proto are accepted from any sender. " +
            "Set them to your host's proxy addresses (see the 'Hosting in the cloud' section of the README).");
    if ((app.Configuration["AllowedHosts"] ?? "*").Trim() == "*")
        startupLog.LogWarning("AllowedHosts is '*': any Host header is accepted. Set AllowedHosts to your domain (env var AllowedHosts=your-domain.com).");
    if (origins.Length == 0)
        startupLog.LogInformation("CORS: no cross-site origin is allowed (Cors:Origins is empty). This is correct when the site and API share one address.");
    var frontend = new[] { "Frontend:EmailVerificationUrl", "Frontend:ResetPasswordUrl" };
    foreach (var key in frontend)
    {
        var url = (app.Configuration[key] ?? "").Trim();
        if (url.Length == 0)
            startupLog.LogWarning("{Key} is not set: the link in the email cannot be built. Set it to https://your-domain.com/{Page}.", key, key.EndsWith("ResetPasswordUrl") ? "reset-password" : "verify-email");
        else if (url.Contains("localhost", StringComparison.OrdinalIgnoreCase) || url.Contains("127.0.0.1"))
            startupLog.LogWarning("{Key} still points to localhost ({Url}): the links in emails will not work for real users.", key, url);
        else if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            startupLog.LogWarning("{Key} is not https ({Url}): the link in the email would send the person's reset / verification token over plain http.", key, url);
    }
}

app.UseForwardedHeaders();

// Anything unexpected answers 500 { message } instead of an HTML page (the error is still logged)
app.UseExceptionHandler(errorApp => errorApp.Run(async ctx =>
{
    ctx.Response.StatusCode = 500;
    await ctx.Response.WriteAsJsonAsync(new { message = "Something went wrong on the server. Please try again." });
}));

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Health check for the host / uptime monitor: 200 when the database answers, 503 when it does not.
// Mapped before the HTTPS redirect below so the platform's plain-http probe is not redirected.
app.MapGet("/health", async (AppDb db, CancellationToken ct) =>
{
    try
    {
        return await db.Database.CanConnectAsync(ct)
            ? Results.Ok(new { status = "ok" })
            : Results.Json(new { status = "database unavailable" }, statusCode: 503);
    }
    catch
    {
        return Results.Json(new { status = "database unavailable" }, statusCode: 503);
    }
});

// HTTPS only outside development (localhost keeps working over http). TLS ends at the host's proxy, so this uses the
// X-Forwarded-Proto that UseForwardedHeaders already read. HSTS tells browsers to use https from now on.
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
    app.Use(async (ctx, next) =>
    {
        if (!ctx.Request.IsHttps && !ctx.Request.Path.StartsWithSegments("/health"))
        {
            var url = "https://" + ctx.Request.Host + ctx.Request.PathBase + ctx.Request.Path + ctx.Request.QueryString;
            ctx.Response.Redirect(url, permanent: false);
            return;
        }
        await next();
    });
}

// Security headers on every response. The Content-Security-Policy is the safety net behind the pages' own escaping:
// even if some text were ever shown unescaped, the browser refuses inline scripts and inline event handlers, and
// scripts, forms and connections can only go to this site (plus the Google Fonts and PSGC address API the pages use).
// Inline STYLES are still allowed (the pages use style="..." attributes). "camera=(self)" is for Scan Store QR.
var csp = string.Join("; ", new[]
{
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self' https://psgc.gitlab.io" + (app.Environment.IsDevelopment() ? " http://localhost:5224" : ""),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'"   // only this site may show its own pages in a frame (Make a Payment modal); other sites still cannot
});
app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["Content-Security-Policy"] = csp;
    h["X-Content-Type-Options"] = "nosniff";
    h["X-Frame-Options"] = "SAMEORIGIN";
    h["Referrer-Policy"] = "strict-origin-when-cross-origin";
    h["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()";
    await next();
});

app.UseStaticFiles();            // wwwroot: css, js, assets
app.UseCors();

// CSRF: every state-changing /api call must carry the custom header that http.js adds. A page on another site cannot
// send a custom header without a CORS preflight (which only the origins in "Cors:Origins" pass), so a forged
// form / image / link cannot change anything. This is on top of the SameSite=Lax cookie.
app.Use(async (ctx, next) =>
{
    var m = ctx.Request.Method;
    var changes = HttpMethods.IsPost(m) || HttpMethods.IsPut(m) || HttpMethods.IsPatch(m) || HttpMethods.IsDelete(m);
    if (changes && ctx.Request.Path.StartsWithSegments("/api")
        && ctx.Request.Headers["X-Requested-With"] != "CrediTrack")
    {
        ctx.Response.StatusCode = 403;
        await ctx.Response.WriteAsJsonAsync(new { message = "Request blocked. Refresh the page and try again." });
        return;
    }
    await next();
});

// Signed-in pages must not be kept in the browser cache: after logging out, the Back button then asks the server again
// (and gets sent to /login) instead of showing the old page from the cache.
app.Use(async (ctx, next) =>
{
    if (ctx.Request.Path.StartsWithSegments("/owner") || ctx.Request.Path.StartsWithSegments("/customer"))
        ctx.Response.Headers.CacheControl = "no-store";
    await next();
});

app.UseRateLimiter();            // before authentication: a flood is turned away before it costs a database lookup
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();            // /api/... and the MVC screens (OwnerController, CustomerController)
app.MapRazorPages();             // the public pages: /, /login, /register-owner, /verify-email ...

app.Run();
