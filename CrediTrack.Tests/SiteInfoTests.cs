using CrediTrack.Api.Services;
using Xunit;

namespace CrediTrack.Tests;

// Contact details shown in the footer, Help & Support, Terms and Privacy. Run with:  dotnet test CrediTrack.Tests
public class SiteInfoTests
{
    [Fact] public void Local_mobile_number_becomes_an_international_tel_link()
        => Assert.Equal("+639170000000", new SiteInfo { SupportPhone = "0917 000 0000" }.PhoneHref);

    [Fact] public void International_number_keeps_its_plus_sign()
        => Assert.Equal("+639171234567", new SiteInfo { SupportPhone = "+63 917 123 4567" }.PhoneHref);

    [Fact] public void Test_address_is_reported_as_sample()
        => Assert.True(new SiteInfo { SupportEmail = "support@creditrack.test" }.IsSample);

    [Fact] public void Real_address_is_not_sample()
        => Assert.False(new SiteInfo { SupportEmail = "help@mycreditrack.com" }.IsSample);
}
