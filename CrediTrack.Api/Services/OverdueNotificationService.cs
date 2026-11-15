namespace CrediTrack.Api.Services;

// Part 6B: an overdue credit is a matter of time (nobody does anything when a due date passes), so something has to look
// for them. This background service runs OverdueNotifier.Run once shortly after the app starts and then every hour.
// It never stops the app: an error is logged and the next round tries again. Running often is safe because
// OverdueNotifier never sends the same overdue event twice.
// Settings (appsettings or environment variables):  "Overdue:NotifyEnabled" (default true),
//                                                   "Overdue:NotifyIntervalMinutes" (default 60, allowed 1 to 1440)
public class OverdueNotificationService : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly IConfiguration _config;
    private readonly ILogger<OverdueNotificationService> _log;

    public OverdueNotificationService(IServiceScopeFactory scopes, IConfiguration config, ILogger<OverdueNotificationService> log)
    {
        _scopes = scopes;
        _config = config;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_config.GetValue("Overdue:NotifyEnabled", true)) return;
        var minutes = Math.Clamp(_config.GetValue("Overdue:NotifyIntervalMinutes", 60), 1, 1440);

        try { await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken); }   // let the app finish starting first
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<CrediTrack.Api.Data.AppDb>();
                var made = await OverdueNotifier.Run(db);
                if (made > 0) _log.LogInformation("Overdue notifications sent: {Count}", made);
            }
            catch (OperationCanceledException) { return; }
            catch (Exception ex) { _log.LogError(ex, "Overdue notification scan failed; it will try again later."); }

            try { await Task.Delay(TimeSpan.FromMinutes(minutes), stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }
}
