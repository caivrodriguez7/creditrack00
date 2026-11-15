using CrediTrack.Api.Services;
using Xunit;

namespace CrediTrack.Tests;

// The Customer Code and Store Code makers. Run with:  dotnet test CrediTrack.Tests
public class CodesTests
{
    [Fact] public void Customer_code_has_the_format_every_page_checks()
    {
        for (var i = 0; i < 2000; i++)
            Assert.Matches(@"^CT-CUS-[1-9]\d{5}$", Codes.NewCustomerCode());   // CT-CUS- and six digits, never a leading 0
    }

    [Fact] public void Store_code_uses_only_the_easy_to_read_letters_and_numbers()
    {
        for (var i = 0; i < 2000; i++)
            Assert.Matches(@"^CT-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$", Codes.NewStoreCode());   // no I, O, 0 or 1
    }

    [Fact] public void Codes_are_not_a_counting_sequence()
    {
        // A predictable generator would hand out neighbours (123456, 123457 ...). Real random codes almost never do.
        var codes = Enumerable.Range(0, 500).Select(_ => int.Parse(Codes.NewCustomerCode()[7..])).ToList();
        Assert.True(codes.Distinct().Count() > 490);
        var neighbours = codes.Zip(codes.Skip(1), (a, b) => Math.Abs(a - b) == 1).Count(x => x);
        Assert.True(neighbours < 5);
    }
}
