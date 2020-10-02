const http = require("http");
const fs = require("fs");
const path = require("path");
const { generateAcceptValue, parseMessage, send, close } = require("./util");
const port = 8886;

const server = http.createServer((req, res) => {
  fs.readFile(path.join(__dirname, "index.html"), (err, data) => {
    res.writeHead(200, {
      "Content-type": "text/html",
    });
    if (err) {
      console.log(err);
      res.end("500");
    } else {
      res.end(data);
    }
  });
});

server.on("upgrade", function (req, socket) {
  if (req.headers["upgrade"] !== "websocket") {
    socket.end("HTTP/1.1 400 Bad Request");
    return;
  }

  socket.on("data", (buffer) => {
    parseMessage(buffer);
  });

  setTimeout(() => {
    socket.write(send("我是小白"));
  }, 10000);
  setTimeout(() => {
    // socket.write(close());
  }, 5000);
  // 读取客户端提供的Sec-WebSocket-Key
  const secWsKey = req.headers["sec-websocket-key"];
  // 使用SHA-1算法生成Sec-WebSocket-Accept
  const hash = generateAcceptValue(secWsKey);
  // 设置HTTP响应头
  const responseHeaders = [
    "HTTP/1.1 101 Web Socket Protocol Handshake",
    "Upgrade: WebSocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${hash}`,
  ];
  // 返回握手请求的响应信息
  socket.write(responseHeaders.join("\r\n") + "\r\n\r\n");
});

server.listen(port, () =>
  console.log(`Server running at http://localhost:${port}`)
);
