namespace CrediTrack.Api.ViewModels;

// What the About CrediTrack screen (Store Owner) shows: filled in by OwnerController and displayed by Views/Owner/About.cshtml.
public class AboutViewModel
{
    public string Name { get; set; } = "CrediTrack";
    public string Tagline { get; set; } = "";
    public string Version { get; set; } = "1.0.0";
}
