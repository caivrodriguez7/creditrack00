# Put this file in the creditrack_security_v22 folder (next to CrediTrack.Api and CrediTrack.Tests).
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY CrediTrack.Api/CrediTrack.Api.csproj CrediTrack.Api/
RUN dotnet restore CrediTrack.Api/CrediTrack.Api.csproj
COPY CrediTrack.Api/ CrediTrack.Api/
RUN dotnet publish CrediTrack.Api/CrediTrack.Api.csproj -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_ENVIRONMENT=Production
# Render gives the port in $PORT (default 10000)
CMD ["sh", "-c", "ASPNETCORE_URLS=http://+:${PORT:-10000} dotnet CrediTrack.Api.dll"]
