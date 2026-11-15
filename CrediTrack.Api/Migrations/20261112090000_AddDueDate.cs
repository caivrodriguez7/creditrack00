using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using CrediTrack.Api.Data;

#nullable disable

namespace CrediTrack.Api.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDb))]
    [Migration("20261112090000_AddDueDate")]
    public partial class AddDueDate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Optional agreed payment date of a credit (a plain date, no time). Existing rows stay NULL = "No due date".
            migrationBuilder.AddColumn<DateOnly>(
                name: "DueDate",
                table: "Transactions",
                type: "date",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "DueDate", table: "Transactions");
        }
    }
}
