using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CrediTrack.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddEmailVerificationToUsers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Rows that already exist get false from this default...
            migrationBuilder.AddColumn<bool>(
                name: "EmailVerified",
                table: "Users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "EmailVerifiedAt",
                table: "Users",
                type: "timestamp with time zone",
                nullable: true);

            // ...and are then marked verified, so existing users are not locked out.
            // Users registered after this migration start with EmailVerified = false (from the User model).
            migrationBuilder.Sql("UPDATE \"Users\" SET \"EmailVerified\" = TRUE;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EmailVerified",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "EmailVerifiedAt",
                table: "Users");
        }
    }
}
