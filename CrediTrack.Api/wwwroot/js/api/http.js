/* Talks to the ASP.NET Core API. Every page that needs the backend loads this first. */
(function () {
  "use strict";

  // The pages and the API are served by the same ASP.NET Core app, so the API lives at /api on the same address
  // (works on localhost and when hosted). Only when the pages are opened with VS Code Live Server (port 5500) do they
  // call the API on its own address.
  var BASE = window.location.port === "5500" ? "http://localhost:5224/api" : "/api";

  // CrediTrackHttp("/auth/login", { method: "POST", body: { ... } }) returns a Promise with the JSON reply.
  // If the server answers with an error, the Promise fails with an Error whose message comes from the server.
  window.CrediTrackHttp = function (path, options) {
    options = options || {};
    return fetch(BASE + path, {
      method: options.method || "GET",
      credentials: "include",                      // sends and receives the login cookie
      headers: { "Content-Type": "application/json", "X-Requested-With": "CrediTrack" },   // the header the server checks (CSRF)
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (response) {
      if (response.ok) return response.status === 204 ? null : response.json();
      return response.json().catch(function () { return {}; }).then(function (data) {
        var error = new Error(data.message || "Something went wrong. Please try again.");
        error.status = response.status;
        if (data.requiresEmailVerification === true) error.requiresEmailVerification = true;   // unverified email (login)
        if (data.field) { error.field = data.field; error.code = data.field; }   // which form field to highlight
        throw error;
      });
    }, function () {
      // fetch itself failed: the API is not running, or CORS blocked it
      throw new Error("Cannot reach the server. Is the API running?");
    });
  };
})();
