(() => {
  "use strict";

  if (globalThis.location.hostname !== "us-systems-lab.codethor0.workers.dev") return;

  const script = globalThis.document.createElement("script");
  script.type = "module";
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.setAttribute(
    "data-cf-beacon",
    JSON.stringify({ token: "bff8122eeed44fd1982ccc4ce012828a" }),
  );
  globalThis.document.head.append(script);
})();
