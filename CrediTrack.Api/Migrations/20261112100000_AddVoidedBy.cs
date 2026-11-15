using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using CrediTrack.Api.Data;

#nullable disable

namespace CrediTrack.Api.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDb))]
    [Migration("20261112100000_AddVoidedBy")]
    public partial class AddVoidedBy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "VoidedByUserId",
                table: "Transactions",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "VoidedByName",
                table: "Transactions",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "VoidedByName", table: "Transactions");
            migrationBuilder.DropColumn(name: "VoidedByUserId", table: "Transactions");
        }
    }
}
