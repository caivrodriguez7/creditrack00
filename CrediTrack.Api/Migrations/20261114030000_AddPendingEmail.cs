using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using CrediTrack.Api.Data;

#nullable disable

namespace CrediTrack.Api.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDb))]
    [Migration("20261114030000_AddPendingEmail")]
    public partial class AddPendingEmail : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The new address of an email change waits here until its link is opened. Existing rows stay NULL.
            migrationBuilder.AddColumn<string>(
                name: "PendingEmail",
                table: "EmailVerificationTokens",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "PendingEmail", table: "EmailVerificationTokens");
        }
    }
}
