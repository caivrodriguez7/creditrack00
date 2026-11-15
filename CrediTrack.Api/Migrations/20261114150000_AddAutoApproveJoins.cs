using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using CrediTrack.Api.Data;

#nullable disable

namespace CrediTrack.Api.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDb))]
    [Migration("20261114150000_AddAutoApproveJoins")]
    public partial class AddAutoApproveJoins : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Off for every existing store: the owner has to turn it on (Settings > Store QR Code & Store Code).
            migrationBuilder.AddColumn<bool>(
                name: "AutoApproveJoins",
                table: "Stores",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "AutoApproveJoins", table: "Stores");
        }
    }
}
