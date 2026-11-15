using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using CrediTrack.Api.Data;

#nullable disable

namespace CrediTrack.Api.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDb))]
    [Migration("20261111170000_AddArchiveAudit")]
    public partial class AddArchiveAudit : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ArchivedAt",
                table: "Customers",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ArchivedByUserId",
                table: "Customers",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ArchivedAt",
                table: "PaymentRequests",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ArchivedByUserId",
                table: "PaymentRequests",
                type: "integer",
                nullable: true);

            // Rows that were archived before this migration get a best-guess date, so the screens can show one.
            migrationBuilder.Sql("UPDATE \"Customers\" SET \"ArchivedAt\" = COALESCE(\"UpdatedAt\", \"CreatedAt\") WHERE \"IsArchived\" = TRUE;");
            migrationBuilder.Sql("UPDATE \"PaymentRequests\" SET \"ArchivedAt\" = COALESCE(\"ReviewedAt\", \"SubmittedAt\") WHERE \"IsArchived\" = TRUE;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "ArchivedAt", table: "Customers");
            migrationBuilder.DropColumn(name: "ArchivedByUserId", table: "Customers");
            migrationBuilder.DropColumn(name: "ArchivedAt", table: "PaymentRequests");
            migrationBuilder.DropColumn(name: "ArchivedByUserId", table: "PaymentRequests");
        }
    }
}
