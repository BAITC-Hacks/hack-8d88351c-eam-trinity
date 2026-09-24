// Local QA proxy: block external images in the browser while local GeoJSON works.
// Start the production app on 3001, run this script, then open http://127.0.0.1:3002.
import http from "node:http";
http
  .createServer((request, response) => {
    const upstream = http.request(
      {
        hostname: "127.0.0.1",
        port: 3001,
        path: request.url,
        method: request.method,
        headers: request.headers,
      },
      (incoming) => {
        response.writeHead(incoming.statusCode, {
          ...incoming.headers,
          "content-security-policy": "img-src 'self' data: blob:",
        });
        incoming.pipe(response);
      },
    );
    upstream.on("error", () => {
      response.writeHead(502);
      response.end("Start CITYPROOF on port 3001 first.");
    });
    request.pipe(upstream);
  })
  .listen(3002, "127.0.0.1", () =>
    console.log("Tile failure QA: http://127.0.0.1:3002"),
  );
