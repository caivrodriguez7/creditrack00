using Npgsql;

namespace CrediTrack.Api.Services;

// Cloud hosts (Render, Railway, Heroku ...) often give the database as ONE address: postgres://user:password@host:5432/dbname
// in the DATABASE_URL variable. This turns it into the connection string the app needs, so it can be used as a fallback
// when ConnectionStrings:Default is not set. Returns null when the text is empty or is not a postgres address.
public static class DatabaseUrl
{
    public static string? ToConnectionString(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        if (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme != "postgres" && uri.Scheme != "postgresql") return null;

        var login = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Username = Uri.UnescapeDataString(login[0]),
            Password = login.Length > 1 ? Uri.UnescapeDataString(login[1]) : "",
            Database = uri.AbsolutePath.Trim('/')
        };
        return builder.ConnectionString;
    }
}
