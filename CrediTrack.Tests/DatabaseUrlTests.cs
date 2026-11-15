using CrediTrack.Api.Services;
using Npgsql;
using Xunit;

namespace CrediTrack.Tests;

// DATABASE_URL (postgres://user:password@host:port/db) turned into a connection string. Run with:  dotnet test CrediTrack.Tests
public class DatabaseUrlTests
{
    [Fact] public void Postgres_address_becomes_a_connection_string()
    {
        var b = new NpgsqlConnectionStringBuilder(DatabaseUrl.ToConnectionString("postgres://juan:p%40ss@db.example.com:5433/creditrack")!);
        Assert.Equal("db.example.com", b.Host);
        Assert.Equal(5433, b.Port);
        Assert.Equal("juan", b.Username);
        Assert.Equal("p@ss", b.Password);
        Assert.Equal("creditrack", b.Database);
    }

    [Fact] public void Missing_port_uses_5432()
        => Assert.Equal(5432, new NpgsqlConnectionStringBuilder(DatabaseUrl.ToConnectionString("postgresql://u:p@host/db")!).Port);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("mysql://u:p@host/db")]
    [InlineData("not a url")]
    public void Empty_or_other_text_gives_null(string? text)
        => Assert.Null(DatabaseUrl.ToConnectionString(text));
}
